import type { EventBus, Logger } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';

interface ConnectionRecord {
  connectionId: string;
  sessionId: string;
  lastActiveTime: number;
  staleThresholdMs?: number;
  channelType?: string;
  language?: string;
}

/** 物理连接与逻辑会话映射管理器 */
export class FreyaConnectionManager {
  private connections = new Map<string, ConnectionRecord>();
  private sweepInterval?: ReturnType<typeof setInterval>;
  private staleThresholdMs = 120_000;
  private sweepIntervalMs = 30_000;

  constructor(
    private eventBus: EventBus,
    private logger?: Logger
  ) {
    this.initEventListeners();
    this.startSweep();
  }

  private initEventListeners(): void {
    this.eventBus.on('connection:active', (payload: { connectionId: string; defaultSessionId?: string; staleThresholdMs?: number; channelType?: string; defaultLanguage?: string }) => {
      this.bindSession(payload.connectionId, payload.defaultSessionId, payload, false);
    });

    this.eventBus.on('connection:inactive', (payload: { connectionId: string }) => {
      this.unregister(payload.connectionId);
    });

    this.eventBus.on('connection:message', (payload: { connectionId: string; content: string; defaultSessionId?: string; attachments?: any[]; channelType?: string; defaultLanguage?: string }) => {
      const sessionId = this.bindSession(payload.connectionId, payload.defaultSessionId, payload, false);
      const record = this.connections.get(payload.connectionId);
      this.eventBus.emit('session:input', {
        ...payload,
        sessionId,
        channelType: payload.channelType || record?.channelType,
        defaultLanguage: payload.defaultLanguage || record?.language
      });
    });

    this.eventBus.on('connection:rebind', (payload: { connectionId: string; sessionId: string; channelType?: string; defaultLanguage?: string; staleThresholdMs?: number }) => {
      this.bindSession(payload.connectionId, payload.sessionId, payload, true);
      this.logger?.info(`[FreyaConnectionManager] 连接 "${payload.connectionId}" 已重定向绑定到会话 "${payload.sessionId}"`);
    });

    this.eventBus.on('session:reply:text', (payload: { sessionId: string; content: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply', (connId) => ({ connectionId: connId, content: payload.content }));
    });

    this.eventBus.on('session:reply:delta', (payload: { sessionId: string; text: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply:delta', (connId) => ({ connectionId: connId, text: payload.text }));
    });

    this.eventBus.on('session:reply:error', (payload: { sessionId: string; message: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply', (connId) => ({ connectionId: connId, content: payload.message }));
    });

    this.eventBus.on('session:reply:completed', (payload: { sessionId: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply:completed', (connId) => ({ connectionId: connId }));
    });

    this.eventBus.on('tool:status', (payload: { sessionId: string;[key: string]: any }) => {
      this.broadcastToSession(payload.sessionId, 'connection:event', (connId) => ({ connectionId: connId, event: 'server:tool_status', data: payload }));
    });

    this.eventBus.on('session:billing:update', (payload: { sessionId: string; [key: string]: any }) => {
      this.broadcastToSession(payload.sessionId, 'connection:event', (connId) => ({ connectionId: connId, event: 'server:billing', data: payload }));
    });

    this.eventBus.on('config:language_changed', (payload: { language: string }) => {
      for (const record of this.connections.values()) {
        const effectiveLanguage = payload.language === 'auto' ? (record.language || 'en') : payload.language;
        this.eventBus.emit('connection:event', {
          connectionId: record.connectionId,
          event: 'server:language_changed',
          data: { language: effectiveLanguage }
        });
      }
    });
  }

  private bindSession(
    connectionId: string,
    sessionId?: string,
    extra?: { channelType?: string; defaultLanguage?: string; staleThresholdMs?: number },
    forceRebind = false
  ): string {
    const existing = this.connections.get(connectionId);
    if (existing) {
      if (forceRebind && sessionId) existing.sessionId = sessionId;
      existing.lastActiveTime = Date.now();
      if (extra?.channelType) existing.channelType = extra.channelType;
      if (extra?.defaultLanguage) existing.language = extra.defaultLanguage;
      if (typeof extra?.staleThresholdMs === 'number') existing.staleThresholdMs = extra.staleThresholdMs;
      return existing.sessionId;
    }

    const targetSessionId = sessionId || `session-${connectionId.split(':')[1] || crypto.randomUUID()}`;
    this.connections.set(connectionId, {
      connectionId,
      sessionId: targetSessionId,
      lastActiveTime: Date.now(),
      staleThresholdMs: extra?.staleThresholdMs,
      channelType: extra?.channelType,
      language: extra?.defaultLanguage
    });
    return targetSessionId;
  }

  private unregister(connectionId: string): void {
    this.connections.delete(connectionId);
    this.logger?.debug(`[FreyaConnectionManager] 连接 "${connectionId}" 已注销并清理活跃历史。`);
  }

  private broadcastToSession(sessionId: string, event: string, buildPayload: (connId: string) => any): void {
    for (const record of this.connections.values()) {
      if (record.sessionId === sessionId) {
        this.eventBus.emit(event, buildPayload(record.connectionId));
      }
    }
  }

  private startSweep(): void {
    if (this.sweepInterval) return;
    this.sweepInterval = setInterval(() => {
      this.sweep();
    }, this.sweepIntervalMs);
  }

  private sweep(): void {
    const now = Date.now();
    const toRemove: string[] = [];
    for (const record of this.connections.values()) {
      const threshold = typeof record.staleThresholdMs === 'number'
        ? record.staleThresholdMs
        : this.staleThresholdMs;

      if (threshold <= 0 || threshold === Infinity) {
        continue;
      }

      if (now - record.lastActiveTime > threshold) {
        toRemove.push(record.connectionId);
      }
    }
    for (const connId of toRemove) {
      this.unregister(connId);
      this.logger?.info(`[FreyaConnectionManager] 连接 "${connId}" 因长时间无心跳活跃已被自动剔除注销。`);
    }
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
  }
}
