import type http from 'node:http';
import type { FreyaContext, HttpRouteHandler, RouteContext } from '@eoasmxd/freya-sdk';
import type { McpOAuthManager } from './oauth-manager.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

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
  const i18n = new I18n({ zh, en }, ctx);

  return async (req: http.IncomingMessage, res: http.ServerResponse, routeCtx: RouteContext): Promise<void> => {
    const acceptLang = (req.headers['accept-language'] || '').toLowerCase();
    const reqLang = acceptLang.includes('zh') ? 'zh' : 'en';

    try {
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const code = parsedUrl.searchParams.get('code');
      const state = parsedUrl.searchParams.get('state');
      const error = parsedUrl.searchParams.get('error');
      const errorDescription = parsedUrl.searchParams.get('error_description');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (error) {
        res.statusCode = 400;
        const pageTitle = i18n.t('mcp.oauth.page.titleFailed', 'MCP Authorization Failed', undefined, reqLang);
        const heading = i18n.t('mcp.oauth.page.headingFailed', '❌ MCP Authorization Failed', undefined, reqLang);
        const retryHint = i18n.t('mcp.oauth.page.closeAndRetry', 'You can close this tab and return to chat or CLI to retry.', undefined, reqLang);

        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>${escapeHtml(pageTitle)}</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
              <h2 style="color: #e53e3e;">${heading}</h2>
              <p style="font-size: 1.1rem;"><strong>${escapeHtml(error)}</strong>: ${escapeHtml(errorDescription || 'Access denied')}</p>
              <p style="color: #718096; font-size: 0.9rem;">${retryHint}</p>
            </body>
          </html>
        `);
        return;
      }

      if (!code || !state) {
        res.statusCode = 400;
        const pageTitle = i18n.t('mcp.oauth.page.titleBadRequest', 'Bad Request', undefined, reqLang);
        const heading = i18n.t('mcp.oauth.page.headingBadRequest', '❌ Missing Parameters', undefined, reqLang);
        const desc = i18n.t('mcp.oauth.page.missingParamsDesc', 'Missing code or state parameter in callback URL.', undefined, reqLang);

        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>${escapeHtml(pageTitle)}</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
              <h2 style="color: #e53e3e;">${heading}</h2>
              <p style="font-size: 1.1rem;">${desc}</p>
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
      const pageTitle = i18n.t('mcp.oauth.page.titleSuccess', 'MCP Authorization Success', undefined, reqLang);
      const heading = i18n.t('mcp.oauth.page.headingSuccess', '✅ Authorization Succeeded!', undefined, reqLang);
      const credsDesc = i18n.t('mcp.oauth.page.receivedCreds', 'Freya has received the credentials for [<strong>{serverId}</strong>].', { serverId: escapeHtml(serverId) }, reqLang);
      const returnHint = i18n.t('mcp.oauth.page.closeAndReturn', 'You can now close this tab and return to your chat.', undefined, reqLang);

      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>${escapeHtml(pageTitle)}</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
            <h2 style="color: #38a169;">${heading}</h2>
            <p style="font-size: 1.1rem;">${credsDesc}</p>
            <p style="color: #718096; font-size: 0.95rem;">${returnHint}</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      ctx?.logger.error('[McpOAuthHandler] OAuth callback error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      const pageTitle = i18n.t('mcp.oauth.page.titleInternalError', 'Internal Error', undefined, reqLang);
      const heading = i18n.t('mcp.oauth.page.headingInternalError', '❌ Authorization Processing Failed', undefined, reqLang);
      const errorHint = i18n.t('mcp.oauth.page.internalErrorHint', 'Please check server logs or rerun /mcp auth.', undefined, reqLang);

      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>${escapeHtml(pageTitle)}</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2.5rem; text-align: center; color: #2d3748;">
            <h2 style="color: #e53e3e;">${heading}</h2>
            <p style="font-size: 1.1rem;">${escapeHtml(err?.message)}</p>
            <p style="color: #718096; font-size: 0.9rem;">${errorHint}</p>
          </body>
        </html>
      `);
    }
  };
}
