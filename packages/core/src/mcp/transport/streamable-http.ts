import { McpAuthRequiredError, McpConnectionError } from '../types.js';

/**
 * 原生 Streamable HTTP 传输协议实现
 * Native Streamable HTTP client transport implementation for MCP
 */
export class StreamableHttpTransport {
  private sessionId?: string;
  private readonly protocolVersion = '2025-06-18';

  constructor(
    private readonly url: string,
    private readonly getHeaders: () => Promise<Record<string, string>>,
    private readonly timeoutMs: number = 30000
  ) {}

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  setSessionId(sessionId: string | undefined): void {
    this.sessionId = sessionId;
  }

  /**
   * 发送 JSON-RPC 2.0 请求
   * Send JSON-RPC 2.0 request
   */
  async sendJsonRpc(method: string, params?: any): Promise<any> {
    const authHeaders = await this.getHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
      ...authHeaders
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        }),
        signal: controller.signal
      });

      const newSessionId = res.headers.get('mcp-session-id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      if (res.status === 401) {
        throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`);
      }

      if (res.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new Error('Session expired');
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 300)}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        return await this.parseSseStream(res.body);
      }

      const data: any = await res.json();
      if (data.error) {
        throw new Error(`RPC Error [${data.error.code}]: ${data.error.message}`);
      }
      return data.result;
    } catch (err: any) {
      if (err instanceof McpAuthRequiredError) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new McpConnectionError(`Request to ${this.url} timed out after ${this.timeoutMs}ms`);
      }
      if (err.cause?.code || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        throw new McpConnectionError(`Failed to connect to ${this.url}: ${err.message}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 发送 JSON-RPC 2.0 通知（不包含 id 字段）
   * Send JSON-RPC 2.0 notification without id member
   */
  async sendJsonRpcNotification(method: string, params?: any): Promise<void> {
    const authHeaders = await this.getHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.protocolVersion,
      ...authHeaders
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params
        }),
        signal: controller.signal
      });

      const newSessionId = res.headers.get('mcp-session-id');
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      if (res.status === 401) {
        throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`);
      }
      if (res.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new Error('Session expired');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析 SSE 数据流并提取 JSON-RPC 结果或错误
   * Parse SSE data stream and extract JSON-RPC result or throw error
   */
  private async parseSseStream(body: ReadableStream<Uint8Array> | null): Promise<any> {
    if (!body) {
      return undefined;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let lastResult: any = undefined;
    let rpcError: Error | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (jsonStr) {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.error) {
                  rpcError = new Error(`RPC Error [${parsed.error.code}]: ${parsed.error.message}`);
                } else if (parsed.result !== undefined) {
                  lastResult = parsed.result;
                }
              } catch {}
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (rpcError) {
      throw rpcError;
    }

    return lastResult;
  }
}
