/**
 * 微信通道插件英文语言包
 * WeChat channel plugin English locale dictionary
 */
export default {

  'cmd.weixin.description': 'WeChat bot management commands',
  'cmd.weixin.sub.list': 'List currently loaded WeChat accounts and connection login status',
  'cmd.weixin.sub.login': 'Fetch WeChat login QR code, usage: /weixin login <accountId>',
  'cmd.weixin.list.empty': 'ℹ️ No WeChat account instances currently loaded.',
  'cmd.weixin.list.title': '📱 **WeChat Account Connection Status List**:\n\n',
  'cmd.weixin.list.item': '- Account ID: `{accountId}` —— {status}\n',
  'cmd.weixin.list.statusOnline': '✅ **Logged in / Online**',
  'cmd.weixin.list.statusOffline': '❌ **Not logged in / Offline**',
  'cmd.weixin.list.loginHint': '  *(Tip: Run `/weixin login {accountId}` to start QR code login)*\n',
  'cmd.weixin.login.missingId': '❌ Missing required parameter: please specify WeChat account id, e.g. `/weixin login my_weixin`',
  'cmd.weixin.login.alreadyOnline': 'ℹ️ WeChat account [{accountId}] is already logged in and online.',
  'cmd.weixin.login.qrGenerated': '⚠️ **Login QR code generated successfully for WeChat account [{accountId}]!**\n\n**[WeChat Scan] Please scan the QR code below to bind account [{accountId}]**:\n\n',
  'cmd.weixin.login.qrFallbackHint': '*(Tip: If character QR code does not display properly, click [Open WeChat QR Page]({scanUrl}) to scan)*',
  'cmd.weixin.login.fail': '❌ Failed to fetch WeChat login QR code: {message}',
  'cmd.weixin.unknown': '❌ Unknown subcommand. Supported subcommands: `list` and `login`. Usage examples:\n- `/weixin list`\n- `/weixin login my_weixin`',
};
