import type { EventBus, Logger } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';

interface ConnectionRecord {
  connectionId: string;
  sessionId: string;
  subscribedSessions: Set<string>;
  lastActiveTime: number;
  staleThresholdMs?: number;
  channelType?: string;
  language?: string;
}

/**
 * 物理连接与逻辑会话映射管理器
 * Manager for physical connection and logical session mappings
 */
export class FreyaConnectionManager {
  private connections = new Map<string, ConnectionRecord>();
  private transientLeases = new Map<string, Set<string>>();
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

    this.eventBus.on('connection:message', (payload: {
      connectionId: string;
      content: string;
      sessionId?: string;
      defaultSessionId?: string;
      ephemeral?: boolean;
      attachments?: any[];
      channelType?: string;
      defaultLanguage?: string;
      activeToolboxIds?: string[];
      activeSkillId?: string;
    }) => {
      this.bindSession(payload.connectionId, payload.defaultSessionId, payload, false);
      const record = this.connections.get(payload.connectionId)!;
      const targetSessionId = payload.sessionId || record.sessionId;

      if (payload.ephemeral) {
        let conns = this.transientLeases.get(targetSessionId);
        if (!conns) {
          conns = new Set<string>();
          this.transientLeases.set(targetSessionId, conns);
        }
        conns.add(payload.connectionId);
      } else if (targetSessionId !== record.sessionId) {
        record.subscribedSessions.add(targetSessionId);
      }

      this.eventBus.emit('session:input', {
        ...payload,
        sessionId: targetSessionId,
        ephemeral: payload.ephemeral,
        channelType: payload.channelType || record.channelType,
        defaultLanguage: payload.defaultLanguage || record.language
      });
    });

    this.eventBus.on('connection:interrupt', (payload: { connectionId: string; sessionId?: string }) => {
      const record = this.connections.get(payload.connectionId);
      const targetSessionId = payload.sessionId || record?.sessionId;
      if (targetSessionId) {
        this.eventBus.emit('session:interrupt', { sessionId: targetSessionId });
      }
    });

    this.eventBus.on('connection:rebind', (payload: { connectionId: string; sessionId: string; channelType?: string; defaultLanguage?: string; staleThresholdMs?: number }) => {
      this.bindSession(payload.connectionId, payload.sessionId, payload, true);
      this.logger?.info(`[FreyaConnectionManager] Connection "${payload.connectionId}" rebound to session "${payload.sessionId}"`);
    });

    this.eventBus.on('session:reply:text', (payload: { sessionId: string; content: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply', (connId) => ({
        connectionId: connId,
        content: payload.content,
        sessionId: payload.sessionId
      }));
    });

    this.eventBus.on('session:reply:delta', (payload: { sessionId: string; text: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply:delta', (connId) => ({
        connectionId: connId,
        text: payload.text,
        sessionId: payload.sessionId
      }));
    });

    this.eventBus.on('session:reply:error', (payload: { sessionId: string; message: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply', (connId) => ({
        connectionId: connId,
        content: payload.message,
        sessionId: payload.sessionId
      }));
      this.transientLeases.delete(payload.sessionId);
    });

    this.eventBus.on('session:reply:completed', (payload: { sessionId: string }) => {
      this.broadcastToSession(payload.sessionId, 'connection:reply:completed', (connId) => ({
        connectionId: connId,
        sessionId: payload.sessionId
      }));
      this.transientLeases.delete(payload.sessionId);
    });

    this.eventBus.on('tool:status', (payload: { sessionId: string;[key: string]: any }) => {
      this.broadcastToSession(payload.sessionId, 'connection:event', (connId) => ({
        connectionId: connId,
        event: 'server:tool_status',
        data: payload
      }));
    });

    this.eventBus.on('session:billing:update', (payload: { sessionId: string;[key: string]: any }) => {
      this.broadcastToSession(payload.sessionId, 'connection:event', (connId) => ({
        connectionId: connId,
        event: 'server:billing',
        data: payload
      }));
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
      subscribedSessions: new Set<string>(),
      lastActiveTime: Date.now(),
      staleThresholdMs: extra?.staleThresholdMs,
      channelType: extra?.channelType,
      language: extra?.defaultLanguage
    });
    return targetSessionId;
  }

  private unregister(connectionId: string): void {
    this.connections.delete(connectionId);
    for (const [sessionId, conns] of this.transientLeases.entries()) {
      conns.delete(connectionId);
      if (conns.size === 0) {
        this.transientLeases.delete(sessionId);
      }
    }
  }

  private broadcastToSession(sessionId: string, event: string, buildPayload: (connId: string) => any): void {
    const sentConns = new Set<string>();

    for (const record of this.connections.values()) {
      if (record.sessionId === sessionId || record.subscribedSessions.has(sessionId)) {
        sentConns.add(record.connectionId);
        this.eventBus.emit(event, buildPayload(record.connectionId));
      }
    }

    const transientConns = this.transientLeases.get(sessionId);
    if (transientConns) {
      for (const connId of transientConns) {
        if (!sentConns.has(connId)) {
          sentConns.add(connId);
          this.eventBus.emit(event, buildPayload(connId));
        }
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
      this.logger?.info(`[FreyaConnectionManager] Connection "${connId}" unregistered due to heartbeat inactivity timeout.`);
    }
  }

  stop(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = undefined;
    }
    this.transientLeases.clear();
  }
}
