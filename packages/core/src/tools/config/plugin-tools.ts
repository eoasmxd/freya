import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ListPluginsTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_plugin',
      // 查询系统插件列表
      description: 'Query all discovered plugins in the system, returning package ID, display name, source channel, enabled status, and diagnostic errors.',
      parameters: { type: 'object', properties: {} }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
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
        let info = `${i + 1}. [${statusTag}] ${e.displayName || e.id} (${e.id})\n` +
          `   Version: ${e.version || '0.1.0'} | Source: ${sourceName} | Description: ${e.description || 'None'}`;
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
  constructor(private configService: FreyaConfigManager) { }

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

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
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
