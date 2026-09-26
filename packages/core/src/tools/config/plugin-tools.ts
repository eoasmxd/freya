import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export class ListPluginsTool implements FreyaTool {
  private i18n: I18n;

  constructor(
    private configService: FreyaConfigManager,
    ctx?: FreyaContext
  ) {
    this.i18n = new I18n({ zh, en }, ctx);
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_plugin',
      // 查询系统插件列表
      description: 'Query all discovered plugins in the system, returning package ID, display name, source channel, enabled status, and diagnostic errors.',
      parameters: { type: 'object', properties: {} }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const entries = await this.configService.listPlugins();
      if (!entries || entries.length === 0) {
        // 未发现任何插件提示
        return '⚠️ No plugin configurations found currently.';
      }

      const lines = entries.map((e, i) => {
        // 插件启用状态标签
        const statusTag = !e.valid ? '⚠️ Blocked' : (e.enabled ? '✅ Enabled' : '⬚ Disabled');
        // 插件来源渠道映射
        const sourceMap: Record<string, string> = { builtin: 'Builtin Directory', runtime: 'Runtime Environment', npm: 'NPM Package Registry' };
        const sourceName = sourceMap[e.source] || e.source;
        const displayName = this.i18n.resolve(e.displayName) || e.id;
        const description = this.i18n.resolve(e.description) || 'None';
        let info = `${i + 1}. [${statusTag}] ${displayName} (${e.id})\n` +
          `   Version: ${e.version || '0.1.0'} | Source: ${sourceName} | Description: ${description}`;
        if (!e.valid && e.errorReason) {
          // 插件异常诊断归因
          info += `\n   ❌ Diagnostic Error: ${e.errorReason}`;
        }
        return info;
      });

      // 插件列表出参
      return `Total ${entries.length} plugin modules retrieved:\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      // 查询插件列表失败错误提示
      return `❌ Failed to list plugins: ${err.message}`;
    }
  }
}

export class TogglePluginTool implements FreyaTool {
  constructor(
    private configService: FreyaConfigManager,
    private ctx?: FreyaContext
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'toggle_plugin',
      // 启用或禁用系统插件
      description: 'Enable or disable a specified system plugin by NPM package ID. The system hot-reloads and activates or deactivates the plugin resources dynamically.',
      parameters: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            // 目标插件的 NPM 包名 ID
            description: 'Target plugin NPM package ID'
          },
          enabled: {
            type: 'boolean',
            // 是否启用
            description: 'true to enable, false to disable'
          }
        },
        required: ['pluginId', 'enabled']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const pluginId = String(args.pluginId).trim();
      const enabled = !!args.enabled;
      if (!pluginId) {
        // 缺少必要参数提示
        return '❌ Missing required parameter: pluginId cannot be empty.';
      }
      return await this.configService.togglePlugin(pluginId, enabled);
    } catch (err: any) {
      // 切换插件状态失败错误提示
      return `❌ Failed to toggle plugin state: ${err.message}`;
    }
  }
}
