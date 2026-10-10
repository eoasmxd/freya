import type { FreyaAttachment, FreyaContext, RouteContext } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

const WSS_HANDLER_ID = 'built-in-ws-channel';

const PING_INTERVAL_MS = 30_000;

const RECONNECT_TIMEOUT_MS = 30_000;

const WS_UPLOAD_PATH = '/ws/upload';

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const WS_MIME_MAP: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

interface WsConnectionMeta {
    ws: WebSocket;
    connId: string;
    clientId: string;
    pingTimer?: ReturnType<typeof setInterval>;
    lastPongTime: number;
    defaultLanguage: string;
    defaultSessionId: string;
    channelType: string;
}

/**
 * 内置 WebSocket 通信通道。
 * Built-in WebSocket communication channel.
 * 负责管理物理长连接的接入与心跳，并将后端的全量/流式响应以 WebSocket 事件形式推送给网页端。
 * Manages physical persistent connection lifecycle and heartbeats, pushing full/streaming responses to web client via WebSocket events.
 */
export class FreyaWsChannel {
    id = 'built-in-ws-channel';
    private wss?: WebSocketServer;
    private connections = new Set<WebSocket>();
    private wsMetaMap = new Map<string, WsConnectionMeta>();
    private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private unregisterUploadApi?: () => void;
    private ctx?: FreyaContext;
    private isSetup = false;
    private readonly i18n = new I18n({ zh, en });

    constructor(private httpServer?: http.Server) { }

    async setup(ctx: FreyaContext): Promise<void> {
        if (this.isSetup) return;
        this.isSetup = true;
        this.ctx = ctx;
        this.i18n.setContext(ctx);
        ctx.eventBus.on('connection:reply', this.handleConnectionReply);
        ctx.eventBus.on('connection:reply:delta', this.handleConnectionReplyDelta);
        ctx.eventBus.on('connection:event', this.handleConnectionEvent);
        ctx.eventBus.on('connection:reply:completed', this.handleConnectionReplyCompleted);

        if (ctx.http && !this.unregisterUploadApi) {
            this.unregisterUploadApi = ctx.http.registerApi(
                WS_UPLOAD_PATH,
                (req, res, routeContext) => this.handleUpload(req, res, routeContext),
                { auth: true }
            );
        }
    }

    async start(ctx: FreyaContext): Promise<void> {
        if (ctx.http && !this.unregisterUploadApi) {
            this.unregisterUploadApi = ctx.http.registerApi(
                WS_UPLOAD_PATH,
                (req, res, routeContext) => this.handleUpload(req, res, routeContext),
                { auth: true }
            );
        }
        const handleProtocols = (protocols: Set<string>) => {
            if (protocols.has('freya-auth')) return 'freya-auth';
            return false;
        };

        this.wss = this.httpServer
            ? new WebSocketServer({ server: this.httpServer, handleProtocols })
            : new WebSocketServer({ noServer: true, handleProtocols });

        this.wss.on('connection', (ws, req) => {
            const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const queryClientId = reqUrl.searchParams.get('clientId')?.trim();
            const querySessionId = reqUrl.searchParams.get('sessionId')?.trim();
            const queryChannelType = reqUrl.searchParams.get('channelType')?.trim();
            const queryLanguage = reqUrl.searchParams.get('language')?.trim();

            const clientId = queryClientId || `temp:${crypto.randomUUID()}`;
            const connId = `${WSS_HANDLER_ID}:${clientId}`;

            const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
            const defaultLanguage = queryLanguage || (acceptLang.includes('zh') ? 'zh' : 'en');
            const defaultSessionId = querySessionId || 'main';
            const channelType = queryChannelType || 'web';

            const oldMeta = this.wsMetaMap.get(connId);
            if (oldMeta && oldMeta.ws !== ws) {
                if (oldMeta.pingTimer) {
                    clearInterval(oldMeta.pingTimer);
                }
                try {
                    oldMeta.ws.close();
                } catch { }
                this.connections.delete(oldMeta.ws);
            }

            const pendingTimer = this.reconnectTimers.get(connId);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                this.reconnectTimers.delete(connId);
            }

            this.connections.add(ws);

            const pingTimer = setInterval(() => {
                if (Date.now() - meta.lastPongTime > PING_INTERVAL_MS * 2) {
                    ctx.logger.warn(`[WsChannel] Connection heartbeat timed out, terminating connection ID: ${meta.connId}`);
                    ws.terminate();
                    return;
                }
                if (ws.readyState === WebSocket.OPEN) ws.ping();
            }, PING_INTERVAL_MS);

            const meta: WsConnectionMeta = {
                ws,
                connId,
                clientId,
                pingTimer,
                lastPongTime: Date.now(),
                defaultLanguage,
                defaultSessionId,
                channelType
            };
            this.wsMetaMap.set(connId, meta);
            ctx.eventBus.emit('connection:active', {
                connectionId: connId,
                defaultSessionId: meta.defaultSessionId,
                staleThresholdMs: 300000,
                channelType: meta.channelType,
                defaultLanguage: meta.defaultLanguage
            });

            ws.on('pong', () => {
                meta.lastPongTime = Date.now();
                ctx.eventBus.emit('connection:active', {
                    connectionId: meta.connId,
                    defaultSessionId: meta.defaultSessionId,
                    staleThresholdMs: 300000,
                    channelType: meta.channelType,
                    defaultLanguage: meta.defaultLanguage
                });
            });

            const configLang = (ctx.config as any)?.system?.language;
            const effectiveLanguage = (configLang && configLang !== 'auto') ? configLang : meta.defaultLanguage;

            ws.send(JSON.stringify({
                event: 'server:connected',
                data: {
                    message: this.i18n.t(
                        'channel.ws.connected',
                        'Connected to Freya backend WebSocket service successfully.',
                        undefined,
                        effectiveLanguage
                    ),
                    connectionId: connId,
                    sessionId: meta.defaultSessionId,
                    language: effectiveLanguage
                }
            }));

            ws.on('message', (messageData) => {
                try {
                    const payload = JSON.parse(messageData.toString());
                    ctx.eventBus.emit('connection:active', {
                        connectionId: meta.connId,
                        defaultSessionId: meta.defaultSessionId,
                        staleThresholdMs: 300000,
                        channelType: meta.channelType,
                        defaultLanguage: meta.defaultLanguage
                    });
                    meta.lastPongTime = Date.now();

                    if (payload.event === 'client:reconnect') {
                        const { clientId: reClientId, sessionId: reSessionId, channelType: reChannelType, language: reLanguage } = payload.data || {};
                        this.handleReconnect(ctx, meta, {
                            clientId: (typeof reClientId === 'string' && reClientId.length > 0) ? reClientId : meta.clientId,
                            sessionId: reSessionId,
                            channelType: reChannelType,
                            language: reLanguage
                        });
                        return;
                    }

                    if (payload.event === 'client:message') {
                        const {
                            content,
                            sessionId,
                            ephemeral,
                            language: msgLanguage,
                            toolboxes,
                            skillId,
                            attachments
                        } = payload.data || {};

                        const parsedToolboxes = this.parseToolboxIds(toolboxes);
                        const resolvedSkillId = typeof skillId === 'string' && skillId.trim()
                            ? skillId.trim()
                            : undefined;
                        const resolvedAttachments = this.normalizeAttachments(attachments);

                        const messagePayload = {
                            connectionId: meta.connId,
                            content: content,
                            sessionId: sessionId || undefined,
                            defaultSessionId: meta.defaultSessionId,
                            ephemeral: Boolean(ephemeral),
                            channelType: meta.channelType,
                            defaultLanguage: msgLanguage || meta.defaultLanguage,
                            toolboxes: parsedToolboxes.length > 0 ? parsedToolboxes : undefined,
                            skillId: resolvedSkillId,
                            attachments: resolvedAttachments
                        };
                        ctx.eventBus.emit('connection:message', messagePayload);
                    } else if (payload.event === 'client:interrupt') {
                        ctx.eventBus.emit('connection:interrupt', {
                            connectionId: meta.connId,
                            sessionId: payload.data?.sessionId
                        });
                    }
                } catch (err) {
                    ctx.logger.error('[WsChannel] Failed to parse client message:', err);
                }
            });

            ws.on('close', () => {
                ctx.logger.info(`[WsChannel] Connection closed, ID: ${meta.connId}`);
                this.cleanupConnection(ctx, meta);
            });

            ws.on('error', () => {
                ctx.logger.debug(`[WsChannel] Connection error, ID: ${meta.connId}`);
            });
        });
    }

    private handleReconnect(
        ctx: FreyaContext,
        meta: WsConnectionMeta,
        options: { clientId: string; sessionId?: string; channelType?: string; language?: string }
    ): void {
        const { clientId, sessionId, channelType, language } = options;
        const stableConnId = `${WSS_HANDLER_ID}:${clientId}`;

        if (sessionId) meta.defaultSessionId = sessionId;
        if (channelType) meta.channelType = channelType;
        if (language) meta.defaultLanguage = language;

        if (meta.connId === stableConnId) {
            ctx.eventBus.emit('connection:active', {
                connectionId: stableConnId,
                defaultSessionId: meta.defaultSessionId,
                staleThresholdMs: 300000,
                channelType: meta.channelType,
                defaultLanguage: meta.defaultLanguage
            });
            return;
        }

        const oldMeta = this.wsMetaMap.get(stableConnId);
        if (oldMeta && oldMeta.ws !== meta.ws) {
            if (oldMeta.pingTimer) {
                clearInterval(oldMeta.pingTimer);
            }
            try {
                oldMeta.ws.close();
            } catch { }
            this.connections.delete(oldMeta.ws);
        }

        const pendingTimer = this.reconnectTimers.get(stableConnId);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            this.reconnectTimers.delete(stableConnId);
        }

        ctx.eventBus.emit('connection:inactive', { connectionId: meta.connId });
        this.wsMetaMap.delete(meta.connId);

        meta.connId = stableConnId;
        meta.clientId = clientId;
        this.wsMetaMap.set(stableConnId, meta);
        ctx.eventBus.emit('connection:active', {
            connectionId: stableConnId,
            defaultSessionId: meta.defaultSessionId,
            staleThresholdMs: 300000,
            channelType: meta.channelType,
            defaultLanguage: meta.defaultLanguage
        });

        const configLang = (ctx.config as any)?.system?.language;
        const effectiveLanguage = (configLang && configLang !== 'auto') ? configLang : meta.defaultLanguage;

        if (meta.ws.readyState === WebSocket.OPEN) {
            meta.ws.send(JSON.stringify({
                event: 'server:reconnected',
                data: {
                    connectionId: stableConnId,
                    sessionId: meta.defaultSessionId,
                    language: effectiveLanguage,
                    recovered: true
                }
            }));
        }
    }

    private cleanupConnection(ctx: FreyaContext, meta: WsConnectionMeta): void {
        if (meta.pingTimer) {
            clearInterval(meta.pingTimer);
            meta.pingTimer = undefined;
        }
        this.connections.delete(meta.ws);

        const currentMetaInMap = this.wsMetaMap.get(meta.connId);
        if (currentMetaInMap && currentMetaInMap.ws === meta.ws) {
            this.wsMetaMap.delete(meta.connId);

            const timer = setTimeout(() => {
                ctx.eventBus.emit('connection:inactive', { connectionId: meta.connId });
                this.reconnectTimers.delete(meta.connId);
            }, RECONNECT_TIMEOUT_MS);
            this.reconnectTimers.set(meta.connId, timer);
        }
    }

    async stop(): Promise<void> {
        for (const meta of this.wsMetaMap.values()) {
            if (meta.pingTimer) {
                clearInterval(meta.pingTimer);
            }
            try {
                meta.ws.close();
            } catch { }
        }
        this.wsMetaMap.clear();
        this.connections.clear();

        for (const timer of this.reconnectTimers.values()) {
            clearTimeout(timer);
        }
        this.reconnectTimers.clear();

        if (this.unregisterUploadApi) {
            this.unregisterUploadApi();
            this.unregisterUploadApi = undefined;
        }

        if (this.wss) {
            this.wss.close();
        }

        if (this.ctx) {
            this.ctx.eventBus.off('connection:reply', this.handleConnectionReply);
            this.ctx.eventBus.off('connection:reply:delta', this.handleConnectionReplyDelta);
            this.ctx.eventBus.off('connection:event', this.handleConnectionEvent);
            this.ctx.eventBus.off('connection:reply:completed', this.handleConnectionReplyCompleted);
        }

        this.isSetup = false;
    }

    /**
     * 解析工具箱列表入参（支持数组或逗号分隔字符串）。
     * Parse toolbox IDs from array or comma-separated string.
     */
    private parseToolboxIds(input: unknown): string[] {
        if (Array.isArray(input)) {
            return input.map(String).map((s) => s.trim()).filter(Boolean);
        }
        if (typeof input === 'string') {
            return input
                .split(/[,，\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
        }
        return [];
    }

    private handleConnectionReply = (payload: { connectionId: string; content: string; sessionId?: string }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: 'server:reply',
                        data: {
                            role: 'assistant',
                            text: payload.content,
                            sessionId: payload.sessionId
                        }
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] Failed to send server:reply: ${err.message}`);
                }
            }
        }
    };

    private handleConnectionReplyDelta = (payload: { connectionId: string; text: string; sessionId?: string }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: 'server:delta',
                        data: {
                            role: 'assistant',
                            text: payload.text,
                            sessionId: payload.sessionId
                        }
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] Failed to send server:delta: ${err.message}`);
                }
            }
        }
    };

    private handleConnectionEvent = (payload: { connectionId: string; event: string; data: any }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: payload.event,
                        data: payload.data
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] Failed to send custom event ${payload.event}: ${err.message}`);
                }
            }
        }
    };

    private handleConnectionReplyCompleted = (payload: { connectionId: string; sessionId?: string }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: 'server:completed',
                        data: {
                            sessionId: payload.sessionId
                        }
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] Failed to send server:completed: ${err.message}`);
                }
            }
        }
    };

    handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        this.wss?.handleUpgrade(req, socket, head, (ws) => {
            this.wss?.emit('connection', ws, req);
        });
    }

    /**
     * 处理 HTTP 文件上传接口请求。
     * Handle HTTP file upload endpoint request.
     */
    private async handleUpload(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        context: RouteContext
    ): Promise<boolean | void> {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, Authorization'
            });
            res.end();
            return true;
        }

        if (req.method !== 'POST') {
            res.writeHead(405, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return true;
        }

        if (!this.ctx) {
            res.writeHead(500, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Context not initialized' }));
            return true;
        }

        const chunks: Buffer[] = [];
        let totalSize = 0;
        let isPayloadTooLarge = false;

        try {
            await new Promise<void>((resolve, reject) => {
                req.on('data', (chunk: Buffer) => {
                    if (isPayloadTooLarge) return;
                    totalSize += chunk.length;
                    if (totalSize > MAX_UPLOAD_SIZE) {
                        isPayloadTooLarge = true;
                        reject(new Error('Payload Too Large'));
                        return;
                    }
                    chunks.push(chunk);
                });
                req.on('end', () => resolve());
                req.on('error', (err) => reject(err));
            });
        } catch (err: any) {
            const isTooLarge = err.message === 'Payload Too Large' || isPayloadTooLarge;
            if (!res.headersSent && !res.writableEnded) {
                res.writeHead(isTooLarge ? 413 : 400, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: err.message || 'Upload failed' }));
            }
            if (isTooLarge && !req.destroyed) {
                req.destroy();
            }
            return true;
        }

        const rawBuffer = Buffer.concat(chunks);
        if (rawBuffer.length === 0) {
            res.writeHead(400, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: 'Empty file payload' }));
            return true;
        }

        const contentType = String(req.headers['content-type'] || '');
        let fileBuffer: Buffer | undefined;
        let originalFileName = '';
        let detectedMime = '';

        if (contentType.includes('multipart/form-data')) {
            const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
            const boundary = boundaryMatch ? boundaryMatch[1].trim().replace(/^["']|["']$/g, '') : '';
            if (!boundary) {
                res.writeHead(400, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Missing boundary in multipart request' }));
                return true;
            }
            const parsed = this.parseMultipartFormData(rawBuffer, boundary);
            if (!parsed) {
                res.writeHead(400, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Invalid multipart payload or missing file' }));
                return true;
            }
            fileBuffer = parsed.data;
            originalFileName = parsed.fileName || '';
            detectedMime = parsed.mimeType || '';
        }

        if (!fileBuffer) {
            fileBuffer = rawBuffer;
            const xFileName = req.headers['x-file-name'];
            const contentDisposition = req.headers['content-disposition'];
            const queryFilename = context.query.get('filename') || context.query.get('name');

            if (typeof xFileName === 'string' && xFileName.trim()) {
                try {
                    originalFileName = decodeURIComponent(xFileName.trim());
                } catch {
                    originalFileName = xFileName.trim();
                }
            } else if (contentDisposition) {
                const fnMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
                if (fnMatch) {
                    try {
                        originalFileName = decodeURIComponent(fnMatch[1].trim());
                    } catch {
                        originalFileName = fnMatch[1].trim();
                    }
                }
            } else if (queryFilename) {
                originalFileName = queryFilename.trim();
            }

            detectedMime = contentType.split(';')[0].trim();
        }

        if (!originalFileName) {
            const magic = this.detectMimeType(fileBuffer);
            originalFileName = `upload_${Date.now()}.${magic.ext}`;
            if (!detectedMime || detectedMime === 'application/octet-stream') {
                detectedMime = magic.mimeType;
            }
        }

        const ext = path.extname(originalFileName).toLowerCase();
        let finalMimeType = detectedMime;
        if (!finalMimeType || finalMimeType === 'application/octet-stream') {
            finalMimeType = WS_MIME_MAP[ext] || this.detectMimeType(fileBuffer).mimeType;
        }

        const isImage = finalMimeType.startsWith('image/');
        const finalType: 'image' | 'file' = isImage ? 'image' : 'file';

        try {
            const cacheDir = path.resolve(this.ctx.paths.workspaceDir, 'cache/ws');
            await fs.mkdir(cacheDir, { recursive: true });

            const safeOriginalName = path.basename(originalFileName)
                .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
                .trim()
                .slice(0, 100) || 'upload_file';
            const safeFileName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeOriginalName}`;
            const targetFilePath = path.join(cacheDir, safeFileName);
            await fs.writeFile(targetFilePath, fileBuffer);

            const relativePath = `cache/ws/${safeFileName}`;

            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({
                success: true,
                data: {
                    type: finalType,
                    fileName: safeOriginalName,
                    mimeType: finalMimeType,
                    path: relativePath,
                    size: fileBuffer.length
                }
            }));
            return true;
        } catch (err: any) {
            this.ctx.logger.error(`[WsChannel] Failed to save uploaded file: ${err.message}`);
            if (!res.headersSent && !res.writableEnded) {
                res.writeHead(500, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Failed to save file' }));
            }
            return true;
        }
    }

    /**
     * 解析 multipart/form-data 数据提取文件。
     * Parse multipart/form-data payload to extract file.
     */
    private parseMultipartFormData(
        bodyBuffer: Buffer,
        boundary: string
    ): { fileName?: string; mimeType?: string; data: Buffer } | null {
        const delimiter = Buffer.from(`--${boundary}`);
        const crlf = Buffer.from('\r\n\r\n');
        let startIndex = bodyBuffer.indexOf(delimiter);
        if (startIndex === -1) return null;

        while (startIndex !== -1) {
            let partStart = startIndex + delimiter.length;
            if (
                partStart + 2 <= bodyBuffer.length &&
                bodyBuffer[partStart] === 45 &&
                bodyBuffer[partStart + 1] === 45
            ) {
                break;
            }
            if (partStart + 2 <= bodyBuffer.length && bodyBuffer[partStart] === 13 && bodyBuffer[partStart + 1] === 10) {
                partStart += 2;
            } else if (partStart < bodyBuffer.length && bodyBuffer[partStart] === 10) {
                partStart += 1;
            }

            const nextIndex = bodyBuffer.indexOf(delimiter, partStart);
            if (nextIndex === -1) break;

            let partEnd = nextIndex;
            if (partEnd >= partStart + 2 && bodyBuffer[partEnd - 2] === 13 && bodyBuffer[partEnd - 1] === 10) {
                partEnd -= 2;
            } else if (partEnd >= partStart + 1 && bodyBuffer[partEnd - 1] === 10) {
                partEnd -= 1;
            }

            const partBuffer = bodyBuffer.subarray(partStart, partEnd);
            const headerEndIndex = partBuffer.indexOf(crlf);
            if (headerEndIndex !== -1) {
                const headerStr = partBuffer.subarray(0, headerEndIndex).toString('utf-8');
                const data = partBuffer.subarray(headerEndIndex + crlf.length);

                const filenameMatch =
                    headerStr.match(/filename\*=(?:UTF-8''|utf-8'')?([^;\r\n]+)/i) ||
                    headerStr.match(/filename=(?:"([^"]*)"|([^;\r\n\s]+))/i);
                const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n;]+)/i);

                if (filenameMatch) {
                    let rawFileName = (filenameMatch[1] ?? filenameMatch[2] ?? '').trim();
                    rawFileName = rawFileName.replace(/^["']|["']$/g, '');
                    try {
                        rawFileName = decodeURIComponent(rawFileName);
                    } catch { }
                    return {
                        fileName: path.basename(rawFileName),
                        mimeType: mimeMatch ? mimeMatch[1].trim() : undefined,
                        data
                    };
                }
            }
            startIndex = nextIndex;
        }
        return null;
    }

    /**
     * 检测二进制前缀魔数识别 MIME 类型。
     * Detect MIME type from buffer magic numbers.
     */
    private detectMimeType(buffer: Buffer): { mimeType: string; ext: string } {
        if (buffer.length > 4) {
            if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
                return { mimeType: 'image/jpeg', ext: 'jpg' };
            }
            if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
                return { mimeType: 'image/png', ext: 'png' };
            }
            if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
                return { mimeType: 'image/gif', ext: 'gif' };
            }
            if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
                const webpHeader = buffer.subarray(8, 12).toString('ascii');
                if (webpHeader === 'WEBP') {
                    return { mimeType: 'image/webp', ext: 'webp' };
                }
            }
        }
        return { mimeType: 'application/octet-stream', ext: 'bin' };
    }

    /**
     * 规范化并校验传入的附件列表。
     * Normalize and validate incoming attachments.
     */
    private normalizeAttachments(rawInput: unknown): FreyaAttachment[] | undefined {
        if (!Array.isArray(rawInput) || rawInput.length === 0) {
            return undefined;
        }

        const result: FreyaAttachment[] = [];

        for (const item of rawInput) {
            if (!item) continue;

            let candidateUrl: string | undefined;
            let candidatePath: string | undefined;
            let candidateMime: string | undefined;
            let candidateType: 'image' | 'file' | undefined;
            let candidateDescription: string | undefined;

            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (!trimmed) continue;
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    candidateUrl = trimmed;
                } else {
                    candidatePath = trimmed;
                }
            } else if (typeof item === 'object') {
                const obj = item as Record<string, any>;
                if (typeof obj.url === 'string' && obj.url.trim()) {
                    candidateUrl = obj.url.trim();
                }
                if (typeof obj.path === 'string' && obj.path.trim()) {
                    candidatePath = obj.path.trim();
                }
                if (typeof obj.mimeType === 'string' && obj.mimeType.trim()) {
                    candidateMime = obj.mimeType.trim();
                }
                if (obj.type === 'image' || obj.type === 'file') {
                    candidateType = obj.type;
                }
                if (typeof obj.description === 'string' && obj.description.trim()) {
                    candidateDescription = obj.description.trim();
                }
            } else {
                continue;
            }

            if (!candidateUrl && !candidatePath) {
                continue;
            }

            if (candidatePath && this.ctx?.paths.workspaceDir) {
                if (path.isAbsolute(candidatePath)) {
                    this.ctx.logger.warn(`[WsChannel] Rejected absolute attachment path: ${candidatePath}`);
                    continue;
                }
                const workspaceAbs = this.ctx.paths.workspaceDir;
                const targetAbs = path.resolve(workspaceAbs, candidatePath);
                const workspacePrefix = workspaceAbs.endsWith(path.sep) ? workspaceAbs : workspaceAbs + path.sep;
                if (targetAbs !== workspaceAbs && !targetAbs.startsWith(workspacePrefix)) {
                    this.ctx.logger.warn(`[WsChannel] Rejected out-of-workspace attachment path: ${candidatePath}`);
                    continue;
                }
            }

            const targetResource = candidateUrl || candidatePath || '';
            let ext = '';
            try {
                if (candidateUrl) {
                    ext = path.extname(new URL(candidateUrl).pathname).toLowerCase();
                } else {
                    ext = path.extname(targetResource).toLowerCase();
                }
            } catch {
                ext = path.extname(targetResource).toLowerCase();
            }

            const mimeType = candidateMime || WS_MIME_MAP[ext] || 'application/octet-stream';
            const type: 'image' | 'file' = candidateType || (mimeType.startsWith('image/') ? 'image' : 'file');

            const attachment: FreyaAttachment = {
                type,
                mimeType,
                ...(candidateUrl ? { url: candidateUrl } : {}),
                ...(candidatePath ? { path: candidatePath } : {}),
                ...(candidateDescription ? { description: candidateDescription } : {})
            };

            result.push(attachment);
        }

        return result.length > 0 ? result : undefined;
    }
}
