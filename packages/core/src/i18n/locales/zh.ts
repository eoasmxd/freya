/**
 * 内核中文多语言字典
 * Core Chinese localization dictionary
 */
export const zh: Record<string, string> = {
  // 提示词管理
  // Prompt management
  'prompt.error.onlyCore': '拒绝执行：配置管理工具仅允许管理核心提示词',
  'prompt.error.targetNotFound': '未能在文档 "{name}" 中匹配到指定的目标替换片段，修改取消。',
  'prompt.success.overwritten': '提示词文档 "{name}" 物理覆写完成，内存热更新已就绪。',
  'prompt.success.edited': '提示词文档 "{name}" 局部替换完成，内存热更新已就绪。',

  // CLI 通道
  // CLI channel
  'cli.start.launched': '[CliChannel] 本地控制台交互已启动。输入消息即可交流，输入 "/exit" 退出交互。',
  'cli.start.backgroundTip': '[CliChannel] 提示：你可以通过在启动命令后追加 "--no-cli" 参数使程序在后台运行。',
  'cli.auth.title': '⚠️  【敏感操作授权请求】',
  'cli.auth.valueLabel': '为新值',
  'cli.auth.detail': '大模型正尝试 [{action}] 敏感文件 "{filePath}" 内的 Key 路径 "{keyPath}"{valuePart}。',
  'cli.auth.decision': '请做出决策决定：',
  'cli.auth.approveHint': '👉 输入 "/approve {authId}" 批准此项操作',
  'cli.auth.rejectHint': '👉 输入 "/reject {authId}" 拒绝此项操作',
  'cli.prompt.user': '\n👤 [你]: ',

  // Web 容器
  // Web container
  'web.error.notInitialized': '[WebContainer] HTTP 服务尚未初始化。',

  // REST API 错误
  // REST API errors
  'api.error.bodyTooLarge': '请求体大小溢出 1MB 额度限制。',
  'api.error.bodyInvalidJson': '请求体非合法 JSON 格式。',
  'api.error.missingKeyPath': '缺少必要参数: keyPath',
  'api.error.updatesNotObject': '缺少必要参数: updates 必须是对象',
  'api.error.missingPluginId': '缺少必要参数: pluginId',
  'api.error.missingSkillId': '缺少必要参数: skillId',
  'api.error.notSupported': '请求的 API 方法或路径不支持: {method} {pathname}',
  'api.error.internal': '内部接口处理异常',

  // 授权命令
  // Auth commands
  'cmd.approve.description': '批准大模型发起的敏感配置读写操作',
  'cmd.approve.missingId': '❌ 错误：请指定授权申请 ID（如: `/approve auth_xxxx`）。',
  'cmd.approve.sent': 'ℹ️ 授权指令已发出：同意批准申请 `{authId}`。',
  'cmd.reject.description': '拒绝大模型发起的敏感配置读写操作',
  'cmd.reject.missingId': '❌ 错误：请指定授权申请 ID（如: `/reject auth_xxxx`）。',
  'cmd.reject.sent': 'ℹ️ 授权指令已发出：拒绝申请 `{authId}`。',

  // 帮助命令
  // Help commands
  'cmd.help.description': '列出所有可用指令及说明',
  'cmd.help.empty': 'ℹ️ 当前没有任何注册的指令。',
  'cmd.help.aliasLabel': '别名',
  'cmd.help.usageLabel': '用法',
  'cmd.help.title': '### ℹ️ 可用指令列表（共 {count} 条）',

  // 中止命令
  // Stop commands
  'cmd.stop.description': '中止大模型当前生成',
  'cmd.stop.sent': 'ℹ️ 中断信号已发出。',

  // 技能管理命令执行输出
  // Skill management command outputs
  'cmd.skill.description': '技能管理',
  'cmd.skill.sub.info': '查看当前激活的技能',
  'cmd.skill.sub.list': '列出所有可用技能',
  'cmd.skill.sub.set': '激活指定技能',
  'cmd.skill.sub.clear': '解除技能绑定',
  'cmd.skill.info.active': '🔧 当前激活技能: **{name}** `{id}` — {desc}',
  'cmd.skill.info.none': '🔧 当前未激活任何技能。',
  'cmd.skill.list.empty': '📋 暂无可用技能。',
  'cmd.skill.list.noDesc': '无描述',
  'cmd.skill.list.title': '### 📋 可用技能',
  'cmd.skill.set.missingId': '❌ 用法：`/skill set <skillId>`。',
  'cmd.skill.set.notFound': '❌ 技能 `{id}` 不存在或未启用。请使用 `/skill list` 查看可用技能。',
  'cmd.skill.set.success': '✅ 已激活技能: **{name}** `{id}`。',
  'cmd.skill.clear.success': '✅ 已解除技能绑定。',

  // 会话管理命令执行输出
  // Session management command outputs
  'cmd.session.description': '会话管理',
  'cmd.session.sub.info': '查看当前会话信息',
  'cmd.session.sub.reset': '归档当前会话并开启新会话',
  'cmd.session.sub.new': '创建分支子会话',
  'cmd.session.sub.main': '返回主会话',
  'cmd.session.sub.switch': '切换指定会话',
  'cmd.session.sub.list': '列出会话',
  'cmd.session.info.title': '### 📋 会话信息',
  'cmd.session.info.id': '- **会话 ID:** `{id}`',
  'cmd.session.info.type': '- **类型:** {type}',
  'cmd.session.info.messageCount': '- **消息数:** `{count}`',
  'cmd.session.info.model': '- **绑定模型:** {model}',
  'cmd.session.info.skill': '- **激活技能:** {skill}',
  'cmd.session.info.updatedAt': '- **更新时间:** `{time}`',
  'cmd.session.info.typeMain': '主会话',
  'cmd.session.info.typeBranch': '分支会话 (父: `{parentId}`)',
  'cmd.session.info.modelDefault': '默认',
  'cmd.session.info.skillNone': '无',
  'cmd.session.reset.left': 'ℹ️ 物理端已离开当前会话，该历史会话已被归档。',
  'cmd.session.reset.mainSuccess': '✅ 旧主会话已归档为 `{oldId}`，当前已切换至新主会话。',
  'cmd.session.reset.branchSuccess': '✅ 分支会话已归档为 `{oldId}`，当前已在原地重置为全新分支。',
  'cmd.session.new.left': 'ℹ️ 物理端已离开当前会话，新建并前往分支会话: `{branchId}`',
  'cmd.session.new.success': '✅ 已创建分支会话 `{branchId}`（独立上下文），并自动切换。输入 `/session main` 可回到主会话。',
  'cmd.session.new.defaultName': '会话{timestamp}',
  'cmd.session.main.left': 'ℹ️ 物理端已离开当前会话，切换回到主会话。',
  'cmd.session.main.success': '✅ 已回到主会话。',
  'cmd.session.switch.missingId': '❌ 用法：`/session switch <会话ID>`。',
  'cmd.session.switch.notFound': '❌ 会话 `{id}` 不存在。请使用 `/session new` 创建新会话后重试。',
  'cmd.session.switch.archived': '❌ 会话 `{id}` 已归档，无法切换。如需查看归档会话请使用 `/session list archived`。',
  'cmd.session.switch.left': 'ℹ️ 物理端已离开当前会话，切换去往会话: `{id}`',
  'cmd.session.switch.success': '✅ 已切换到{type}会话 `{id}`。',
  'cmd.session.switch.typeMain': '主',
  'cmd.session.switch.typeBranch': '分支',
  'cmd.session.list.titleArchived': '📦 已归档会话',
  'cmd.session.list.titleAll': '📋 全部会话',
  'cmd.session.list.titleActive': '📋 活跃会话',
  'cmd.session.list.empty': 'ℹ️ {title}：暂无。',
  'cmd.session.list.current': ' **(当前 👈)**',
  'cmd.session.list.typeBranch': '分支',
  'cmd.session.list.typeMain': '主',
  'cmd.session.list.archivedTag': ' *(归档于 {date})*',
  'cmd.session.unknown': '❌ 未知子命令 `{sub}`。可用子命令：`info` `reset` `new` `main` `switch` `list`。',
  'cmd.reset.description': '归档当前会话并创建新主会话',

  // 模型管理命令
  // Model management commands
  'cmd.model.description': '模型管理',
  'cmd.model.sub.info': '查看当前会话绑定的模型',
  'cmd.model.sub.list': '列出所有已配置的模型',
  'cmd.model.sub.set': '设置当前会话绑定的模型',
  'cmd.model.sub.reset': '解除模型绑定，恢复默认',
  'cmd.model.info.bound': '🔧 当前会话绑定模型: `{modelId}` (提供商: `{provider}`)。',
  'cmd.model.info.default': '🔧 当前会话未绑定指定模型，将使用系统默认模型。',
  'cmd.model.info.defaultProvider': '默认',
  'cmd.model.list.noneConfigured': '❌ 系统尚未配置任何模型，请在 Web 设置页面或 `config/freya.json` 中配置 `models` 字段。',
  'cmd.model.list.empty': 'ℹ️ `models` 配置中没有已启用的模型。',
  'cmd.model.list.title': '### 📋 已配置模型（来自 `config/freya.json`）',
  'cmd.model.list.categoryDefault': '默认',
  'cmd.model.list.categoryImage': '图像',
  'cmd.model.list.categoryAudio': '音频',
  'cmd.model.set.usage': '❌ 用法：`/model set <modelId>` 或 `/model set <providerId> <modelId>`。',
  'cmd.model.set.chainEmpty': '❌ 系统 default 模型降级链中尚未配置任何模型。',
  'cmd.model.set.notFound': '❌ 模型 `{modelId}` (提供商: `{providerId}`) 未在 default 模型配置中找到。',
  'cmd.model.set.notFoundHint': '❌ 模型 `{modelId}` 未在 default 模型配置中找到。可用模型：{hint}{more}。',
  'cmd.model.set.moreCount': ' ... 等 {count} 个',
  'cmd.model.set.duplicateHint': '❌ 存在重名模型，请使用 `/model set <providerId> <modelId>` 明确指定提供商。可选的提供商为：{providers}。',
  'cmd.model.set.success': '🔧 已将会话绑定模型改为: `{modelId}` (提供商: `{provider}`)。',
  'cmd.model.reset.success': '🔧 已解除模型绑定，恢复默认。',
  'cmd.models.description': '列出所有已配置的模型',

  // 插件管理
  // Plugin management
  'plugin.toggle.notFound': '❌ 未找到 ID 为 "{id}" 的插件，请检查名称是否正确。',
  'plugin.toggle.invalidState': '❌ 无法启用插件 "{id}": {reason}',
  'plugin.toggle.invalidStateDefault': '该插件状态非法',
  'plugin.toggle.alreadyInState': 'ℹ️ 插件 "{id}" 状态已是 {state}。',
  'plugin.toggle.stateEnabled': '启用',
  'plugin.toggle.stateDisabled': '禁用',
  'plugin.toggle.writeFailed': '❌ 插件状态变更成功，但写入 plugins.json 失败: {message}',
  'plugin.toggle.startFailed': '❌ 插件 "{id}" 开启失败: {message}',
  'plugin.toggle.success': '✅ 插件 "{id}" 已{state}并立即生效。',
  'plugin.error.missingExport': '插件路径 {path} 未定义默认导出或 Plugin 命名导出。',
  'plugin.error.missingIdentity': '缺少 Freya 身份标识 (package.json 需包含 freya 节点或依赖 @eoasmxd/freya-sdk)',
  'plugin.error.missingMain': 'package.json 未定义 main 入口声明',
  'plugin.error.entryNotFound': '未找到 package.json 指定的物理入口文件: {file}',
  'plugin.error.schemaCorrupted': '静态配置声明文件 {file} 损坏解析失败: {message}',
  'plugin.error.npmNotFound': '系统中未找到名为 "{name}" 的 NPM 包',
  'plugin.error.npmReadFailed': 'NPM 包 "{name}" 读取 package.json 失败',
  'plugin.error.npmResolveFailed': '解析 NPM 插件异常: {message}',
  'plugin.error.loadFailed': '载入运行失败: {message}',

  // 技能管理
  // Skill management
  'skill.toggle.notFound': '❌ 未找到 ID 为 "{id}" 的技能，请检查名称是否正确。',
  'skill.toggle.alreadyInState': 'ℹ️ 技能 "{name}" 状态已是 {state}。',
  'skill.toggle.stateEnabled': '启用',
  'skill.toggle.stateDisabled': '禁用',
  'skill.toggle.writeFailed': '❌ 技能状态变更成功，但写入 skills.json 失败: {message}',
  'skill.toggle.success': '✅ 技能 "{name}" 已成功{state}。',

  // 引导启动器
  // Launcher
  'launcher.depMissing': 'ℹ️ 未检测到运行依赖，正在为您自动执行依赖安装，请稍候...',
  'launcher.depInstallFail': '❌ 自动安装依赖失败，请在程序根目录下手动执行：npm install --omit=dev',
  'launcher.stopSuccess': '✨ 已成功向后台服务进程 (PID: {pid}) 发送停止信号。',
  'launcher.stopNotFound': 'ℹ️ 未检测到运行中的后台服务进程（可能已被手动关闭）。',
  'launcher.stopFailed': '❌ 停止后台服务失败: {message}',
  'launcher.stopNoPid': 'ℹ️ 未检测到运行中的后台服务 PID 记录。',
  'launcher.runningWarn': '⚠️ 警告: 检测到 Freya 核心服务已在运行 (PID: {pid})，请勿重复启动。',
  'launcher.restartTip': '👉 如果需要重启，请先运行 "freya stop" 停止现有服务。\n',
  'launcher.permWarn': '⚠️ 警告: 检测到 Freya 服务已在运行 (PID: {pid})，但当前用户权限不足。',
  'launcher.bgStarted': '✨ Freya 核心服务已成功在后台静默启动运行。',
  'launcher.bgStopTip': '👉 你可以通过运行 "freya stop" 命令来停止此后台服务。\n',

  // 核心配置 Schema
  // Core Configuration Schema
  'schema.core.category.system': '系统参数',
  'schema.core.category.server': '服务器',
  'schema.core.category.cli': '终端',
  'schema.core.category.workspace': '工作区',
  'schema.core.category.context': '上下文管理',
  'schema.core.category.log': '日志',
  'schema.core.category.models': '模型',
  'schema.core.category.security': '安全',
  'schema.core.category.tools': '系统工具',
  'schema.core.category.commands': '系统指令',

  'schema.core.models.item.provider.desc': 'LLM 提供商标识',
  'schema.core.models.item.model.desc': '模型名称',
  'schema.core.models.item.name.desc': '显示名称',
  'schema.core.system.language.desc': '系统界面与交互语言',
  'schema.core.server.port.desc': 'Web 网关服务端口',
  'schema.core.server.enabled.desc': '是否启用 Web 网关服务与 WebSocket 频道',
  'schema.core.cli.enabled.desc': '是否启用命令行终端交互频道',
  'schema.core.workspace.desc': '用户文档工作区目录名',
  'schema.core.context.enabled.desc': '是否启用上下文管理',
  'schema.core.context.maxHistoryTurns.desc': '上下文历史最大轮数',
  'schema.core.context.historyLimit.desc': '上下文历史消息条数上限',
  'schema.core.context.keepRecentTurns.desc': '压缩时保留的最近轮数',
  'schema.core.context.summarizeEnabled.desc': '是否启用上下文摘要压缩',
  'schema.core.context.summaryMaxTokens.desc': '上下文摘要压缩时，控制摘要生成的最大 Token 长度',
  'schema.core.context.toolboxIdleTimeoutRounds.desc': '已激活工具箱的最大闲置交互轮数，达到后将被自动卸载',
  'schema.core.log.console.error.desc': '控制台输出 ERROR 日志（红色）',
  'schema.core.log.console.warn.desc': '控制台输出 WARN 日志（黄色）',
  'schema.core.log.console.info.desc': '控制台输出 INFO 日志（绿色）',
  'schema.core.log.console.debug.desc': '控制台输出 DEBUG 日志（灰色）',
  'schema.core.log.llm.desc': '是否记录大模型交互日志',
  'schema.core.models.default.desc': '默认模型降级链列表',
  'schema.core.models.image.desc': '图像模型列表',
  'schema.core.models.audio.desc': '音频转录模型列表',
  'schema.core.config.authTimeout.desc': 'AI 代理配置修改等待授权超时秒数',
  'schema.core.tools.config.enabled.desc': '是否启用系统核心配置工具箱（允许大模型查看与修改系统配置）',
  'schema.core.tools.session.enabled.desc': '是否启用会话与子任务管理工具箱（允许大模型查阅会话历史与派生子任务）',
  'schema.core.commands.auth.enabled.desc': '是否启用敏感操作授权审批指令（/approve 与 /reject）',
  'schema.core.commands.session.enabled.desc': '是否启用会话管理与路由指令（/session 及其子命令）',
  'schema.core.commands.model.enabled.desc': '是否启用模型查看与切换指令（/model 及其子命令）',

  // 配置管理器运行态文案
  // Configuration Manager runtime messages
  'config.update.propertySuccess': '核心配置中的属性 "{keyPath}" 已成功修改，已实时生效。',
  'config.update.globalSuccess': '全量全局配置已成功修改，并实时热更新生效。',
  'config.provider.missingId': '❌ 缺少必要参数：id 不能为空。',
  'config.provider.alreadyExists': '❌ 提供商 ID "{id}" 已存在。',
  'config.provider.addSuccess': '模型提供商 "{id}" 已成功新增。',
  'config.provider.notFound': '❌ 未找到提供商 ID 为 "{id}" 的配置条目。',
  'config.provider.noUpdates': '⚠️ 未指定任何需要修改的属性。',
  'config.provider.updateSuccess': '提供商 "{id}" 的属性 [{keys}] 已成功修改。',
  'config.provider.deleteSuccess': '模型提供商 "{id}" 及其所有模型配置已删除。',
  'config.model.missingId': '❌ 缺少必要参数：id 不能为空。',
  'config.model.alreadyExists': '❌ 模型 ID "{modelId}" 在提供商 "{providerId}" 下已存在。',
  'config.model.addSuccess': '模型 "{modelId}" 已成功新增至提供商 "{providerId}"。',
  'config.model.notFound': '❌ 未找到模型 ID 为 "{modelId}" 的配置条目（提供商 "{providerId}"）。',
  'config.model.updateSuccess': '模型 "{modelId}"（提供商 "{providerId}"）的属性 [{keys}] 已成功修改。',
  'config.model.deleteSuccess': '模型 "{modelId}"（提供商 "{providerId}"）已成功删除。',
  'config.plugin.notInit': '❌ 插件服务未初始化。',
  'config.skill.notInit': '❌ 技能注册表服务未初始化。',
  'config.prompt.notAllowed': '❌ 拒绝访问：主提示词文档 "{name}" 不在安全白名单中（只允许: IDENTITY, SOUL, USER, TOOLS, AGENTS, MEMORY）。',
  'config.prompt.notInit': '❌ 提示词服务未初始化。',
  'config.prompt.overwriteSuccess': '主提示词文档 [{name}] 已覆盖写入并实时生效。',
  'config.prompt.editSuccess': '主提示词文档 [{name}] 局部替换成功，已实时应用。',
  'config.prompt.editFailed': '❌ 修改失败：{message}',

  // 大模型与执行引擎异常提示
  // LLM and Agent Executor error messages
  'llm.error.noPluginLoaded': '❌ 系统尚未加载到任何有效的大模型插件，请检查插件与模型配置。',
  'llm.error.allCandidatesFailed': '所有候选模型均调用失败，无可用备选。',
  'llm.error.missingApiKey': '未检测到可用的大模型配置或对应的大模型授权密钥已失效，调用失败。',
  'llm.error.noPluginForProvider': '未找到能处理提供商 "{providerId}" 的 LLM 插件实例。',
  'agent.error.aborted': '对话运行已被用户主动中断。',
  'agent.error.noValidResponse': '无法获得合法的模型响应结果。',
  'agent.error.jsonParseFailed': 'JSON 解析失败: {message}',
  'agent.error.executionFailed': '运行失败',
};
