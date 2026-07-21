import type { LLMPlugin, FreyaContext } from '@eoasmxd/freya-sdk';
import type { ProviderConfig, ModelConfig } from '../config/types.js';

export class FreyaLLMRegistry {
  private _providers: ProviderConfig[] = [];
  private llmPlugins = new Map<string, LLMPlugin>();
  private defaultLLMPlugin?: LLMPlugin;

  findModelConfig(modelId: string, providerId?: string): ModelConfig | undefined {
    if (providerId) {
      const provider = this._providers.find((p) => p.id === providerId);
      const model = provider?.models.find((m) => m.id === modelId);
      if (model) return model;
    }

    const allModels = this._providers.flatMap((p) => p.models);
    let matched = allModels.find((m) => m.id === modelId);
    if (!matched) {
      matched = allModels.find((m) => modelId.toLowerCase().includes(m.id.toLowerCase()));
    }
    return matched;
  }

  get providers(): ProviderConfig[] {
    return this._providers;
  }

  setProviders(providers: ProviderConfig[]): void {
    this._providers = providers;
  }

  register(plugin: LLMPlugin): void {
    if (plugin.id) {
      this.llmPlugins.set(plugin.id, plugin);
    }
    if (!this.defaultLLMPlugin) {
      this.defaultLLMPlugin = plugin;
    }
  }

  /** 注销大模型插件实例 */
  unregister(pluginId: string): void {
    this.llmPlugins.delete(pluginId);
    if (this.defaultLLMPlugin?.id === pluginId) {
      this.defaultLLMPlugin = Array.from(this.llmPlugins.values())[0];
    }
  }

  /** 获取全局默认的大模型插件实例 */
  getDefault(): LLMPlugin | undefined {
    return this.defaultLLMPlugin;
  }

  /** 手动强制覆盖设置默认大模型插件实例 */
  setDefault(plugin: LLMPlugin): void {
    this.defaultLLMPlugin = plugin;
  }

  /** 获取当前登记的所有 LLM 插件实例 Map */
  getPlugins(): Map<string, LLMPlugin> {
    return this.llmPlugins;
  }

  /** 根据指定的 ProviderID 与 providers 物理配置，动态路由并匹配最契合的大模型插件实例 */
  getPluginForProvider(providerId?: string): LLMPlugin {
    if (!this.defaultLLMPlugin) {
      throw new Error('未加载到任何有效的大模型插件。');
    }
    if (!providerId) {
      return this.defaultLLMPlugin;
    }
    const provider = this._providers.find((p) => p.id === providerId);
    if (provider) {
      for (const plugin of this.llmPlugins.values()) {
        if (plugin.providerTypes && plugin.providerTypes.includes(provider.type)) {
          return plugin;
        }
      }
    }
    return this.defaultLLMPlugin;
  }
}
