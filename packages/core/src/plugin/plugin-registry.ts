import type { FreyaContext, FreyaPlugin, LLMPlugin, ToolPlugin } from '@eoasmxd/freya-sdk';
import { FreyaChannelRegistry } from '../channel/channel-registry.js';
import type { FreyaLLMRegistry } from '../llm/llm-registry.js';
import type { FreyaToolRegistry } from '../tools/tool-registry.js';

/**
 * 内部插件注册表。
 * 负责发现、解析和检索内核已装载的插件实例，并将工具类与大模型类插件分别委托给各自的注册中心。
 */
export class FreyaPluginRegistry {
  constructor(
    private toolRegistry: FreyaToolRegistry,
    private llmRegistry: FreyaLLMRegistry,
    private channelRegistry: FreyaChannelRegistry
  ) { }

  register(plugin: FreyaPlugin, ctx: FreyaContext): void {
    const types = Array.isArray(plugin.type) ? plugin.type : [plugin.type];
    for (const type of types) {
      switch (type) {
        case 'llm': {
          this.llmRegistry.register(plugin as unknown as LLMPlugin);
          break;
        }
        case 'tool': {
          this.toolRegistry.registerToolbox(plugin as unknown as ToolPlugin);
          break;
        }
        case 'channel': {
          if (plugin.id) {
            this.channelRegistry.register({ id: plugin.id });
          }
          break;
        }
        default: {
          ctx.logger.warn(`未知类型的能力试图注册: ${plugin.name} (ID: ${plugin.id}, Type: ${type})`);
        }
      }
    }
  }

  unregister(plugin: FreyaPlugin): void {
    const pluginId = plugin.id || '';
    const types = Array.isArray(plugin.type) ? plugin.type : [plugin.type];
    for (const type of types) {
      switch (type) {
        case 'llm':
          this.llmRegistry.unregister(pluginId);
          break;
        case 'tool': {
          const tool = plugin as unknown as ToolPlugin;
          this.toolRegistry.unregisterToolbox(tool.getId());
          break;
        }
        case 'channel':
          this.channelRegistry.unregister(pluginId);
          break;
      }
    }
  }
}
