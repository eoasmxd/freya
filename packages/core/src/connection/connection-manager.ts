import type { EventBus, Logger } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';

/** 物理连接与逻辑会话映射管理器 */
export class FreyaConnectionManager {
  private connectionToSession = new Map<string, string>();
  private lastActiveTime = new Map<string, number>();
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

  private resolveOrCreateSessionId(connectionId: string, defaultSessionId?: string): string {
    let sessionId = this.connectionToSession.get(connectionId);
    if (sessionId) {
      return sessionId;
    }

    if (defaultSessionId) {
      this.register(connectionId, defaultSessionId);
      return defaultSessionId;
    }

    const suffix = connectionId.split(':')[1] || crypto.randomUUID();
    sessionId = `session-${suffix}`;
    this.register(connectionId, sessionId);
    return sessionId;
  }

  private initEventListeners(): void {
    this.eventBus.on('connection:active', (payload: { connectionId: string; defaultSessionId?: string }) => {
      this.touch(payload.connectionId);
      this.resolveOrCreateSessionId(payload.connectionId, payload.defaultSessionId);
    });

    this.eventBus.on('connection:inactive', (payload: { connectionId: string }) => {
      this.unregister(payload.connectionId);
    });

    this.eventBus.on('connection:message', (payload: { connectionId: string; content: string; defaultSessionId?: string; attachments?: any[] }) => {
      this.touch(payload.connectionId);
      const sessionId = this.resolveOrCreateSessionId(payload.connectionId, payload.defaultSessionId);
      this.eventBus.emit('session:input', {
        ...payload,
        sessionId
      });
    });

    this.eventBus.on('connection:rebind', (payload: { connectionId: string; sessionId: string }) => {
      this.rebind(payload.connectionId, payload.sessionId);
    });

    this.eventBus.on('session:reply:text', (payload: { sessionId: string; content: string }) => {
      const conns = this.getConnectionsBySession(payload.sessionId);
      for (const connId of conns) {
        this.eventBus.emit('connection:reply', { connectionId: connId, content: payload.content });
      }
    });

    this.eventBus.on('session:reply:delta', (payload: { sessionId: string; text: string }) => {
      const conns = this.getConnectionsBySession(payload.sessionId);
      for (const connId of conns) {
        this.eventBus.emit('connection:reply:delta', { connectionId: connId, text: payload.text });
      }
    });

    this.eventBus.on('session:reply:error', (payload: { sessionId: string; message: string }) => {
      const conns = this.getConnectionsBySession(payload.sessionId);
      for (const connId of conns) {
        this.eventBus.emit('connection:reply', { connectionId: connId, content: payload.message });
      }
    });

    this.eventBus.on('session:reply:completed', (payload: { sessionId: string }) => {
      const conns = this.getConnectionsBySession(payload.sessionId);
      for (const connId of conns) {
        this.eventBus.emit('connection:reply:completed', { connectionId: connId });
      }
    });

    this.eventBus.on('tool:status', (payload: { sessionId: string;[key: string]: any }) => {
      const conns = this.getConnectionsBySession(payload.sessionId);
      for (const connId of conns) {
        this.eventBus.emit('connection:event', { connectionId: connId, event: 'server:tool_status', data: payload });
      }
    });

    this.eventBus.on('session:billing:update', (payload: { sessionId: string; [key: string]: any }) => {
      const conns = this.getConnectionsBySession(payload.sessionId);
      for (const connId of conns) {
        this.eventBus.emit('connection:event', { connectionId: connId, event: 'server:billing', data: payload });
      }
    });
  }

  register(connectionId: string, sessionId: string): void {
    this.connectionToSession.set(connectionId, sessionId);
    this.lastActiveTime.set(connectionId, Date.now());
  }

  unregister(connectionId: string): void {
    this.connectionToSession.delete(connectionId);
    this.lastActiveTime.delete(connectionId);
    this.logger?.debug(`[FreyaConnectionManager] 连接 "${connectionId}" 已注销并清理活跃历史。`);
  }

  touch(connectionId: string): void {
    this.lastActiveTime.set(connectionId, Date.now());
  }

  rebind(connectionId: string, newSessionId: string): void {
    this.connectionToSession.set(connectionId, newSessionId);
    this.logger?.info(`[FreyaConnectionManager] 连接 "${connectionId}" 已重定向绑定到会话 "${newSessionId}"`);
  }

  getConnectionsBySession(sessionId: string): string[] {
    const result: string[] = [];
    for (const [connId, boundSessionId] of this.connectionToSession) {
      if (boundSessionId === sessionId) {
        result.push(connId);
      }
    }
    return result;
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
    for (const [connId, lastActive] of this.lastActiveTime) {
      if (now - lastActive > this.staleThresholdMs) {
        toRemove.push(connId);
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
