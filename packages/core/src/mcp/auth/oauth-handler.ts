import type http from 'node:http';
import type { FreyaContext, HttpRouteHandler, RouteContext } from '@eoasmxd/freya-sdk';
import type { McpOAuthManager } from './oauth-manager.js';

/**
 * 转义 HTML 特殊字符
 * Escape HTML special characters
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

      const acceptLang = (req.headers['accept-language'] || '').toLowerCase();
      const isZh = acceptLang.includes('zh');

      if (error) {
        res.statusCode = 400;
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>MCP Authorization Failed</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
              <h2 style="color: #e53e3e;">❌ ${isZh ? 'MCP 授权失败' : 'MCP Authorization Failed'}</h2>
              <p style="font-size: 1.1rem;"><strong>${escapeHtml(error)}</strong>: ${escapeHtml(errorDescription || 'Access denied')}</p>
              <p style="color: #718096; font-size: 0.9rem;">${isZh ? '您可以关闭此标签页并返回终端或聊天窗口重试。' : 'You can close this tab and return to chat or CLI to retry.'}</p>
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
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
              <h2 style="color: #e53e3e;">❌ ${isZh ? '请求缺少必要参数' : 'Missing Parameters'}</h2>
              <p style="font-size: 1.1rem;">${isZh ? '回调链接中缺少 code 或 state 参数。' : 'Missing code or state parameter in callback URL.'}</p>
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
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
            <h2 style="color: #38a169;">✅ ${isZh ? '授权成功！' : 'Authorization Succeeded!'}</h2>
            <p style="font-size: 1.1rem;">${isZh ? `已成功接收服务 [<strong>${escapeHtml(serverId)}</strong>] 的认证凭据。` : `Freya has received the credentials for [<strong>${escapeHtml(serverId)}</strong>].`}</p>
            <p style="color: #718096; font-size: 0.95rem;">${isZh ? '现在可以关闭此标签页并返回会话继续使用工具。' : 'You can now close this tab and return to your chat.'}</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      ctx?.logger.error('[McpOAuthHandler] OAuth callback error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const isZh = (req.headers['accept-language'] || '').toLowerCase().includes('zh');
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Internal Error</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
            <h2 style="color: #e53e3e;">❌ ${isZh ? '授权处理异常' : 'Authorization Processing Failed'}</h2>
            <p style="font-size: 1.1rem;">${escapeHtml(err?.message)}</p>
            <p style="color: #718096; font-size: 0.9rem;">${isZh ? '请检查终端日志或使用 /mcp auth 重新发起授权。' : 'Please check server logs or rerun /mcp auth.'}</p>
          </body>
        </html>
      `);
    }
  };
}
