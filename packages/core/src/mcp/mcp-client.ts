import { McpAuthRequiredError, McpConnectionError, type McpServerConfig, type McpToolSchema, type McpTransport } from './types.js';
import { StreamableHttpTransport } from './transport/streamable-http.js';
import { LegacySseTransport } from './transport/sse-legacy.js';

const MAX_LIST_PAGES = 64;

/**
 * 单个 MCP 远程服务客户端会话封装（连接、空闲自动断开与方法调用）
 * Dedicated remote MCP client session managing lazy connection, idle timeout and RPC
 */
export class McpClientSession {
  private transport?: McpTransport;
  private idleTimer?: NodeJS.Timeout;
  private connectingPromise?: Promise<McpTransport>;
  private preferredTransportType?: 'streamable-http' | 'sse';
  private serverInstructions?: string;
  private serverInfo?: any;

  constructor(
    private readonly config: McpServerConfig,
    private readonly headerProvider?: () => Promise<Record<string, string>>,
    private readonly refreshProvider?: () => Promise<boolean>
  ) {}

  /**
   * 重置空闲自动断开计时器
   * Reset idle timeout timer
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    const timeout = this.config.idleTimeoutMs || 300000;
    this.idleTimer = setTimeout(() => {
      this.disconnect().catch(() => {});
    }, timeout);
    this.idleTimer.unref?.();
  }

  private isLegacyDowngradeError(err: any): boolean {
    if (!(err instanceof McpConnectionError) && err?.name !== 'McpConnectionError') {
      return false;
    }
    const status = err?.options?.httpStatus;
    return (status === 400 || status === 404 || status === 405) && err?.options?.isJsonRpcError !== true;
  }

  private isSessionExpiredError(err: any): boolean {
    return (err instanceof McpConnectionError || err?.name === 'McpConnectionError') && Boolean(err?.options?.isSessionExpired);
  }

  /**
   * 建立连接并握手（含单飞锁与旧版 HTTP+SSE 自动降级）
   * Ensure connection is established and perform handshake with singleflight lock and legacy SSE fallback
   */
  async ensureConnected(): Promise<McpTransport> {
    if (this.transport) {
      this.resetIdleTimer();
      return this.transport;
    }

    if (this.connectingPromise) {
      return await this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      const getHeaders = this.headerProvider || (async () => ({}));

      const connectWithTransport = async (transport: McpTransport): Promise<McpTransport> => {
        try {
          const initResult = await transport.sendJsonRpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: {
              name: 'freya-mcp-client',
              version: '1.0.0'
            }
          });
          this.serverInstructions = typeof initResult?.instructions === 'string' ? initResult.instructions : undefined;
          this.serverInfo = initResult?.serverInfo;

          if (typeof initResult?.protocolVersion === 'string' && initResult.protocolVersion.trim()) {
            transport.setProtocolVersion?.(initResult.protocolVersion.trim());
          }

          await transport.sendJsonRpcNotification('notifications/initialized').catch(() => {});

          this.transport = transport;
          this.resetIdleTimer();
          return this.transport;
        } catch (err) {
          await transport.disconnect().catch(() => {});
          throw err;
        }
      };

      if (this.preferredTransportType === 'sse') {
        const legacyTransport = new LegacySseTransport(this.config.url, getHeaders, this.config.timeoutMs, this.refreshProvider);
        return await connectWithTransport(legacyTransport);
      }

      const streamableTransport = new StreamableHttpTransport(this.config.url, getHeaders, this.config.timeoutMs, this.refreshProvider);
      try {
        const connected = await connectWithTransport(streamableTransport);
        this.preferredTransportType = 'streamable-http';
        return connected;
      } catch (err) {
        if (this.isLegacyDowngradeError(err)) {
          const legacyTransport = new LegacySseTransport(this.config.url, getHeaders, this.config.timeoutMs, this.refreshProvider);
          const connected = await connectWithTransport(legacyTransport);
          this.preferredTransportType = 'sse';
          return connected;
        }
        throw err;
      }
    })().catch(async (err) => {
      await this.disconnect();
      throw err;
    }).finally(() => {
      this.connectingPromise = undefined;
    });

    return await this.connectingPromise;
  }

  /**
   * 执行远程 RPC 并在会话过期（404）时透明重握重试一次
   * Execute RPC operation and transparently reconnect and retry once on 404 session expiration
   */
  private async executeWithSessionRetry<T>(operation: (transport: McpTransport) => Promise<T>): Promise<T> {
    const transport = await this.ensureConnected();
    try {
      return await operation(transport);
    } catch (err: any) {
      if (this.isSessionExpiredError(err)) {
        if (this.transport === transport) {
          await this.disconnect();
        }
        const retryTransport = await this.ensureConnected();
        return await operation(retryTransport);
      }
      throw err;
    }
  }

  /**
   * 拉取远程工具清单
   * Retrieve list of tools from remote server
   */
  async listTools(): Promise<{ tools: McpToolSchema[]; instructions?: string; serverInfo?: any }> {
    try {
      return await this.executeWithSessionRetry(async (transport) => {
        const tools: McpToolSchema[] = [];
        const visitedCursors = new Set<string>();
        let cursor: string | undefined;
        let pageCount = 0;

        do {
          if (++pageCount > MAX_LIST_PAGES) {
            break;
          }
          const result = await transport.sendJsonRpc('tools/list', cursor ? { cursor } : undefined);
          if (Array.isArray(result?.tools)) {
            tools.push(...result.tools);
          }
          const nextCursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
          if (nextCursor && visitedCursors.has(nextCursor)) {
            break;
          }
          if (nextCursor) {
            visitedCursors.add(nextCursor);
          }
          cursor = nextCursor;
        } while (cursor);

        return {
          tools,
          instructions: this.serverInstructions,
          serverInfo: this.serverInfo
        };
      });
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  /**
   * 执行远程工具
   * Call remote tool with arguments
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    try {
      return await this.executeWithSessionRetry(async (transport) => {
        return await transport.sendJsonRpc('tools/call', {
          name,
          arguments: args
        });
      });
    } catch (err: any) {
      if (
        err instanceof McpConnectionError ||
        err?.name === 'McpConnectionError' ||
        err instanceof McpAuthRequiredError ||
        err?.name === 'McpAuthRequiredError'
      ) {
        await this.disconnect();
      }
      throw err;
    }
  }

  /**
   * 断开当前连接会话
   * Disconnect active transport session
   */
  async disconnect(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.transport) {
      await this.transport.disconnect().catch(() => {});
      this.transport = undefined;
    }
  }
}
