import type { FreyaCommand, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaMcpManager } from '../../mcp/mcp-manager.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

/**
 * 注册 /mcp 相关内置指令（/mcp status, /mcp retry, /mcp auth）
 * Register /mcp commands for status checking, server retry and OAuth flow
 */
export function registerMcpCommands(deps: {
  commands: FreyaCommandRegistry;
  mcpManager: FreyaMcpManager;
  context: FreyaContext;
}): void {
  const { commands, mcpManager, context } = deps;
  const i18n = new I18n({ zh, en }, context);

  const mcpCommand: FreyaCommand = {
    name: 'mcp',
    description: i18n.all('cmd.mcp.description', 'Inspect MCP server statuses, retry connection, or complete OAuth authentication'),
    execute: async (args: string[]) => {
      const subAction = args[0]?.toLowerCase();

      if (subAction === 'status') {
        const statuses = mcpManager.getServerStatuses();
        const lines: string[] = [i18n.t('cmd.mcp.status.title', '📡 **MCP Server Statuses**:')];
        for (const [id, info] of Object.entries(statuses)) {
          lines.push(i18n.t('cmd.mcp.status.item', '- **{id}**: status: `{status}`, tools: {tools}, url: {url}', {
            id,
            status: info.status,
            tools: info.toolCount,
            url: info.url
          }));
        }
        return lines.join('\n');
      }

      if (subAction === 'auth') {
        const serverId = args[1];
        if (!serverId) {
          return i18n.t('cmd.mcp.auth.missingServerId', '❌ Please specify the target MCP server ID: `/mcp auth <serverId> [redirectUrl]`');
        }

        const inputUrl = args[2];
        if (inputUrl && inputUrl.startsWith('http')) {
          try {
            const parsed = new URL(inputUrl);
            const code = parsed.searchParams.get('code');
            const state = parsed.searchParams.get('state');
            if (!code || !state) {
              return i18n.t('cmd.mcp.auth.missingParams', '❌ The provided URL is missing "code" or "state" query parameters.');
            }

            await mcpManager.handleAuthCallback(code, state, serverId);
            return i18n.t('cmd.mcp.auth.success', '✅ Successfully authenticated server **{serverId}**! Tools are now available.', { serverId });
          } catch (err: any) {
            return i18n.t('cmd.mcp.auth.failed', '❌ Failed to complete authentication: {message}', { message: err.message });
          }
        }

        try {
          const authResult = await mcpManager.startAuth(serverId);
          if (authResult.type === 'device') {
            const info = authResult.info;
            const targetUrl = info.verificationUriComplete || info.verificationUri;
            return [
              i18n.t('cmd.mcp.auth.deviceTitle', '🔑 **Device Authorization for [{serverId}]**', { serverId }),
              i18n.t('cmd.mcp.auth.deviceStep1', '1. Open link in browser: 👉 [Open Device Verification Page]({targetUrl})', { targetUrl }),
              i18n.t('cmd.mcp.auth.deviceUrl', '   (URL: `{verificationUri}`)', { verificationUri: info.verificationUri }),
              i18n.t('cmd.mcp.auth.deviceStep2', '2. Enter Code: `{userCode}`', { userCode: info.userCode }),
              '',
              i18n.t('cmd.mcp.auth.devicePolling', '⏳ Freya is polling in background. Once authorized in your browser, the server will connect automatically.')
            ].join('\n');
          }

          return [
            i18n.t('cmd.mcp.auth.oauthTitle', '🔑 **OAuth Authorization Required for [{serverId}]**', { serverId }),
            i18n.t('cmd.mcp.auth.oauthPrompt', 'Please open the following link in your browser to complete authorization:'),
            i18n.t('cmd.mcp.auth.oauthLink', '👉 [Click to Authorize]({authorizationUrl})', { authorizationUrl: authResult.authorizationUrl }),
            '',
            i18n.t('cmd.mcp.auth.oauthManualHint', '*(If the browser displays a network error after authorization, please copy the complete address bar URL and run: `/mcp auth {serverId} <copiedURL>`)*', { serverId })
          ].join('\n');
        } catch (err: any) {
          return i18n.t('cmd.mcp.auth.initFailed', '❌ Failed to initiate authorization: {message}', { message: err.message });
        }
      }

      if (subAction === 'retry') {
        const serverId = args[1];
        if (!serverId) {
          return i18n.t('cmd.mcp.retry.missingServerId', '❌ Please specify the target MCP server ID to retry: `/mcp retry <serverId>`');
        }
        try {
          await mcpManager.retryServer(serverId);
          return i18n.t('cmd.mcp.retry.success', '✅ Successfully reconnected and probed server **{serverId}**! Tools are ready.', { serverId });
        } catch (err: any) {
          return i18n.t('cmd.mcp.retry.failed', '❌ Failed to reconnect to server **{serverId}**: {message}', { serverId, message: err.message });
        }
      }

      return i18n.t('cmd.mcp.usage', 'Usage: `/mcp status`, `/mcp retry <serverId>`, or `/mcp auth <serverId> [redirectUrl]`');
    }
  };

  commands.register(mcpCommand);
}
