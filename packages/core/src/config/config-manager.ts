import type { ConfigFieldSchema, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaLLMRegistry } from '../llm/llm-registry.js';
import type { FreyaPluginManager } from '../plugin/plugin-manager.js';
import type { FreyaPromptManager } from '../prompt/prompt-manager.js';
import { FreyaConfigFileHandler } from './file-handler.js';
import { FreyaConfigSchemaRegistry } from './schema-registry.js';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/paths.js';

function cleanPathFromError(err: any): string {
  const rawMessage = err?.message || String(err);
  const escapedCwd = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedCwd + '[\\\\/]?', 'g');
  return rawMessage.replace(regex, '');
}

function maskSensitiveData(data: any, sensitiveKeys: string[]): any {
  if (!sensitiveKeys || sensitiveKeys.length === 0) {
    return data;
  }
  const clone = JSON.parse(JSON.stringify(data));
  const keys = new Set(sensitiveKeys);

  const processNode = (obj: any, currentPath: string) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k in obj) {
      const nextPath = currentPath ? `${currentPath}.${k}` : k;
      let matched = keys.has(nextPath);
      if (!matched) {
        for (const pattern of keys) {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^\\.]+') + '$');
            if (regex.test(nextPath)) {
              matched = true;
              break;
            }
          }
        }
      }

      if (matched) {
        obj[k] = '******';
      } else {
        processNode(obj[k], nextPath);
      }
    }
  };

  processNode(clone, '');
  return clone;
}

function getValueByKeyPath(obj: any, keyPath: string): any {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setValueByKeyPath(obj: any, keyPath: string, value: any): void {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function filterConfigBySchema(data: any, schemaRegistry: FreyaConfigSchemaRegistry): any {
  if (!data || typeof data !== 'object') return data;

  const result: Record<string, any> = {};
  const schemaMap = schemaRegistry.getSchema();
  const allFields: ConfigFieldSchema[] = [];

  for (const fields of schemaMap.values()) {
    allFields.push(...fields);
  }

  for (const field of allFields) {
    const value = getValueByKeyPath(data, field.key);
    if (value === undefined) {
      continue;
    }

    if (field.children && field.type === 'array') {
      if (Array.isArray(value)) {
        const filteredArr = value.map((item: any) => {
          if (item && typeof item === 'object' && field.children) {
            const cleanedItem: Record<string, any> = {};
            for (const child of field.children) {
              if (child.key in item) {
                cleanedItem[child.key] = item[child.key];
              }
            }
            return cleanedItem;
          }
          return item;
        });
        setValueByKeyPath(result, field.key, filteredArr);
      } else {
        setValueByKeyPath(result, field.key, value);
      }
    } else {
      setValueByKeyPath(result, field.key, value);
    }
  }

  return result;
}

function deepMerge(defaults: Record<string, any>, overrides: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const defaultVal = defaults[key];
    const overrideVal = overrides[key];

    if (defaultVal !== undefined && overrideVal !== undefined) {
      const defaultIsObj = typeof defaultVal === 'object' && defaultVal !== null && !Array.isArray(defaultVal);
      const overrideIsObj = typeof overrideVal === 'object' && overrideVal !== null && !Array.isArray(overrideVal);
      if (defaultIsObj !== overrideIsObj) {
        continue;
      }
    }

    if (
      defaultVal && typeof defaultVal === 'object' && !Array.isArray(defaultVal) &&
      overrideVal && typeof overrideVal === 'object' && !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

const ALLOWED_PROMPTS = new Set(['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY']);

/** 核心统一配置管理器 */
export class FreyaConfigManager {
  private context: FreyaContext;
  private schemaRegistry: FreyaConfigSchemaRegistry;
  private fileHandler = new FreyaConfigFileHandler();
  private llmRegistry: FreyaLLMRegistry;
  private pluginManager: FreyaPluginManager;
  private promptManager: FreyaPromptManager;

  constructor(
    context: FreyaContext,
    schemaRegistry: FreyaConfigSchemaRegistry,
    promptManager: FreyaPromptManager,
    llmRegistry: FreyaLLMRegistry,
    pluginManager: FreyaPluginManager
  ) {
    this.context = context;
    this.schemaRegistry = schemaRegistry;
    this.promptManager = promptManager;
    this.llmRegistry = llmRegistry;
    this.pluginManager = pluginManager;
  }

  /** 获取全部敏感字段的 keyPath 列表 */
  getSensitiveKeys(): string[] {
    return this.schemaRegistry.getSensitiveKeys();
  }

  async loadAndInit(): Promise<{ port: number }> {
    let port = 3000;
    try {
      const freyaConfig = await this.fileHandler.readFreyaConfig();
      if (freyaConfig && typeof freyaConfig.port === 'number') {
        port = freyaConfig.port;
      }

      this.updateContextConfig(freyaConfig);

      if (typeof (this.context.logger as any).setConsoleLevel === 'function') {
        const consoleCfg = freyaConfig?.log?.console;
        if (consoleCfg && typeof consoleCfg === 'object') {
          (this.context.logger as any).setConsoleLevel(consoleCfg);
        }
      }
    } catch (err: any) {
      this.context.logger.error('加载主配置文件 freya.json 失败，将使用默认端口 3000:', err);
    }
    return { port };
  }

  async mergeAndPersist(): Promise<void> {
    try {
      const existingConfig = await this.fileHandler.readFreyaConfig();
      const defaults = this.schemaRegistry.getDefaults();
      const merged = deepMerge(defaults, existingConfig);

      this.updateContextConfig(merged);
      await this.fileHandler.writeFreyaConfig(merged);
      this.context.logger.info('配置模式合并完成，已回写至 config/freya.json。');
    } catch (err: any) {
      this.context.logger.error('合并配置模式并回写 freya.json 失败:', err);
    }
  }

  async resolveAndFreeze(): Promise<void> {
    await this.mergeAndPersist();
  }

  private updateContextConfig(config: Record<string, any>) {
    const deepFreeze = (obj: any): any => {
      if (obj && typeof obj === 'object') {
        Object.freeze(obj);
        Object.keys(obj).forEach((key) => {
          deepFreeze(obj[key]);
        });
      }
      return obj;
    };
    const cloned = JSON.parse(JSON.stringify(config));
    if (cloned.workspace && typeof cloned.workspace === 'string') {
      if (!path.isAbsolute(cloned.workspace)) {
        cloned.workspace = path.resolve(PROJECT_ROOT, cloned.workspace);
      }
    } else {
      cloned.workspace = path.join(PROJECT_ROOT, 'workspace');
    }
    (this.context as any).config = deepFreeze(cloned);
  }

  async readConfig(revealSensitive = false): Promise<any> {
    const jsonObj = await this.fileHandler.readFreyaConfig();
    const filtered = filterConfigBySchema(jsonObj, this.schemaRegistry);
    const sensitiveKeys = this.schemaRegistry.getSensitiveKeys();
    return revealSensitive ? filtered : maskSensitiveData(filtered, sensitiveKeys);
  }

  async updateConfig(keyPath: string, value: any): Promise<string> {
    const jsonObj = await this.fileHandler.readFreyaConfig();
    const oldValue = getValueByKeyPath(jsonObj, keyPath);

    const restoreMaskedValues = (newValue: any, oldVal: any): any => {
      if (newValue === '******') {
        return oldVal !== undefined ? oldVal : newValue;
      }
      if (Array.isArray(newValue) && Array.isArray(oldVal)) {
        return newValue.map((item, idx) => restoreMaskedValues(item, oldVal[idx]));
      }
      if (newValue && typeof newValue === 'object' && oldVal && typeof oldVal === 'object') {
        const res: Record<string, any> = {};
        for (const k in newValue) {
          res[k] = restoreMaskedValues(newValue[k], oldVal[k]);
        }
        return res;
      }
      return newValue;
    };

    const safeValue = restoreMaskedValues(value, oldValue);

    setValueByKeyPath(jsonObj, keyPath, safeValue);
    await this.fileHandler.writeFreyaConfig(jsonObj);

    const rawConfig = JSON.parse(JSON.stringify(this.context.config));
    setValueByKeyPath(rawConfig, keyPath, safeValue);
    this.updateContextConfig(rawConfig);

    return `核心配置中的属性 "${keyPath}" 已成功修改，已实时生效。`;
  }

  async updateConfigs(updates: Record<string, any>): Promise<string> {
    const jsonObj = await this.fileHandler.readFreyaConfig();

    const restoreMaskedValues = (newValue: any, oldVal: any): any => {
      if (newValue === '******') {
        return oldVal !== undefined ? oldVal : newValue;
      }
      if (Array.isArray(newValue) && Array.isArray(oldVal)) {
        return newValue.map((item, idx) => restoreMaskedValues(item, oldVal[idx]));
      }
      if (newValue && typeof newValue === 'object' && oldVal && typeof oldVal === 'object') {
        const res: Record<string, any> = {};
        for (const k in newValue) {
          res[k] = restoreMaskedValues(newValue[k], oldVal[k]);
        }
        return res;
      }
      return newValue;
    };

    for (const [keyPath, value] of Object.entries(updates)) {
      const oldValue = getValueByKeyPath(jsonObj, keyPath);
      const safeValue = restoreMaskedValues(value, oldValue);
      setValueByKeyPath(jsonObj, keyPath, safeValue);
    }

    await this.fileHandler.writeFreyaConfig(jsonObj);

    const rawConfig = JSON.parse(JSON.stringify(this.context.config));
    for (const [keyPath, value] of Object.entries(updates)) {
      const oldValue = getValueByKeyPath(rawConfig, keyPath);
      const safeValue = restoreMaskedValues(value, oldValue);
      setValueByKeyPath(rawConfig, keyPath, safeValue);
    }
    this.updateContextConfig(rawConfig);

    return '全量全局配置已成功修改，并实时热更新生效。';
  }

  async listProviders(): Promise<any[]> {
    return await this.fileHandler.readProviders();
  }

  async addProvider(data: { id: string; name: string; type: string; baseURL: string; apiKey?: string }): Promise<string> {
    const id = String(data.id || '').trim();
    if (!id) return '❌ 缺少必要参数：id 不能为空。';
    const providers = await this.fileHandler.readProviders();
    if (providers.find((p) => p.id === id)) return `❌ 提供商 ID "${id}" 已存在。`;
    providers.push({
      id,
      name: String(data.name || '').trim(),
      type: String(data.type || '').trim(),
      baseURL: String(data.baseURL || '').trim(),
      apiKey: String(data.apiKey || ''),
      models: []
    });
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] 新增模型提供商: ${id}`);
    return `模型提供商 "${id}" 已成功新增。`;
  }

  async editProvider(providerId: string, updates: Record<string, any>): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return `❌ 未找到提供商 ID 为 "${providerId}" 的配置条目。`;
    const updatedKeys: string[] = [];
    if (updates.name !== undefined) { provider.name = String(updates.name).trim(); updatedKeys.push('name'); }
    if (updates.type !== undefined) { provider.type = String(updates.type).trim(); updatedKeys.push('type'); }
    if (updates.baseURL !== undefined) { provider.baseURL = String(updates.baseURL).trim(); updatedKeys.push('baseURL'); }
    if (updates.apiKey !== undefined) { provider.apiKey = String(updates.apiKey); updatedKeys.push('apiKey'); }
    if (updatedKeys.length === 0) return '⚠️ 未指定任何需要修改的属性。';
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] 修改模型提供商 "${providerId}" 属性: ${updatedKeys.join(', ')}`);
    return `提供商 "${providerId}" 的属性 [${updatedKeys.join(', ')}] 已成功修改。`;
  }

  async removeProvider(providerId: string): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const index = providers.findIndex((p) => p.id === providerId);
    if (index === -1) return `❌ 未找到提供商 ID 为 "${providerId}" 的配置条目。`;
    providers.splice(index, 1);
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] 删除模型提供商: ${providerId}`);
    return `模型提供商 "${providerId}" 及其所有模型配置已删除。`;
  }

  async getAvailableProviderTypes(): Promise<string[]> {
    if (!this.llmRegistry) return ['openai'];
    const types = new Set<string>();
    for (const plugin of this.llmRegistry.getPlugins().values()) {
      if (Array.isArray(plugin.providerTypes)) {
        for (const t of plugin.providerTypes) {
          types.add(t);
        }
      }
    }
    return Array.from(types);
  }

  async listModels(providerId?: string): Promise<any[]> {
    const providers = await this.fileHandler.readProviders();
    const filtered = providerId ? providers.filter((p) => p.id === providerId) : providers;
    const models: any[] = [];
    for (const p of filtered) {
      const pModels = Array.isArray(p.models) ? p.models : [];
      for (const m of pModels) {
        models.push({ ...m, providerId: p.id, providerName: p.name });
      }
    }
    return models;
  }

  async addModel(providerId: string, data: Record<string, any>): Promise<string> {
    const modelId = String(data.id || '').trim();
    if (!modelId) return '❌ 缺少必要参数：id 不能为空。';
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return `❌ 未找到提供商 ID 为 "${providerId}" 的配置条目。`;

    if (!Array.isArray(provider.models)) provider.models = [];
    if (provider.models.find((m: any) => m.id === modelId)) {
      return `❌ 模型 ID "${modelId}" 在提供商 "${providerId}" 下已存在。`;
    }

    provider.models.push({
      id: modelId,
      name: String(data.name || '').trim(),
      inputPrice: Number(data.inputPrice) || 0,
      outputPrice: Number(data.outputPrice) || 0,
      cachedInputPrice: Number(data.cachedInputPrice) || 0,
      contextWindow: Number(data.contextWindow) || 0,
      contextTokens: data.contextTokens !== undefined ? Number(data.contextTokens) : undefined,
      maxTokens: data.maxTokens !== undefined ? Number(data.maxTokens) : undefined,
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : ['text']
    });

    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] 新增模型: ${providerId}/${modelId}`);
    return `模型 "${modelId}" 已成功新增至提供商 "${providerId}"。`;
  }

  async editModel(providerId: string, modelId: string, updates: Record<string, any>): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return `❌ 未找到提供商 ID 为 "${providerId}" 的配置条目。`;

    const models = Array.isArray(provider.models) ? provider.models : [];
    const model = models.find((m: any) => m.id === modelId);
    if (!model) return `❌ 未找到模型 ID 为 "${modelId}" 的配置条目（提供商 "${providerId}"）。`;

    const updatedKeys: string[] = [];
    if (updates.name !== undefined) { model.name = String(updates.name).trim(); updatedKeys.push('name'); }
    if (updates.inputPrice !== undefined) { model.inputPrice = Number(updates.inputPrice); updatedKeys.push('inputPrice'); }
    if (updates.outputPrice !== undefined) { model.outputPrice = Number(updates.outputPrice); updatedKeys.push('outputPrice'); }
    if (updates.cachedInputPrice !== undefined) { model.cachedInputPrice = Number(updates.cachedInputPrice); updatedKeys.push('cachedInputPrice'); }
    if (updates.contextWindow !== undefined) { model.contextWindow = Number(updates.contextWindow); updatedKeys.push('contextWindow'); }
    if (updates.contextTokens !== undefined) { model.contextTokens = Number(updates.contextTokens); updatedKeys.push('contextTokens'); }
    if (updates.maxTokens !== undefined) { model.maxTokens = Number(updates.maxTokens); updatedKeys.push('maxTokens'); }
    if (updates.capabilities !== undefined) { model.capabilities = updates.capabilities; updatedKeys.push('capabilities'); }

    if (updatedKeys.length === 0) return '⚠️ 未指定任何需要修改的属性。';

    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] 修改模型 "${providerId}/${modelId}" 属性: ${updatedKeys.join(', ')}`);
    return `模型 "${modelId}"（提供商 "${providerId}"）的属性 [${updatedKeys.join(', ')}] 已成功修改。`;
  }

  async removeModel(providerId: string, modelId: string): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return `❌ 未找到提供商 ID 为 "${providerId}" 的配置条目。`;

    const models = Array.isArray(provider.models) ? provider.models : [];
    const index = models.findIndex((m: any) => m.id === modelId);
    if (index === -1) return `❌ 未找到模型 ID 为 "${modelId}" 的配置条目（提供商 "${providerId}"）。`;

    models.splice(index, 1);
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] 删除模型: ${providerId}/${modelId}`);
    return `模型 "${modelId}"（提供商 "${providerId}"）已成功删除。`;
  }

  async listPlugins(): Promise<any[]> {
    if (!this.pluginManager) return [];
    const entries = this.pluginManager.getPluginEntries();

    return entries.map((entry) => ({
      id: entry.id,
      enabled: entry.enabled,
      valid: entry.valid !== false,
      status: entry.status || (entry.enabled ? 'active' : 'disabled'),
      errorReason: entry.errorReason || '',
      source: entry.source || 'builtin',
      displayName: entry.displayName || entry.id,
      description: entry.description || '',
      version: entry.version || ''
    }));
  }

  async togglePlugin(pluginId: string, enabled: boolean): Promise<string> {
    if (!this.pluginManager) return '❌ 插件服务未初始化。';
    return await this.pluginManager.togglePlugin(pluginId, enabled);
  }

  async readPrompt(name: string): Promise<string> {
    const promptName = String(name).trim().toUpperCase();
    if (!ALLOWED_PROMPTS.has(promptName)) {
      return `❌ 拒绝访问：主提示词文档 "${promptName}" 不在安全白名单中（只允许: IDENTITY, SOUL, USER, TOOLS, AGENTS, MEMORY）。`;
    }
    if (!this.promptManager) return '❌ 提示词服务未初始化。';
    return await this.promptManager.readPrompt(promptName);
  }

  async writePrompt(name: string, content: string): Promise<string> {
    const promptName = String(name).trim().toUpperCase();
    if (!ALLOWED_PROMPTS.has(promptName)) {
      return '❌ 拒绝访问：主提示词文档不在安全白名单中，拒绝修改。';
    }
    if (!this.promptManager) return '❌ 提示词服务未初始化。';

    await this.promptManager.writePrompt(promptName, content);
    this.context.logger.info(`[FreyaConfigManager] 主提示词 "${promptName}" 已成功全量覆写并热更新入底座。`);
    return `主提示词文档 [${promptName}] 已覆盖写入并实时生效。`;
  }

  async editPrompt(name: string, targetContent: string, replacementContent: string): Promise<string> {
    const promptName = String(name).trim().toUpperCase();
    if (!ALLOWED_PROMPTS.has(promptName)) {
      return `❌ 拒绝访问：主提示词文档 "${promptName}" 不在允许读写的安全白名单中（只允许: IDENTITY, SOUL, USER, TOOLS, AGENTS, MEMORY）。`;
    }
    if (!this.promptManager) return '❌ 提示词服务未初始化。';

    try {
      await this.promptManager.editPrompt(promptName, targetContent, replacementContent);
      this.context.logger.info(`[FreyaConfigManager] 主提示词 "${promptName}" 局部修改热生效。`);
      return `主提示词文档 [${promptName}] 局部替换成功，已实时应用。`;
    } catch (err: any) {
      return `❌ 修改失败：${err.message}`;
    }
  }

  registerCoreSchema(): void {
    const modelItemChildren: ConfigFieldSchema[] = [
      { key: 'provider', type: 'string', required: true, description: 'LLM 提供商标识' },
      { key: 'model', type: 'string', required: true, description: '模型名称' },
      { key: 'name', type: 'string', required: true, description: '显示名称' },
    ];

    const coreFields: ConfigFieldSchema[] = [
      {
        key: 'port',
        defaultValue: 3000,
        description: 'Web 网关服务端口',
        type: 'number',
        required: true,
        min: 1,
        max: 65535,
        category: '服务器'
      },
      {
        key: 'workspace',
        defaultValue: 'workspace',
        description: '用户文档工作区目录名',
        type: 'string',
        required: true,
        category: '工作区'
      },
      {
        key: 'contextManagement.enabled',
        defaultValue: true,
        description: '是否启用上下文管理',
        type: 'boolean',
        category: '上下文管理'
      },
      {
        key: 'contextManagement.maxHistoryTurns',
        defaultValue: 15,
        description: '上下文历史最大轮数',
        type: 'number',
        min: 1,
        max: 100,
        category: '上下文管理'
      },
      {
        key: 'contextManagement.historyLimit',
        defaultValue: 100,
        description: '上下文历史消息条数上限',
        type: 'number',
        min: 10,
        max: 500,
        category: '上下文管理'
      },
      {
        key: 'contextManagement.keepRecentTurns',
        defaultValue: 6,
        description: '压缩时保留的最近轮数',
        type: 'number',
        min: 1,
        max: 50,
        category: '上下文管理'
      },
      {
        key: 'contextManagement.summarizeEnabled',
        defaultValue: true,
        description: '是否启用上下文摘要压缩',
        type: 'boolean',
        category: '上下文管理'
      },
      {
        key: 'contextManagement.summaryMaxTokens',
        defaultValue: 150,
        description: '上下文摘要压缩时，控制摘要生成的最大 Token 长度',
        type: 'number',
        min: 50,
        max: 1000,
        category: '上下文管理'
      },
      {
        key: 'log.console.error',
        defaultValue: true,
        description: '控制台输出 ERROR 日志（红色）',
        type: 'boolean',
        category: '日志'
      },
      {
        key: 'log.console.warn',
        defaultValue: false,
        description: '控制台输出 WARN 日志（黄色）',
        type: 'boolean',
        category: '日志'
      },
      {
        key: 'log.console.info',
        defaultValue: false,
        description: '控制台输出 INFO 日志（绿色）',
        type: 'boolean',
        category: '日志'
      },
      {
        key: 'log.console.debug',
        defaultValue: false,
        description: '控制台输出 DEBUG 日志（灰色）',
        type: 'boolean',
        category: '日志'
      },
      {
        key: 'log.llm',
        defaultValue: false,
        description: '是否记录大模型交互日志',
        type: 'boolean',
        category: '日志'
      },
      {
        key: 'models.default',
        defaultValue: [],
        description: '默认模型降级链列表',
        type: 'array',
        category: '模型',
        children: modelItemChildren
      },
      {
        key: 'models.image',
        defaultValue: [],
        description: '图像模型列表',
        type: 'array',
        category: '模型',
        children: modelItemChildren
      },
      {
        key: 'models.audio',
        defaultValue: [],
        description: '音频转录模型列表',
        type: 'array',
        category: '模型',
        children: modelItemChildren
      },
      {
        key: 'config.authTimeout',
        defaultValue: 30,
        description: 'AI 代理配置修改等待授权超时秒数',
        type: 'number',
        min: 10,
        max: 300,
        category: '安全'
      }
    ];

    this.schemaRegistry.register('core', coreFields);
  }

  getSchema(): Map<string, any> {
    return this.schemaRegistry.getSchema();
  }
}
