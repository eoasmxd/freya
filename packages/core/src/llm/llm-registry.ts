import type { LLMPlugin, FreyaContext } from '@eoasmxd/freya-sdk';
import type { ProviderConfig, ModelConfig } from '../config/types.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

export class FreyaLLMRegistry {
  private _providers: ProviderConfig[] = [];
  private llmPlugins = new Map<string, LLMPlugin>();
  private defaultLLMPlugin?: LLMPlugin;
  private readonly i18n: I18n;

  constructor(ctx?: FreyaContext) {
    this.i18n = new I18n({ zh, en }, ctx);
  }

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

  /**
   * 注销大模型插件实例
   * Unregister LLM plugin instance
   */
  unregister(pluginId: string): void {
    this.llmPlugins.delete(pluginId);
    if (this.defaultLLMPlugin?.id === pluginId) {
      this.defaultLLMPlugin = Array.from(this.llmPlugins.values())[0];
    }
  }

  /**
   * 获取全局默认的大模型插件实例
   * Get global default LLM plugin instance
   */
  getDefault(): LLMPlugin | undefined {
    return this.defaultLLMPlugin;
  }

  /**
   * 手动强制覆盖设置默认大模型插件实例
   * Manually override default LLM plugin instance
   */
  setDefault(plugin: LLMPlugin): void {
    this.defaultLLMPlugin = plugin;
  }

  /**
   * 获取当前登记的所有 LLM 插件实例 Map
   * Get Map of all currently registered LLM plugin instances
   */
  getPlugins(): Map<string, LLMPlugin> {
    return this.llmPlugins;
  }

  /**
   * 根据指定的 ProviderID 与 providers 物理配置，动态路由并匹配最契合的大模型插件实例
   * Dynamically route and match the best-fit LLM plugin instance based on ProviderID and providers config
   */
  getPluginForProvider(providerId?: string): LLMPlugin {
    if (!this.defaultLLMPlugin) {
      throw new Error(this.i18n.t('llm.error.noPluginLoaded', 'No valid LLM plugin loaded in system. Please check plugin and model configurations.'));
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
