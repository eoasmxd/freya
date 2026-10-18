import { McpAuthRequiredError, McpConnectionError } from '../types.js';

/**
 * 原生 Streamable HTTP 传输协议实现
 * Native Streamable HTTP client transport implementation for MCP
 */
export class StreamableHttpTransport {
  private sessionId?: string;
  private readonly protocolVersion = '2025-06-18';
  private nextRequestId = 1;

  constructor(
    private readonly url: string,
    private readonly getHeaders: () => Promise<Record<string, string>>,
    private readonly timeoutMs: number = 30000,
    private readonly onUnauthorized?: () => Promise<boolean>
  ) { }

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

    const requestId = this.nextRequestId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
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
        if (this.onUnauthorized) {
          const refreshed = await this.onUnauthorized().catch(() => false);
          if (refreshed) {
            const retryAuthHeaders = await this.getHeaders();
            const retryHeaders: Record<string, string> = {
              ...headers,
              ...retryAuthHeaders
            };
            const retryRes = await fetch(this.url, {
              method: 'POST',
              headers: retryHeaders,
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: requestId,
                method,
                params
              }),
              signal: controller.signal
            });
            const retrySessionId = retryRes.headers.get('mcp-session-id');
            if (retrySessionId) {
              this.sessionId = retrySessionId;
            }
            if (retryRes.ok) {
              const retryContentType = retryRes.headers.get('content-type') || '';
              if (retryContentType.includes('text/event-stream')) {
                return await this.parseSseStream(retryRes.body, requestId);
              }
              const retryData: any = await retryRes.json();
              if (retryData.error) {
                throw new Error(`RPC Error [${retryData.error.code}]: ${retryData.error.message}`);
              }
              return retryData.result;
            }
            if (retryRes.status === 401) {
              const retryAuthHeader = retryRes.headers.get('www-authenticate') || undefined;
              const retryResponseBody = await retryRes.text().catch(() => undefined);
              throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`, retryAuthHeader, retryResponseBody);
            }
            const retryErrorText = await retryRes.text().catch(() => '');
            throw new Error(`HTTP ${retryRes.status}: ${retryErrorText.slice(0, 300)}`);
          }
        }
        const authHeader = res.headers.get('www-authenticate') || undefined;
        const responseBody = await res.text().catch(() => undefined);
        throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`, authHeader, responseBody);
      }

      if (res.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new McpConnectionError(`Session expired or not found on ${this.url}`);
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 300)}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        return await this.parseSseStream(res.body, requestId);
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
        throw new McpConnectionError(`Session expired or not found on ${this.url}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析 SSE 数据流并提取与请求 id 匹配的 JSON-RPC 结果或错误
   * Parse SSE data stream and extract JSON-RPC result or error matching the request id
   */
  private async parseSseStream(body: ReadableStream<Uint8Array> | null, requestId: number): Promise<any> {
    if (!body) {
      return undefined;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let lastResult: any = undefined;
    let rpcError: Error | undefined;

    let currentEventData: string[] = [];

    const processEvent = (): boolean => {
      if (currentEventData.length === 0) return false;
      const jsonStr = currentEventData.join('\n').trim();
      currentEventData = [];
      if (!jsonStr) return false;

      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed?.id !== requestId) {
          return false;
        }
        if (parsed.error) {
          rpcError = new Error(`RPC Error [${parsed.error.code}]: ${parsed.error.message}`);
          return true;
        } else if (parsed.result !== undefined) {
          lastResult = parsed.result;
          return true;
        }
      } catch { }
      return false;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.replace(/\r$/, '');
          if (trimmed === '') {
            if (processEvent()) {
              break;
            }
          } else if (trimmed.startsWith('data:')) {
            currentEventData.push(trimmed.slice(5).trimStart());
          }
        }
        if (rpcError || lastResult !== undefined) {
          await reader.cancel().catch(() => { });
          break;
        }
      }

      if (!rpcError && lastResult === undefined) {
        processEvent();
      }
    } finally {
      reader.releaseLock();
    }

    if (rpcError) {
      throw rpcError;
    }

    return lastResult;
  }

  /**
   * 关闭连接并通过 HTTP DELETE 释放远端服务端持有的会话
   * Disconnect transport and release remote server session via HTTP DELETE
   */
  async disconnect(): Promise<void> {
    const activeSessionId = this.sessionId;
    this.sessionId = undefined;
    if (!activeSessionId) {
      return;
    }

    try {
      const authHeaders = await this.getHeaders().catch(() => ({}));
      await fetch(this.url, {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': activeSessionId,
          'MCP-Protocol-Version': this.protocolVersion,
          ...authHeaders
        },
        signal: AbortSignal.timeout(3000)
      });
    } catch { }
  }
}
