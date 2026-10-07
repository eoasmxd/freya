import type { ChannelPlugin, FreyaContext, RouteContext } from '@eoasmxd/freya-sdk';
import http from 'node:http';
import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 120_000;

interface WebhookEndpointConfig {
  key: string;
  description?: string;
  toolboxes?: string | string[];
  skillId?: string;
  prompt?: string;
  sync?: boolean;
  language?: string;
}

interface WebhookRequestBody {
  content?: string;
  message?: string;
  prompt?: string;
  toolboxes?: string | string[];
  skillId?: string;
  sync?: boolean;
  language?: string;
}

interface PendingRequestContext {
  resolve: (value: { content: string }) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  replyContent: string;
}

/**
 * Webhook 频道插件
 * Webhook channel plugin
 */
export default class WebhookChannelPlugin implements ChannelPlugin {
  readonly type = 'channel' as const;

  private ctx?: FreyaContext;
  private unregisterRoute?: () => void;
  private pendingRequests = new Map<string, PendingRequestContext>();

  async setup(ctx: FreyaContext): Promise<void> {
    this.ctx = ctx;

    ctx.eventBus.on('connection:reply', this.handleConnectionReply);
    ctx.eventBus.on('connection:reply:completed', this.handleConnectionReplyCompleted);

    if (ctx.http) {
      this.unregisterRoute = ctx.http.registerApi('/webhook', this.handleWebhookRequest.bind(this), {
        auth: false
      });
      ctx.logger.info('[WebhookChannel] Successfully registered HTTP route at /webhook/**');
    } else {
      ctx.logger.warn('[WebhookChannel] FreyaHttpService not found in context, HTTP route cannot be mounted.');
    }
  }

  async stop(ctx: FreyaContext): Promise<void> {
    if (this.unregisterRoute) {
      this.unregisterRoute();
      this.unregisterRoute = undefined;
    }

    ctx.eventBus.off('connection:reply', this.handleConnectionReply);
    ctx.eventBus.off('connection:reply:completed', this.handleConnectionReplyCompleted);

    for (const [connId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Webhook plugin is stopping'));
      this.pendingRequests.delete(connId);
    }

    ctx.logger.info('[WebhookChannel] Stopped webhook channel plugin.');
  }

  private async handleWebhookRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    context: RouteContext
  ): Promise<boolean | void> {
    const routeSegments = context.pathname.split('/').filter(Boolean);
    const targetKey = routeSegments[1]?.trim();

    if (!targetKey) {
      this.sendJsonResponse(res, 400, {
        success: false,
        error: 'Missing webhook key in path: /webhook/:key'
      });
      return true;
    }

    const endpoints: WebhookEndpointConfig[] = (this.ctx?.config as any)?.webhook?.endpoints || [];
    const endpoint = endpoints.find((e) => e.key && e.key.trim() === targetKey);

    if (!endpoint) {
      this.sendJsonResponse(res, 404, {
        success: false,
        error: `Webhook endpoint not found or invalid key: ${targetKey}`
      });
      return true;
    }

    let requestPayload: WebhookRequestBody = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        requestPayload = await this.readRequestBody(req);
      } catch (err: any) {
        this.sendJsonResponse(res, 400, {
          success: false,
          error: `Failed to parse request body: ${err.message}`
        });
        return true;
      }
    } else if (req.method === 'GET') {
      requestPayload = {
        content: context.query.get('content') || context.query.get('message') || '',
        skillId: context.query.get('skillId') || undefined,
        sync: context.query.has('sync') ? context.query.get('sync') === 'true' : undefined,
        language: context.query.get('language') || undefined
      };
    } else {
      this.sendJsonResponse(res, 405, { success: false, error: 'Method Not Allowed' });
      return true;
    }

    const combinedPrompt = [endpoint.prompt?.trim(), requestPayload.prompt?.trim()].filter(Boolean).join('\n\n');
    const inputContent = requestPayload.content || requestPayload.message || '';
    const finalContent = [combinedPrompt, inputContent].filter(Boolean).join('\n\n');

    if (!finalContent) {
      this.sendJsonResponse(res, 400, {
        success: false,
        error: 'Missing content/message for webhook execution'
      });
      return true;
    }

    const endpointToolboxes = this.parseToolboxIds(endpoint.toolboxes);
    const requestToolboxes = this.parseToolboxIds(requestPayload.toolboxes);
    const toolboxes = Array.from(new Set([...endpointToolboxes, ...requestToolboxes]));

    const skillId = (typeof requestPayload.skillId === 'string' && requestPayload.skillId.trim())
      ? requestPayload.skillId.trim()
      : (endpoint.skillId?.trim() || undefined);

    const isSync = typeof requestPayload.sync === 'boolean'
      ? requestPayload.sync
      : (typeof endpoint.sync === 'boolean' ? endpoint.sync : true);

    const targetLanguage = (typeof requestPayload.language === 'string' && requestPayload.language.trim())
      ? requestPayload.language.trim()
      : (endpoint.language?.trim() || undefined);
    const defaultLanguage = targetLanguage || this.ctx?.getLanguage('en') || 'en';

    const requestId = crypto.randomUUID();
    const connectionId = `webhook:${targetKey}:${requestId}`;
    const sessionId = `webhook:${targetKey}:${requestId}`;

    if (isSync) {
      try {
        const waitPromise = new Promise<{ content: string }>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingRequests.delete(connectionId);
            reject(new Error(`Webhook execution timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`));
          }, DEFAULT_TIMEOUT_MS);

          this.pendingRequests.set(connectionId, {
            resolve,
            reject,
            timer,
            replyContent: ''
          });
        });

        this.ctx?.eventBus.emit('connection:message', {
          connectionId,
          sessionId,
          content: finalContent,
          ephemeral: true,
          toolboxes: toolboxes.length > 0 ? toolboxes : undefined,
          skillId,
          channelType: 'webhook',
          defaultLanguage
        });

        const result = await waitPromise;
        this.sendJsonResponse(res, 200, {
          success: true,
          response: result.content
        });
      } catch (err: any) {
        const isTimeout = err.message?.includes('timed out');
        this.sendJsonResponse(res, isTimeout ? 504 : 500, {
          success: false,
          error: err.message || 'Webhook internal execution failure'
        });
      } finally {
        this.cleanupConnection(connectionId);
      }
    } else {
      this.ctx?.eventBus.emit('connection:message', {
        connectionId,
        sessionId,
        content: finalContent,
        ephemeral: true,
        toolboxes: toolboxes.length > 0 ? toolboxes : undefined,
        skillId,
        channelType: 'webhook',
        defaultLanguage
      });

      this.sendJsonResponse(res, 202, {
        success: true,
        accepted: true,
        message: 'Webhook task accepted for asynchronous execution'
      });
    }

    return true;
  }

  private handleConnectionReply = (payload: { connectionId: string; content: string }): void => {
    const pending = this.pendingRequests.get(payload.connectionId);
    if (pending) {
      pending.replyContent = payload.content;
    }
  };

  private handleConnectionReplyCompleted = (payload: { connectionId: string }): void => {
    const pending = this.pendingRequests.get(payload.connectionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(payload.connectionId);
      pending.resolve({
        content: pending.replyContent
      });
    }
  };

  private cleanupConnection(connectionId: string): void {
    this.ctx?.eventBus.emit('connection:inactive', { connectionId });
  }

  private sendJsonResponse(res: http.ServerResponse, statusCode: number, data: Record<string, any>): void {
    if (res.headersSent) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
  }

  private parseToolboxIds(toolboxesInput: unknown): string[] {
    if (Array.isArray(toolboxesInput)) {
      return toolboxesInput.map(String).map((s) => s.trim()).filter(Boolean);
    }
    if (typeof toolboxesInput === 'string') {
      return toolboxesInput
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  private readRequestBody(req: http.IncomingMessage): Promise<WebhookRequestBody> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ content: raw });
        }
      });
      req.on('error', (err) => {
        reject(err);
      });
    });
  }
}
