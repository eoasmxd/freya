import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ListPluginsTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_plugin',
      description: '查询当前系统中已发现的所有插件模块列表，返回每个插件的包名 ID、显示别名、渠道来源、启用状态及诊断提示。',
      parameters: { type: 'object', properties: {} }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const entries = await this.configService.listPlugins();
      if (!entries || entries.length === 0) return '⚠️ 当前未扫描发现任何插件配置条目。';

      const lines = entries.map((e, i) => {
        const statusTag = !e.valid ? '⚠️ 异常阻断' : (e.enabled ? '✅ 已启用' : '⬚ 未启用');
        const sourceMap: Record<string, string> = { builtin: '内置目录', runtime: '运行环境', npm: 'NPM包注册' };
        const sourceName = sourceMap[e.source] || e.source;
        let info = `${i + 1}. [${statusTag}] ${e.displayName || e.id} (${e.id})\n` +
          `   版本: ${e.version || '0.1.0'} | 来源: ${sourceName} | 说明: ${e.description || '无'}`;
        if (!e.valid && e.errorReason) {
          info += `\n   ❌ 诊断归因: ${e.errorReason}`;
        }
        return info;
      });

      return `当前共检索到 ${entries.length} 个插件模块：\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `❌ 查询插件列表失败: ${err.message}`;
    }
  }
}

export class TogglePluginTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'toggle_plugin',
      description: '启用或禁用指定的系统插件（pluginId 须为插件 NPM 包名）。系统会执行热重载，实时加载/启动或停用卸载插件资源。',
      parameters: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '目标插件的 NPM 包名 ID' },
          enabled: { type: 'boolean', description: 'true 启用，false 禁用' }
        },
        required: ['pluginId', 'enabled']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const pluginId = String(args.pluginId).trim();
      const enabled = !!args.enabled;
      if (!pluginId) return '❌ 缺少必要参数：pluginId 不能为空。';
      return await this.configService.togglePlugin(pluginId, enabled);
    } catch (err: any) {
      return `❌ 切换插件状态失败: ${err.message}`;
    }
  }
}
