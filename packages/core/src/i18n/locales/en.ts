/**
 * 内核英文多语言字典
 * Core English localization dictionary
 */
export const en: Record<string, string> = {
  // 提示词管理
  // Prompt management
  'prompt.error.onlyCore': 'Execution rejected: Configuration management tools only allow managing core prompts',
  'prompt.error.targetNotFound': 'Failed to match the specified target replacement fragment in document "{name}", edit cancelled.',
  'prompt.success.overwritten': 'Prompt document "{name}" overwritten physically, in-memory hot reload ready.',
  'prompt.success.edited': 'Prompt document "{name}" locally replaced, in-memory hot reload ready.',

  // CLI 通道
  // CLI channel
  'cli.start.launched': '[CliChannel] Local console interaction started. Type your message to chat, or "/exit" to quit.',
  'cli.start.backgroundTip': '[CliChannel] Tip: Append "--no-cli" to the startup command to run in background mode.',
  'cli.auth.title': '⚠️  [Sensitive Operation Authorization Request]',
  'cli.auth.valueLabel': 'to value',
  'cli.auth.detail': 'The AI model is attempting to [{action}] the sensitive file "{filePath}" at key path "{keyPath}"{valuePart}.',
  'cli.auth.decision': 'Please make a decision:',
  'cli.auth.approveHint': '👉 Type "/approve {authId}" to approve this operation',
  'cli.auth.rejectHint': '👉 Type "/reject {authId}" to reject this operation',
  'cli.prompt.user': '\n👤 [You]: ',

  // Web 容器
  // Web container
  'web.error.notInitialized': '[WebContainer] HTTP server has not been initialized.',

  // REST API 错误
  // REST API errors
  'api.error.bodyTooLarge': 'Request body exceeds 1MB size limit.',
  'api.error.bodyInvalidJson': 'Request body is not valid JSON.',
  'api.error.missingKeyPath': 'Missing required parameter: keyPath',
  'api.error.updatesNotObject': 'Missing required parameter: updates must be an object',
  'api.error.missingPluginId': 'Missing required parameter: pluginId',
  'api.error.missingSkillId': 'Missing required parameter: skillId',
  'api.error.notSupported': 'Unsupported API method or path: {method} {pathname}',
  'api.error.internal': 'Internal API processing error',

  // 授权命令
  // Auth commands
  'cmd.approve.description': 'Approve a sensitive configuration read/write operation initiated by the AI model',
  'cmd.approve.missingId': '❌ Error: Please specify the authorization request ID (e.g. `/approve auth_xxxx`).',
  'cmd.approve.sent': 'ℹ️ Authorization command sent: approved request `{authId}`.',
  'cmd.reject.description': 'Reject a sensitive configuration read/write operation initiated by the AI model',
  'cmd.reject.missingId': '❌ Error: Please specify the authorization request ID (e.g. `/reject auth_xxxx`).',
  'cmd.reject.sent': 'ℹ️ Authorization command sent: rejected request `{authId}`.',

  // 帮助命令
  // Help commands
  'cmd.help.description': 'List all available commands and their descriptions',
  'cmd.help.empty': 'ℹ️ No commands are currently registered.',
  'cmd.help.aliasLabel': 'aliases',
  'cmd.help.usageLabel': 'usage',
  'cmd.help.title': '### ℹ️ Available Commands ({count} total)',

  // 中止命令
  // Stop commands
  'cmd.stop.description': 'Abort the current AI model generation',
  'cmd.stop.sent': 'ℹ️ Interrupt signal sent.',

  // 技能管理命令执行输出
  // Skill management command outputs
  'cmd.skill.description': 'Skill management',
  'cmd.skill.sub.info': 'Show current active skill',
  'cmd.skill.sub.list': 'List all available skills',
  'cmd.skill.sub.set': 'Activate a specified skill',
  'cmd.skill.sub.clear': 'Deactivate current skill binding',
  'cmd.skill.info.active': '🔧 Active skill: **{name}** `{id}` — {desc}',
  'cmd.skill.info.none': '🔧 No skill is currently active.',
  'cmd.skill.list.empty': '📋 No available skills.',
  'cmd.skill.list.noDesc': 'No description',
  'cmd.skill.list.title': '### 📋 Available Skills',
  'cmd.skill.set.missingId': '❌ Usage: `/skill set <skillId>`.',
  'cmd.skill.set.notFound': '❌ Skill `{id}` does not exist or is not enabled. Use `/skill list` to view available skills.',
  'cmd.skill.set.success': '✅ Skill activated: **{name}** `{id}`.',
  'cmd.skill.clear.success': '✅ Skill binding deactivated.',

  // 会话管理命令执行输出
  // Session management command outputs
  'cmd.session.description': 'Session management',
  'cmd.session.sub.info': 'Show current session info',
  'cmd.session.sub.reset': 'Archive current session and start a new one',
  'cmd.session.sub.new': 'Create a branch sub-session',
  'cmd.session.sub.main': 'Return to main session',
  'cmd.session.sub.switch': 'Switch to a specified session',
  'cmd.session.sub.list': 'List sessions',
  'cmd.session.info.title': '### 📋 Session Info',
  'cmd.session.info.id': '- **Session ID:** `{id}`',
  'cmd.session.info.type': '- **Type:** {type}',
  'cmd.session.info.messageCount': '- **Messages:** `{count}`',
  'cmd.session.info.model': '- **Bound Model:** {model}',
  'cmd.session.info.skill': '- **Active Skill:** {skill}',
  'cmd.session.info.updatedAt': '- **Updated At:** `{time}`',
  'cmd.session.info.typeMain': 'Main Session',
  'cmd.session.info.typeBranch': 'Branch Session (parent: `{parentId}`)',
  'cmd.session.info.modelDefault': 'Default',
  'cmd.session.info.skillNone': 'None',
  'cmd.session.reset.left': 'ℹ️ Connection has left this session; the session has been archived.',
  'cmd.session.reset.mainSuccess': '✅ Previous main session archived as `{oldId}`, now switched to new main session.',
  'cmd.session.reset.branchSuccess': '✅ Branch session archived as `{oldId}`, reset to a fresh branch in-place.',
  'cmd.session.new.left': 'ℹ️ Connection has left this session, moved to new branch: `{branchId}`',
  'cmd.session.new.success': '✅ Branch session `{branchId}` created (isolated context), switched automatically. Type `/session main` to return.',
  'cmd.session.new.defaultName': 'session{timestamp}',
  'cmd.session.main.left': 'ℹ️ Connection has left this session, switching back to main.',
  'cmd.session.main.success': '✅ Returned to main session.',
  'cmd.session.switch.missingId': '❌ Usage: `/session switch <sessionId>`.',
  'cmd.session.switch.notFound': '❌ Session `{id}` does not exist. Use `/session new` to create one.',
  'cmd.session.switch.archived': '❌ Session `{id}` is archived and cannot be switched to. Use `/session list archived` to view archived sessions.',
  'cmd.session.switch.left': 'ℹ️ Connection has left this session, switching to: `{id}`',
  'cmd.session.switch.success': '✅ Switched to {type}session `{id}`.',
  'cmd.session.switch.typeMain': 'main ',
  'cmd.session.switch.typeBranch': 'branch ',
  'cmd.session.list.titleArchived': '📦 Archived Sessions',
  'cmd.session.list.titleAll': '📋 All Sessions',
  'cmd.session.list.titleActive': '📋 Active Sessions',
  'cmd.session.list.empty': 'ℹ️ {title}: none.',
  'cmd.session.list.current': ' **(current 👈)**',
  'cmd.session.list.typeBranch': 'branch',
  'cmd.session.list.typeMain': 'main',
  'cmd.session.list.archivedTag': ' *(archived on {date})*',
  'cmd.session.unknown': '❌ Unknown subcommand `{sub}`. Available: `info` `reset` `new` `main` `switch` `list`.',
  'cmd.reset.description': 'Archive current session and create a new main session',

  // 模型管理命令
  // Model management commands
  'cmd.model.description': 'Model management',
  'cmd.model.sub.info': 'View the model bound to the current session',
  'cmd.model.sub.list': 'List all configured models',
  'cmd.model.sub.set': 'Set the model bound to the current session',
  'cmd.model.sub.reset': 'Unbind the model and revert to default',
  'cmd.model.info.bound': '🔧 Current session bound model: `{modelId}` (Provider: `{provider}`).',
  'cmd.model.info.default': '🔧 Current session has no specific model bound; system default model will be used.',
  'cmd.model.info.defaultProvider': 'default',
  'cmd.model.list.noneConfigured': '❌ No models are configured yet. Please configure the `models` field in Web settings or `config/freya.json`.',
  'cmd.model.list.empty': 'ℹ️ No enabled models found in `models` configuration.',
  'cmd.model.list.title': '### 📋 Configured Models (from `config/freya.json`)',
  'cmd.model.list.categoryDefault': 'Default',
  'cmd.model.list.categoryImage': 'Image',
  'cmd.model.list.categoryAudio': 'Audio',
  'cmd.model.set.usage': '❌ Usage: `/model set <modelId>` or `/model set <providerId> <modelId>`.',
  'cmd.model.set.chainEmpty': '❌ No models are configured in the system default model fallback chain.',
  'cmd.model.set.notFound': '❌ Model `{modelId}` (Provider: `{providerId}`) was not found in default model configuration.',
  'cmd.model.set.notFoundHint': '❌ Model `{modelId}` was not found in default model configuration. Available models: {hint}{more}.',
  'cmd.model.set.moreCount': ' ... and {count} more',
  'cmd.model.set.duplicateHint': '❌ Ambiguous model name exists. Please use `/model set <providerId> <modelId>` to specify provider explicitly. Available providers: {providers}.',
  'cmd.model.set.success': '🔧 Session model changed to: `{modelId}` (Provider: `{provider}`).',
  'cmd.model.reset.success': '🔧 Model binding removed, restored to default.',
  'cmd.models.description': 'List all configured models',

  // 插件管理
  // Plugin management
  'plugin.toggle.notFound': '❌ Plugin with ID "{id}" not found. Please verify the name.',
  'plugin.toggle.invalidState': '❌ Cannot enable plugin "{id}": {reason}',
  'plugin.toggle.invalidStateDefault': 'plugin is in an invalid state',
  'plugin.toggle.alreadyInState': 'ℹ️ Plugin "{id}" is already {state}.',
  'plugin.toggle.stateEnabled': 'enabled',
  'plugin.toggle.stateDisabled': 'disabled',
  'plugin.toggle.writeFailed': '❌ Plugin state changed, but failed to write plugins.json: {message}',
  'plugin.toggle.startFailed': '❌ Failed to start plugin "{id}": {message}',
  'plugin.toggle.success': '✅ Plugin "{id}" has been {state} and took effect immediately.',

  // 技能管理
  // Skill management
  'skill.toggle.notFound': '❌ Skill with ID "{id}" not found. Please verify the name.',
  'skill.toggle.alreadyInState': 'ℹ️ Skill "{name}" is already {state}.',
  'skill.toggle.stateEnabled': 'enabled',
  'skill.toggle.stateDisabled': 'disabled',
  'skill.toggle.writeFailed': '❌ Skill state changed, but failed to write skills.json: {message}',
  'skill.toggle.success': '✅ Skill "{name}" has been successfully {state}.',

  // 引导启动器
  // Launcher
  'launcher.depMissing': 'ℹ️ Missing runtime dependencies. Installing now, please wait...',
  'launcher.depInstallFail': '❌ Failed to install dependencies automatically. Please run manually in the root directory: npm install --omit=dev',
  'launcher.stopSuccess': '✨ Successfully sent stop signal to the background service process (PID: {pid}).',
  'launcher.stopNotFound': 'ℹ️ No running background service process detected (it may have been terminated).',
  'launcher.stopFailed': '❌ Failed to stop background service: {message}',
  'launcher.stopNoPid': 'ℹ️ No running background service PID record found.',
  'launcher.runningWarn': '⚠️ Warning: Freya core service is already running (PID: {pid}). Duplicate start aborted.',
  'launcher.restartTip': '👉 To restart, please run "freya stop" first to terminate the existing service.\n',
  'launcher.permWarn': '⚠️ Warning: Freya service is already running (PID: {pid}), but current permissions are insufficient.',
  'launcher.bgStarted': '✨ Freya core service has been started in the background.',
  'launcher.bgStopTip': '👉 You can run "freya stop" to terminate this background service.\n',

  // 核心配置 Schema
  // Core Configuration Schema
  'schema.core.category.system': 'System Parameters',
  'schema.core.category.server': 'Server',
  'schema.core.category.cli': 'CLI',
  'schema.core.category.workspace': 'Workspace',
  'schema.core.category.context': 'Context Management',
  'schema.core.category.log': 'Logging',
  'schema.core.category.models': 'Models',
  'schema.core.category.security': 'Security',
  'schema.core.category.tools': 'Builtin Tools',
  'schema.core.category.commands': 'Builtin Commands',

  'schema.core.models.item.provider.desc': 'LLM provider identifier',
  'schema.core.models.item.model.desc': 'Model name',
  'schema.core.models.item.name.desc': 'Display name',
  'schema.core.system.language.desc': 'System UI and interaction language',
  'schema.core.server.port.desc': 'Web gateway service port',
  'schema.core.server.enabled.desc': 'Enable Web gateway service and WebSocket channel',
  'schema.core.cli.enabled.desc': 'Enable command-line terminal interaction channel',
  'schema.core.workspace.desc': 'User document workspace directory name',
  'schema.core.context.enabled.desc': 'Enable context management',
  'schema.core.context.maxHistoryTurns.desc': 'Maximum turns of context history',
  'schema.core.context.historyLimit.desc': 'Upper limit of context history message count',
  'schema.core.context.keepRecentTurns.desc': 'Recent turns preserved during compression',
  'schema.core.context.summarizeEnabled.desc': 'Enable context summary compression',
  'schema.core.context.summaryMaxTokens.desc': 'Maximum token length of summary generated during compression',
  'schema.core.context.toolboxIdleTimeoutRounds.desc': 'Max idle turns before automatically unloading an active toolbox',
  'schema.core.log.console.error.desc': 'Console ERROR logs output (red)',
  'schema.core.log.console.warn.desc': 'Console WARN logs output (yellow)',
  'schema.core.log.console.info.desc': 'Console INFO logs output (green)',
  'schema.core.log.console.debug.desc': 'Console DEBUG logs output (gray)',
  'schema.core.log.llm.desc': 'Record LLM interaction logs',
  'schema.core.models.default.desc': 'Default model fallback chain list',
  'schema.core.models.image.desc': 'Image models list',
  'schema.core.models.audio.desc': 'Audio transcription models list',
  'schema.core.config.authTimeout.desc': 'Timeout seconds for AI agent waiting for config authorization',
  'schema.core.tools.config.enabled.desc': 'Enable core config toolbox (allows model to view/modify config)',
  'schema.core.tools.session.enabled.desc': 'Enable session toolbox (allows model to view history/spawn subtasks)',
  'schema.core.commands.auth.enabled.desc': 'Enable sensitive operation approval commands (/approve and /reject)',
  'schema.core.commands.session.enabled.desc': 'Enable session management commands (/session and subcommands)',
  'schema.core.commands.model.enabled.desc': 'Enable model switching commands (/model and subcommands)',
};

