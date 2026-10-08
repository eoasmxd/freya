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
      name: 'config_list_plugin',
      // 查询系统插件列表
      description: 'Query all discovered plugins in the system, returning package ID, display name, source channel, enabled status, and diagnostic errors.',
      parameters: { type: 'object', properties: {} }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const entries = await this.configService.listPlugins();
      if (!entries || entries.length === 0) {
        return '⚠️ No plugin configurations found currently.';
      }

      const lines = entries.map((e, i) => {
        const statusTag = !e.valid ? '⚠️ Blocked' : (e.enabled ? '✅ Enabled' : '⬚ Disabled');
        const sourceMap: Record<string, string> = { builtin: 'Builtin Directory', runtime: 'Runtime Environment', npm: 'NPM Package Registry' };
        const sourceName = sourceMap[e.source] || e.source;
        const displayName = this.i18n.resolve(e.displayName) || e.id;
        const description = this.i18n.resolve(e.description) || 'None';
        let info = `${i + 1}. [${statusTag}] ${displayName} (${e.id})\n` +
          `   Version: ${e.version || '0.1.0'} | Source: ${sourceName} | Description: ${description}`;
        if (!e.valid && e.errorReason) {
          info += `\n   ❌ Diagnostic Error: ${e.errorReason}`;
        }
        return info;
      });

      return `Total ${entries.length} plugin modules retrieved:\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `❌ Failed to list plugins: ${err.message}`;
    }
  }
}

export class EnablePluginTool implements FreyaTool {
  constructor(
    private configService: FreyaConfigManager,
    private ctx?: FreyaContext
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_enable_plugin',
      // 启用系统插件
      description: 'Enable a specified system plugin by NPM package ID. The system dynamically hot-reloads and activates the plugin.',
      parameters: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Target plugin NPM package ID'
          }
        },
        required: ['pluginId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const pluginId = String(args.pluginId || '').trim();
      if (!pluginId) {
        return '❌ Missing required parameter: pluginId cannot be empty.';
      }
      return await this.configService.togglePlugin(pluginId, true);
    } catch (err: any) {
      return `❌ Failed to enable plugin: ${err.message}`;
    }
  }
}

export class DisablePluginTool implements FreyaTool {
  constructor(
    private configService: FreyaConfigManager,
    private ctx?: FreyaContext
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_disable_plugin',
      // 停用系统插件
      description: 'Disable a specified system plugin by NPM package ID. The system dynamically deactivates and unloads the plugin.',
      parameters: {
        type: 'object',
        properties: {
          pluginId: {
            type: 'string',
            description: 'Target plugin NPM package ID'
          }
        },
        required: ['pluginId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const pluginId = String(args.pluginId || '').trim();
      if (!pluginId) {
        return '❌ Missing required parameter: pluginId cannot be empty.';
      }
      return await this.configService.togglePlugin(pluginId, false);
    } catch (err: any) {
      return `❌ Failed to disable plugin: ${err.message}`;
    }
  }
}
