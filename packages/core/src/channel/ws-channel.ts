import type { FreyaContext } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

const WSS_HANDLER_ID = 'built-in-ws-channel';

const PING_INTERVAL_MS = 30_000;

const RECONNECT_TIMEOUT_MS = 30_000;

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
    }

    async start(ctx: FreyaContext): Promise<void> {
        this.wss = this.httpServer
            ? new WebSocketServer({ server: this.httpServer })
            : new WebSocketServer({ noServer: true });

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
                        const { content, sessionId, ephemeral, language: msgLanguage } = payload.data || {};

                        const messagePayload = {
                            connectionId: meta.connId,
                            content: content,
                            sessionId: sessionId || undefined,
                            defaultSessionId: meta.defaultSessionId,
                            ephemeral: Boolean(ephemeral),
                            channelType: meta.channelType,
                            defaultLanguage: msgLanguage || meta.defaultLanguage
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
}
