import type { FreyaCommand, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaMcpManager } from '../../mcp/mcp-manager.js';

/**
 * 注册 /mcp 相关内置指令（/mcp status, /mcp auth）
 * Register /mcp commands for status checking and OAuth flow
 */
export function registerMcpCommands(deps: {
  commands: FreyaCommandRegistry;
  mcpManager: FreyaMcpManager;
  context: FreyaContext;
}): void {
  const { commands, mcpManager, context } = deps;

  const mcpCommand: FreyaCommand = {
    name: 'mcp',
    description: 'Inspect MCP server statuses or complete OAuth authentication',
    execute: async (args: string[]) => {
      const subAction = args[0]?.toLowerCase();

      if (subAction === 'status') {
        const statuses = mcpManager.getServerStatuses();
        const lines: string[] = ['📡 **MCP Server Statuses**:'];
        for (const [id, info] of Object.entries(statuses)) {
          lines.push(`- **${id}**: status: \`${info.status}\`, tools: ${info.toolCount}, url: ${info.url}`);
        }
        return lines.join('\n');
      }

      if (subAction === 'auth') {
        const serverId = args[1];
        if (!serverId) {
          return '❌ Please specify the target MCP server ID: `/mcp auth <serverId> [redirectUrl]`';
        }

        const inputUrl = args[2];
        if (inputUrl && inputUrl.startsWith('http')) {
          try {
            const parsed = new URL(inputUrl);
            const code = parsed.searchParams.get('code');
            const state = parsed.searchParams.get('state');
            if (!code || !state) {
              return '❌ The provided URL is missing "code" or "state" query parameters.';
            }

            await mcpManager.handleAuthCallback(code, state, serverId);
            return `✅ Successfully authenticated server **${serverId}**! Tools are now available.`;
          } catch (err: any) {
            return `❌ Failed to complete authentication: ${err.message}`;
          }
        }

        try {
          const authResult = await mcpManager.startAuth(serverId);
          if (authResult.type === 'device') {
            const info = authResult.info;
            const targetUrl = info.verificationUriComplete || info.verificationUri;
            return [
              `🔑 **Device Authorization for [${serverId}]**`,
              `1. Open link in browser: 👉 [Open Device Verification Page](${targetUrl})`,
              `   (URL: \`${info.verificationUri}\`)`,
              `2. Enter Code: \`${info.userCode}\``,
              '',
              `⏳ Freya is polling in background. Once authorized in your browser, the server will connect automatically.`
            ].join('\n');
          }

          return [
            `🔑 **OAuth Authorization Required for [${serverId}]**`,
            `Please open the following link in your browser to complete authorization:`,
            `👉 [Click to Authorize](${authResult.authorizationUrl})`,
            '',
            `*(If the browser displays a network error after authorization, please copy the complete address bar URL and run: \`/mcp auth ${serverId} <copiedURL>\`)*`
          ].join('\n');
        } catch (err: any) {
          return `❌ Failed to initiate authorization: ${err.message}`;
        }
      }

      if (subAction === 'retry') {
        const serverId = args[1];
        if (!serverId) {
          return '❌ Please specify the target MCP server ID to retry: `/mcp retry <serverId>`';
        }
        try {
          await mcpManager.retryServer(serverId);
          return `✅ Successfully reconnected and probed server **${serverId}**! Tools are ready.`;
        } catch (err: any) {
          return `❌ Failed to reconnect to server **${serverId}**: ${err.message}`;
        }
      }

      return 'Usage: `/mcp status`, `/mcp retry <serverId>`, or `/mcp auth <serverId> [redirectUrl]`';
    }
  };

  commands.register(mcpCommand);
}
