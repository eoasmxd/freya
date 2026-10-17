import type { McpServerConfig, McpToolSchema } from './types.js';
import { StreamableHttpTransport } from './transport/streamable-http.js';

/**
 * 单个 MCP 远程服务客户端会话封装（连接、空闲自动断开与方法调用）
 * Dedicated remote MCP client session managing lazy connection, idle timeout and RPC
 */
export class McpClientSession {
  private transport?: StreamableHttpTransport;
  private idleTimer?: NodeJS.Timeout;
  private isConnecting = false;
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

  /**
   * 建立连接并握手
   * Ensure connection is established and perform handshake
   */
  async ensureConnected(): Promise<StreamableHttpTransport> {
    if (this.transport) {
      this.resetIdleTimer();
      return this.transport;
    }

    if (this.isConnecting) {
      await new Promise((r) => setTimeout(r, 200));
      return this.ensureConnected();
    }

    this.isConnecting = true;
    try {
      const getHeaders = this.headerProvider || (async () => ({}));
      const transport = new StreamableHttpTransport(this.config.url, getHeaders, this.config.timeoutMs, this.refreshProvider);

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

      await transport.sendJsonRpcNotification('notifications/initialized').catch(() => {});

      this.transport = transport;
      this.resetIdleTimer();
      return this.transport;
    } catch (err) {
      await this.disconnect();
      throw err;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * 拉取远程工具清单
   * Retrieve list of tools from remote server
   */
  async listTools(): Promise<{ tools: McpToolSchema[]; instructions?: string; serverInfo?: any }> {
    try {
      const transport = await this.ensureConnected();
      const tools: McpToolSchema[] = [];
      const visitedCursors = new Set<string>();
      let cursor: string | undefined;

      do {
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
      const transport = await this.ensureConnected();
      return await transport.sendJsonRpc('tools/call', {
        name,
        arguments: args
      });
    } catch (err) {
      await this.disconnect();
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
