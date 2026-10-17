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

  constructor(
    private readonly config: McpServerConfig,
    private readonly headerProvider?: () => Promise<Record<string, string>>
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
      const transport = new StreamableHttpTransport(this.config.url, getHeaders, this.config.timeoutMs);

      await transport.sendJsonRpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'freya-mcp-client',
          version: '1.0.0'
        }
      });

      await transport.sendJsonRpc('notifications/initialized').catch(() => {});

      this.transport = transport;
      this.resetIdleTimer();
      return this.transport;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * 拉取远程工具清单
   * Retrieve list of tools from remote server
   */
  async listTools(): Promise<{ tools: McpToolSchema[]; instructions?: string; serverInfo?: any }> {
    const transport = await this.ensureConnected();
    const result = await transport.sendJsonRpc('tools/list');

    return {
      tools: Array.isArray(result?.tools) ? result.tools : [],
      instructions: result?.instructions,
      serverInfo: result?.serverInfo
    };
  }

  /**
   * 执行远程工具
   * Call remote tool with arguments
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    const transport = await this.ensureConnected();
    return await transport.sendJsonRpc('tools/call', {
      name,
      arguments: args
    });
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
    this.transport = undefined;
  }
}
