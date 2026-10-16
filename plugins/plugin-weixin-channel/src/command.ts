import type { FreyaCommand, FreyaContext } from "@eoasmxd/freya-sdk";
import type { WeixinConnectionManager } from "./connection.js";
import type { I18n } from "./i18n/index.js";

/**
 * 构建微信渠道管理交互指令集合
 * Build WeChat channel management command definitions
 */
export function createWeixinCommands(
  connectionManager: WeixinConnectionManager,
  i18n: I18n
): FreyaCommand[] {
  return [
    {
      name: "weixin",
      description: i18n.all("cmd.weixin.description", "WeChat bot management commands"),
      subcommands: [
        {
          name: "list",
          description: i18n.all("cmd.weixin.sub.list", "List currently loaded WeChat accounts and connection login status")
        },
        {
          name: "login",
          description: i18n.all("cmd.weixin.sub.login", "Fetch WeChat login QR code, usage: /weixin login <accountId>")
        }
      ],
      execute: async (args: string[], _sessionId: string, _ctx: FreyaContext): Promise<string | void> => {
        const sub = args[0]?.trim().toLowerCase();

        if (sub === "list") {
          const accounts = connectionManager.getAccountStates();
          if (accounts.length === 0) {
            return i18n.t("cmd.weixin.list.empty", "ℹ️ No WeChat account instances currently loaded.");
          }

          let output = i18n.t("cmd.weixin.list.title", "📱 **WeChat Account Connection Status List**:\n\n");
          for (const { accountId, state } of accounts) {
            const statusStr = state.isLoggedIn
              ? i18n.t("cmd.weixin.list.statusOnline", "✅ **Logged in / Online**")
              : i18n.t("cmd.weixin.list.statusOffline", "❌ **Not logged in / Offline**");
            output += i18n.t("cmd.weixin.list.item", `- Account ID: \`${accountId}\` —— ${statusStr}\n`, { accountId, status: statusStr });
            if (!state.isLoggedIn) {
              output += i18n.t("cmd.weixin.list.loginHint", `  *(Tip: Run \`/weixin login ${accountId}\` to start QR code login)*\n`, { accountId });
            }
          }
          return output;
        }

        if (sub === "login") {
          const accountId = args[1]?.trim();
          if (!accountId) {
            return i18n.t("cmd.weixin.login.missingId", "❌ Missing required parameter: please specify WeChat account id, e.g. `/weixin login my_weixin`");
          }
          return await connectionManager.loginAccount(accountId);
        }

        return i18n.t("cmd.weixin.unknown", "❌ Unknown subcommand. Supported subcommands: `list` and `login`. Usage examples:\n- `/weixin list`\n- `/weixin login my_weixin`");
      }
    }
  ];
}
