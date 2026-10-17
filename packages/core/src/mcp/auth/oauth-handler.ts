import type http from 'node:http';
import type { FreyaContext, HttpRouteHandler, RouteContext } from '@eoasmxd/freya-sdk';
import type { McpOAuthManager } from './oauth-manager.js';

/**
 * 挂载于现有 WebContainer 的公开 OAuth 回调处理器
 * Public OAuth callback route handler mounted on existing WebContainer
 */
export function createOAuthCallbackHandler(
  authManager: McpOAuthManager,
  onSuccess?: (serverId: string) => Promise<void>,
  ctx?: FreyaContext
): HttpRouteHandler {
  return async (req: http.IncomingMessage, res: http.ServerResponse, routeCtx: RouteContext): Promise<void> => {
    try {
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const code = parsedUrl.searchParams.get('code');
      const state = parsedUrl.searchParams.get('state');
      const error = parsedUrl.searchParams.get('error');
      const errorDescription = parsedUrl.searchParams.get('error_description');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (error) {
        res.statusCode = 400;
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>MCP Authorization Failed</title></head>
            <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
              <h2 style="color: #e53e3e;">❌ MCP Authorization Failed</h2>
              <p>${error}: ${errorDescription || 'Access denied'}</p>
            </body>
          </html>
        `);
        return;
      }

      if (!code || !state) {
        res.statusCode = 400;
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Bad Request</title></head>
            <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
              <h2 style="color: #e53e3e;">Missing code or state parameter</h2>
            </body>
          </html>
        `);
        return;
      }

      const serverId = await authManager.handleCallback(code, state);
      if (onSuccess) {
        await onSuccess(serverId);
      }

      res.statusCode = 200;
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>MCP Authorization Success</title></head>
          <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
            <h2 style="color: #38a169;">✅ Authorization Succeeded!</h2>
            <p>Freya has received the credentials. You can now close this tab and return to your chat.</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      ctx?.logger.error('[McpOAuthHandler] OAuth callback error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Internal Error</title></head>
          <body style="font-family: sans-serif; padding: 2rem; text-align: center;">
            <h2 style="color: #e53e3e;">Authorization Processing Failed</h2>
            <p>${err.message}</p>
          </body>
        </html>
      `);
    }
  };
}
