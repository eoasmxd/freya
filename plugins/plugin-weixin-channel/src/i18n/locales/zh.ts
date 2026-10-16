/**
 * 微信通道插件中文语言包
 * WeChat channel plugin Chinese locale dictionary
 */
export default {

  'cmd.weixin.description': '微信机器人管理指令',
  'cmd.weixin.sub.list': '列出当前已加载微信账号及其连接登录状态',
  'cmd.weixin.sub.login': '拉取微信扫码登录二维码，用法: /weixin login <accountId>',
  'cmd.weixin.list.empty': 'ℹ️ 当前没有加载任何微信账号实例。',
  'cmd.weixin.list.title': '📱 **微信账号连接状态列表**：\n\n',
  'cmd.weixin.list.item': '- 账号 ID: `{accountId}` —— {status}\n',
  'cmd.weixin.list.statusOnline': '✅ **已登录 / 在线**',
  'cmd.weixin.list.statusOffline': '❌ **未登录 / 离线**',
  'cmd.weixin.list.loginHint': '  *(提示：可运行 `/weixin login {accountId}` 启动扫码登录)*\n',
  'cmd.weixin.login.missingId': '❌ 缺少必要参数：请指定微信账号标识 id，例如 `/weixin login my_weixin`',
  'cmd.weixin.login.alreadyOnline': 'ℹ️ 微信账号 [{accountId}] 已经是登录在线状态。',
  'cmd.weixin.login.qrGenerated': '⚠️ **微信账号 [{accountId}] 登录二维码已成功生成！**\n\n**[微信扫码] 请使用微信扫描下方二维码绑定账号 [{accountId}]**：\n\n',
  'cmd.weixin.login.qrFallbackHint': '*(提示：若字符二维码未能正常显示或无法扫描，您可以直接点击 [打开微信二维码网页]({scanUrl}) 扫码绑定)*',
  'cmd.weixin.login.fail': '❌ 拉取微信登录二维码失败: {message}',
  'cmd.weixin.unknown': '❌ 未知子命令：支持的子命令有 `list` 和 `login`。用法示例：\n- `/weixin list`\n- `/weixin login my_weixin`',
  'tool.weixin.send.accountRequired': '❌ 缺少必要参数 accountId：必须指定微信账号标识。',
  'tool.weixin.send.contentRequired': '❌ 缺少必要参数 content：发送的消息内容不能为空。',
  'tool.weixin.send.accountNotFound': '微信账号 [{accountId}] 不存在或尚未登录。请先通过 `/weixin login {accountId}` 扫码上线。',
  'tool.weixin.send.notBound': '微信账号 [{accountId}] 尚未建立会话绑定，请先使用绑定的微信号向该机器人发送一条初始消息。',
  'tool.weixin.send.success': '✅ 消息已成功投递至微信账号 [{accountId}]（共 {chunks} 个消息分片）。',
  'tool.weixin.send.failed': '❌ 向微信账号 [{accountId}] 发送消息失败: {message}'
};
