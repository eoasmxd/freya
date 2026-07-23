import type { FreyaContext } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const WSS_HANDLER_ID = 'built-in-ws-channel';

const PING_INTERVAL_MS = 30_000;

const RECONNECT_TIMEOUT_MS = 30_000;

interface WsConnectionMeta {
    ws: WebSocket;
    connId: string;
    clientId?: string;
    pingTimer?: ReturnType<typeof setInterval>;
    lastPongTime: number;
}

/**
 * 内置 WebSocket 通信通道。
 * 负责管理物理长连接的接入与心跳，并将后端的全量/流式响应以 WebSocket 事件形式推送给网页端。
 */
export class FreyaWsChannel {
    id = 'built-in-ws-channel';
    private wss?: WebSocketServer;
    private connections = new Set<WebSocket>();
    private wsMetaMap = new Map<string, WsConnectionMeta>();
    private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private ctx?: FreyaContext;
    private isSetup = false;

    constructor(private httpServer: http.Server) { }

    async setup(ctx: FreyaContext): Promise<void> {
        if (this.isSetup) return;
        this.isSetup = true;
        this.ctx = ctx;
        ctx.eventBus.on('connection:reply', this.handleConnectionReply);
        ctx.eventBus.on('connection:reply:delta', this.handleConnectionReplyDelta);
        ctx.eventBus.on('connection:event', this.handleConnectionEvent);
        ctx.eventBus.on('connection:reply:completed', this.handleConnectionReplyCompleted);
    }

    async start(ctx: FreyaContext): Promise<void> {
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws) => {
            const tempConnId = `${WSS_HANDLER_ID}:temp:${crypto.randomUUID()}`;
            ctx.logger.info(`[WsChannel] 物理连接上线，分配临时 ID: ${tempConnId}`);
            this.connections.add(ws);

            const pingTimer = setInterval(() => {
                if (Date.now() - meta.lastPongTime > PING_INTERVAL_MS * 2) {
                    ctx.logger.warn(`[WsChannel] 连接心跳超时，强制终止，连接ID: ${meta.connId}`);
                    ws.terminate();
                    return;
                }
                if (ws.readyState === WebSocket.OPEN) ws.ping();
            }, PING_INTERVAL_MS);

            const meta: WsConnectionMeta = {
                ws,
                connId: tempConnId,
                clientId: undefined,
                pingTimer,
                lastPongTime: Date.now()
            };
            this.wsMetaMap.set(tempConnId, meta);
            ctx.eventBus.emit('connection:active', { connectionId: tempConnId, defaultSessionId: 'main', staleThresholdMs: 300000 });

            ws.on('pong', () => {
                meta.lastPongTime = Date.now();
                ctx.eventBus.emit('connection:active', { connectionId: meta.connId, staleThresholdMs: 300000 });
            });

            ws.send(JSON.stringify({
                event: 'server:connected',
                data: {
                    message: '已成功与 Freya 后端服务建立 WebSocket 链接。',
                    connectionId: tempConnId
                }
            }));

            ws.on('message', (messageData) => {
                try {
                    const payload = JSON.parse(messageData.toString());
                    ctx.eventBus.emit('connection:active', { connectionId: meta.connId, staleThresholdMs: 300000 });
                    meta.lastPongTime = Date.now();

                    if (payload.event === 'client:reconnect') {
                        const { clientId } = payload.data || {};
                        if (clientId && typeof clientId === 'string' && clientId.length > 0) {
                            this.handleReconnect(ctx, meta, clientId);
                        }
                        return;
                    }

                    if (payload.event === 'client:message') {
                        const { content } = payload.data || {};

                        const messagePayload = {
                            connectionId: meta.connId,
                            content: content,
                            defaultSessionId: 'main'
                        };
                        ctx.eventBus.emit('connection:message', messagePayload);
                    } else if (payload.event === 'client:interrupt') {
                        ctx.logger.info(`[WsChannel] 收到中断生成指令，会话 ID: ${payload.data?.sessionId}`);
                        ctx.eventBus.emit('session:interrupt', payload.data);
                    }
                } catch (err) {
                    ctx.logger.error('[WsChannel] 解析客户端消息失败:', err);
                }
            });

            ws.on('close', () => {
                ctx.logger.info(`[WsChannel] 物理连接断开，ID: ${meta.connId}`);
                this.cleanupConnection(ctx, meta);
            });

            ws.on('error', () => {
                ctx.logger.debug(`[WsChannel] 连接异常，ID: ${meta.connId}`);
            });
        });
    }

    private handleReconnect(ctx: FreyaContext, meta: WsConnectionMeta, clientId: string): void {
        const stableConnId = `${WSS_HANDLER_ID}:${clientId}`;
        if (meta.connId === stableConnId) return;

        const oldMeta = this.wsMetaMap.get(stableConnId);
        if (oldMeta && oldMeta.ws !== meta.ws) {
            ctx.logger.info(`[WsChannel] 发现挂起的旧物理连接，强制物理释放资源...`);
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
        ctx.eventBus.emit('connection:active', { connectionId: stableConnId, defaultSessionId: 'main', staleThresholdMs: 300000 });

        ctx.logger.info(`[WsChannel] 客户端断线重连成功，clientId: ${clientId}, 连接ID: ${stableConnId}`);

        if (meta.ws.readyState === WebSocket.OPEN) {
            meta.ws.send(JSON.stringify({
                event: 'server:reconnected',
                data: { connectionId: stableConnId, sessionId: `session-${clientId}`, recovered: true }
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

            if (!meta.clientId) {
                ctx.eventBus.emit('connection:inactive', { connectionId: meta.connId });
            } else {
                const timer = setTimeout(() => {
                    ctx.eventBus.emit('connection:inactive', { connectionId: meta.connId });
                    this.reconnectTimers.delete(meta.connId);
                }, RECONNECT_TIMEOUT_MS);
                this.reconnectTimers.set(meta.connId, timer);
            }
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

    private handleConnectionReply = (payload: { connectionId: string; content: string }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: 'server:reply',
                        data: { role: 'assistant', text: payload.content }
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] 发送 server:reply 失败: ${err.message}`);
                }
            }
        }
    };

    private handleConnectionReplyDelta = (payload: { connectionId: string; text: string }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: 'server:delta',
                        data: { role: 'assistant', text: payload.text }
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] 发送 server:delta 失败: ${err.message}`);
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
                    this.ctx?.logger.error(`[WsChannel] 发送自定义事件 ${payload.event} 失败: ${err.message}`);
                }
            }
        }
    };

    private handleConnectionReplyCompleted = (payload: { connectionId: string }) => {
        if (payload.connectionId.startsWith(WSS_HANDLER_ID)) {
            const meta = this.wsMetaMap.get(payload.connectionId);
            if (meta && meta.ws.readyState === WebSocket.OPEN) {
                try {
                    meta.ws.send(JSON.stringify({
                        event: 'server:completed',
                        data: {}
                    }));
                } catch (err: any) {
                    this.ctx?.logger.error(`[WsChannel] 发送 server:completed 失败: ${err.message}`);
                }
            }
        }
    };
}
