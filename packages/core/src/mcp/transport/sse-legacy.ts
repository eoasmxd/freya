import { McpAuthRequiredError, McpConnectionError, type McpTransport } from '../types.js';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * 旧版 HTTP+SSE（MCP 2024-11-05）传输协议客户端实现
 * Legacy HTTP+SSE (MCP 2024-11-05) client transport implementation
 */
export class LegacySseTransport implements McpTransport {
  private postEndpoint?: string;
  private sseAbortController?: AbortController;
  private connectPromise?: Promise<string>;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();

  constructor(
    private readonly url: string,
    private readonly getHeaders: () => Promise<Record<string, string>>,
    private readonly timeoutMs: number = 30000,
    private readonly onUnauthorized?: () => Promise<boolean>
  ) {}

  /**
   * 建立长连接 SSE 流并等待服务端下发 POST endpoint 地址
   * Establish persistent SSE stream and wait for server-sent POST endpoint event
   */
  private async ensureSseConnected(): Promise<string> {
    if (this.postEndpoint && this.sseAbortController && !this.sseAbortController.signal.aborted) {
      return this.postEndpoint;
    }

    if (this.connectPromise) {
      return await this.connectPromise;
    }

    this.connectPromise = (async () => {
      const controller = new AbortController();
      this.sseAbortController = controller;

      const authHeaders = await this.getHeaders();
      let res = await this.fetchSseStream(authHeaders, controller.signal);

      if (res.status === 401 && this.onUnauthorized) {
        await res.body?.cancel().catch(() => {});
        const refreshed = await this.onUnauthorized().catch(() => false);
        if (refreshed) {
          const retryAuthHeaders = await this.getHeaders();
          res = await this.fetchSseStream(retryAuthHeaders, controller.signal);
        }
      }

      if (res.status === 401) {
        const authHeader = res.headers.get('www-authenticate') || undefined;
        const responseBody = await res.text().catch(() => undefined);
        throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`, authHeader, responseBody);
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new McpConnectionError(`HTTP ${res.status}: ${errorText.slice(0, 300)}`, { httpStatus: res.status });
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream') || !res.body) {
        throw new McpConnectionError(`Expected text/event-stream from legacy SSE endpoint ${this.url}`);
      }

      return await new Promise<string>((resolveEndpoint, rejectEndpoint) => {
        let endpointResolved = false;
        const handshakeTimer = setTimeout(() => {
          if (!endpointResolved) {
            endpointResolved = true;
            controller.abort();
            rejectEndpoint(new McpConnectionError(`Timed out waiting for endpoint event from ${this.url}`));
          }
        }, this.timeoutMs);

        this.consumeSseStream(
          res.body!,
          (endpointUrl) => {
            if (!endpointResolved) {
              endpointResolved = true;
              clearTimeout(handshakeTimer);
              this.postEndpoint = endpointUrl;
              resolveEndpoint(endpointUrl);
            }
          },
          (err) => {
            if (!endpointResolved) {
              endpointResolved = true;
              clearTimeout(handshakeTimer);
              rejectEndpoint(err);
            }
          }
        );
      });
    })().catch(async (err) => {
      await this.disconnect();
      throw err;
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return await this.connectPromise;
  }

  private async fetchSseStream(authHeaders: Record<string, string>, signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(this.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...authHeaders
        },
        signal
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new McpConnectionError(`Connection to ${this.url} timed out after ${this.timeoutMs}ms`);
      }
      throw new McpConnectionError(`Failed to connect to ${this.url}: ${err.message}`);
    }
  }

  /**
   * 后台持续消费 SSE 事件流并按请求 id 分发响应
   * Consume background SSE event stream and dispatch JSON-RPC responses by request id
   */
  private consumeSseStream(
    body: ReadableStream<Uint8Array>,
    onEndpoint: (endpointUrl: string) => void,
    onHandshakeError: (err: Error) => void
  ): void {
    (async () => {
      const reader = body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let currentEventType = '';
      let currentEventData: string[] = [];

      const dispatchEvent = () => {
        if (currentEventData.length === 0) {
          currentEventType = '';
          return;
        }
        const payload = currentEventData.join('\n').trim();
        const eventType = currentEventType || 'message';
        currentEventType = '';
        currentEventData = [];

        if (!payload) return;

        if (eventType === 'endpoint') {
          try {
            const baseOrigin = new URL(this.url).origin;
            const resolvedUrl = new URL(payload, this.url);
            if (resolvedUrl.origin !== baseOrigin) {
              onHandshakeError(
                new McpConnectionError(`Legacy SSE endpoint origin mismatch: ${resolvedUrl.origin} !== ${baseOrigin}`)
              );
              this.sseAbortController?.abort();
              return;
            }
            onEndpoint(resolvedUrl.toString());
          } catch (err: any) {
            onHandshakeError(new McpConnectionError(`Invalid legacy SSE endpoint URL: ${err.message}`));
            this.sseAbortController?.abort();
          }
          return;
        }

        if (eventType === 'message') {
          try {
            const parsed = JSON.parse(payload);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
              this.resolvePendingResponse(item);
            }
          } catch {}
        }
      };

      const consumeLine = (line: string) => {
        const trimmed = line.replace(/\r$/, '');
        if (trimmed === '') {
          dispatchEvent();
        } else if (trimmed.startsWith('event:')) {
          currentEventType = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          currentEventData.push(trimmed.slice(5).trimStart());
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            consumeLine(line);
          }
        }
        if (buffer) {
          consumeLine(buffer);
        }
        dispatchEvent();
      } catch (err: any) {
        onHandshakeError(
          err instanceof McpConnectionError
            ? err
            : new McpConnectionError(`Legacy SSE stream error: ${err?.message || String(err)}`)
        );
      } finally {
        reader.releaseLock();
        onHandshakeError(new McpConnectionError(`Legacy SSE stream closed before endpoint event on ${this.url}`));
        this.failAllPendingRequests(new McpConnectionError(`Legacy SSE connection closed on ${this.url}`));
        this.postEndpoint = undefined;
      }
    })();
  }

  private resolvePendingResponse(item: any): void {
    if (!item || typeof item !== 'object' || item.id === undefined || item.id === null) {
      return;
    }
    const pending = this.pendingRequests.get(item.id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(item.id);
    clearTimeout(pending.timer);

    if (item.error) {
      pending.reject(new Error(`RPC Error [${item.error.code}]: ${item.error.message}`));
    } else {
      pending.resolve(item.result);
    }
  }

  private failAllPendingRequests(err: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * 发送 JSON-RPC 2.0 请求并通过后台 SSE 流异步接收结果
   * Send JSON-RPC 2.0 request via POST and await response from background SSE stream
   */
  async sendJsonRpc(method: string, params?: any): Promise<any> {
    const endpoint = await this.ensureSseConnected();
    const requestId = this.nextRequestId++;

    return await new Promise<any>((resolve, reject) => {
      const postController = new AbortController();
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        postController.abort();
        if (method !== 'initialize') {
          this.sendJsonRpcNotification('notifications/cancelled', {
            requestId,
            reason: 'Request timed out'
          }).catch(() => {});
        }
        reject(new McpConnectionError(`Request to ${this.url} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      this.postMessage(endpoint, { jsonrpc: '2.0', id: requestId, method, params }, postController.signal)
        .then(async (res) => {
          if (res.status === 401 && this.onUnauthorized) {
            await res.body?.cancel().catch(() => {});
            const refreshed = await this.onUnauthorized().catch(() => false);
            if (refreshed) {
              res = await this.postMessage(endpoint, { jsonrpc: '2.0', id: requestId, method, params }, postController.signal);
            }
          }

          if (res.status === 401) {
            const authHeader = res.headers.get('www-authenticate') || undefined;
            const responseBody = await res.text().catch(() => undefined);
            throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`, authHeader, responseBody);
          }

          if (res.status === 404) {
            this.postEndpoint = undefined;
            if (this.sseAbortController) {
              this.sseAbortController.abort();
              this.sseAbortController = undefined;
            }
            throw new McpConnectionError(`Session expired or not found on ${this.url}`, {
              isSessionExpired: true,
              httpStatus: 404
            });
          }

          if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 300)}`);
          }

          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const text = await res.text().catch(() => '');
            if (text.trim()) {
              try {
                const parsed = JSON.parse(text);
                const items = Array.isArray(parsed) ? parsed : [parsed];
                for (const item of items) {
                  this.resolvePendingResponse(item);
                }
              } catch {}
            }
          }
        })
        .catch((err: any) => {
          const pending = this.pendingRequests.get(requestId);
          if (!pending) return;
          this.pendingRequests.delete(requestId);
          clearTimeout(pending.timer);

          if (err instanceof McpAuthRequiredError || err instanceof McpConnectionError) {
            pending.reject(err);
          } else if (err?.name === 'AbortError') {
            pending.reject(new McpConnectionError(`Request to ${this.url} timed out after ${this.timeoutMs}ms`));
          } else if (err?.cause?.code || err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND') {
            pending.reject(new McpConnectionError(`Failed to connect to ${this.url}: ${err.message}`));
          } else {
            pending.reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
    });
  }

  private async postMessage(endpoint: string, payload: unknown, signal: AbortSignal): Promise<Response> {
    const authHeaders = await this.getHeaders();
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...authHeaders
      },
      body: JSON.stringify(payload),
      signal
    });
  }

  /**
   * 发送 JSON-RPC 2.0 通知（不包含 id 字段）
   * Send JSON-RPC 2.0 notification without id member
   */
  async sendJsonRpcNotification(method: string, params?: any): Promise<void> {
    const endpoint = await this.ensureSseConnected();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5000));

    try {
      const res = await this.postMessage(endpoint, { jsonrpc: '2.0', method, params }, controller.signal);
      if (res.status === 401) {
        const authHeader = res.headers.get('www-authenticate') || undefined;
        const responseBody = await res.text().catch(() => undefined);
        throw new McpAuthRequiredError(`HTTP 401 Unauthorized from ${this.url}`, authHeader, responseBody);
      }
      if (res.status === 404) {
        this.postEndpoint = undefined;
        if (this.sseAbortController) {
          this.sseAbortController.abort();
          this.sseAbortController = undefined;
        }
        throw new McpConnectionError(`Session expired or not found on ${this.url}`, {
          isSessionExpired: true,
          httpStatus: 404
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 断开旧版 SSE 长连接并清理所有未决请求
   * Disconnect legacy SSE stream and reject all pending requests
   */
  async disconnect(): Promise<void> {
    this.postEndpoint = undefined;
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = undefined;
    }
    this.failAllPendingRequests(new McpConnectionError(`Transport disconnected from ${this.url}`));
  }
}
