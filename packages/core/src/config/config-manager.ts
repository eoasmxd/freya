import type { ConfigFieldSchema, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaLLMRegistry } from '../llm/llm-registry.js';
import type { FreyaPluginManager } from '../plugin/plugin-manager.js';
import type { FreyaPromptManager } from '../prompt/prompt-manager.js';
import { FreyaConfigFileHandler } from './file-handler.js';
import { FreyaConfigSchemaRegistry } from './schema-registry.js';
import type { FreyaSkillRegistry, FreyaSkill } from '../skill/skill-registry.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { FREYA_HOME } from '../utils/paths.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

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

/**
 * 核心统一配置管理器
 * Core unified configuration manager
 */
export class FreyaConfigManager {
  private context: FreyaContext;
  private schemaRegistry: FreyaConfigSchemaRegistry;
  private fileHandler = new FreyaConfigFileHandler();
  private llmRegistry: FreyaLLMRegistry;
  private pluginManager: FreyaPluginManager;
  private promptManager: FreyaPromptManager;
  private skillRegistry?: FreyaSkillRegistry;
  private i18n = new I18n({ zh, en });

  constructor(
    context: FreyaContext,
    schemaRegistry: FreyaConfigSchemaRegistry,
    promptManager: FreyaPromptManager,
    llmRegistry: FreyaLLMRegistry,
    pluginManager: FreyaPluginManager,
    skillRegistry?: FreyaSkillRegistry
  ) {
    this.context = context;
    this.schemaRegistry = schemaRegistry;
    this.promptManager = promptManager;
    this.llmRegistry = llmRegistry;
    this.pluginManager = pluginManager;
    this.skillRegistry = skillRegistry;
    this.i18n.setContext(context);
  }

  /**
   * 获取全部敏感字段的 keyPath 列表
   * Get keyPath list of all sensitive fields
   */
  getSensitiveKeys(): string[] {
    return this.schemaRegistry.getSensitiveKeys();
  }

  getManualOnlyKeys(): string[] {
    return this.schemaRegistry.getManualOnlyKeys();
  }

  /**
   * 获取只读锁定字段的 keyPath 列表（支持合并 manualOnly 字段）
   * Get keyPath list of read-only locked fields (supports merging manualOnly fields)
   */
  getReadonlyKeys(includeManualOnly = false): string[] {
    const readonlySet = new Set<string>();
    for (const [ns, fields] of this.schemaRegistry.getSchema().entries()) {
      for (const field of fields) {
        if (this.isFieldReadonly(field.key, ns)) {
          readonlySet.add(field.key);
        }
      }
    }
    if (includeManualOnly) {
      for (const key of this.getManualOnlyKeys()) {
        readonlySet.add(key);
      }
    }
    return Array.from(readonlySet);
  }

  async loadAndInit(): Promise<void> {
    try {
      const freyaConfig = await this.fileHandler.readFreyaConfig();
      this.updateContextConfig(freyaConfig);

      if (typeof (this.context.logger as any).setConsoleLevel === 'function') {
        const consoleCfg = freyaConfig?.log?.console;
        if (consoleCfg && typeof consoleCfg === 'object') {
          (this.context.logger as any).setConsoleLevel(consoleCfg);
        }
      }
    } catch (err: any) {
      this.context.logger.error('Failed to load primary configuration file freya.json:', err);
    }
  }

  async mergeAndPersist(): Promise<void> {
    try {
      const existingConfig = await this.fileHandler.readFreyaConfig();
      const defaults = this.schemaRegistry.getDefaults();
      const merged = deepMerge(defaults, existingConfig);

      this.updateContextConfig(merged);
      await this.fileHandler.writeFreyaConfig(merged);
      this.context.logger.info('Configuration schema merged and written back to config/freya.json.');
    } catch (err: any) {
      this.context.logger.error('Failed to merge configuration schema and write back to freya.json:', err);
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
        cloned.workspace = path.resolve(FREYA_HOME, cloned.workspace);
      }
    } else {
      cloned.workspace = path.join(FREYA_HOME, 'workspace');
    }

    const portIdx = process.argv.indexOf('--port');
    if (portIdx !== -1 && portIdx + 1 < process.argv.length) {
      const cliPort = parseInt(process.argv[portIdx + 1], 10);
      if (!isNaN(cliPort) && cliPort > 0 && cliPort <= 65535) {
        if (!cloned.server) cloned.server = {};
        cloned.server.port = cliPort;
      }
    }

    (this.context as any).config = deepFreeze(cloned);
  }

  /**
   * 读取经过过滤与脱敏的配置对象
   * Read filtered and masked configuration object
   *
   * @param revealSensitive 是否向调用方暴露普通敏感字段（为 true 时仅脱敏密码凭证供管理后台，为 false 时对 AI 等全量脱敏）
   *                        Whether to reveal ordinary sensitive fields (when true only password credentials are masked for web console, when false fully masked for AI etc.)
   */
  async readConfig(revealSensitive = false): Promise<any> {
    const jsonObj = await this.fileHandler.readFreyaConfig();
    const filtered = filterConfigBySchema(jsonObj, this.schemaRegistry);
    if ((this.context?.config as any)?.server?.port !== undefined && process.argv.includes('--port')) {
      if (!filtered.server) filtered.server = {};
      filtered.server.port = (this.context.config as any).server.port;
    }
    const maskKeys = revealSensitive
      ? this.schemaRegistry.getPasswordKeys()
      : this.schemaRegistry.getSensitiveKeys();
    return maskSensitiveData(filtered, maskKeys);
  }

  /**
   * 检查指定配置项是否处于只读锁定状态
   * Check whether specified configuration item is locked as read-only
   */
  isFieldReadonly(keyPath: string, namespace?: string): boolean {
    if (keyPath === 'cli.enabled' && process.argv.includes('--no-cli')) {
      return true;
    }

    if ((keyPath === 'server.port' || keyPath === 'server.enabled') && process.argv.includes('--port')) {
      return true;
    }

    if ((keyPath === 'server.auth.enabled' || keyPath === 'server.auth.password') && process.argv.includes('--no-auth')) {
      return true;
    }

    if (this.pluginManager) {
      let targetPluginId = namespace;
      if (!targetPluginId) {
        for (const [ns, fields] of this.schemaRegistry.getSchema().entries()) {
          if (ns !== 'core' && fields.some((f) => f.key === keyPath || keyPath.startsWith(`${f.key}.`))) {
            targetPluginId = ns;
            break;
          }
        }
      }
      if (targetPluginId && targetPluginId !== 'core') {
        const entries = this.pluginManager.getPluginEntries();
        const entry = entries.find((e) => e.id === targetPluginId);
        if (entry && (entry.enabled === false || entry.status === 'disabled')) {
          return true;
        }
      }
    }
    return false;
  }

  async updateConfig(keyPath: string, value: any): Promise<string> {
    if (this.isFieldReadonly(keyPath)) {
      return this.i18n.t(
        'config.error.readonlyRejected',
        '❌ Property "{keyPath}" is currently read-only (locked by startup arguments or disabled plugin) and cannot be modified.',
        { keyPath }
      );
    }
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

    let safeValue = restoreMaskedValues(value, oldValue);
    const fieldSchema = this.schemaRegistry.findField(keyPath);
    if (fieldSchema?.type === 'sha256') {
      if (value === '******' || value === oldValue || typeof value !== 'string') {
        safeValue = oldValue;
      } else if (value.trim().length > 0) {
        safeValue = crypto.createHash('sha256').update(value).digest('hex');
      } else {
        safeValue = '';
      }
    }

    setValueByKeyPath(jsonObj, keyPath, safeValue);
    await this.fileHandler.writeFreyaConfig(jsonObj);

    const rawConfig = JSON.parse(JSON.stringify(this.context.config));
    setValueByKeyPath(rawConfig, keyPath, safeValue);
    this.updateContextConfig(rawConfig);

    if (keyPath === 'system.language') {
      this.context.eventBus.emit('config:language_changed', { language: safeValue });
    }

    return this.i18n.t(
      'config.update.propertySuccess',
      'Property "{keyPath}" in core configuration has been modified and took effect immediately.',
      { keyPath }
    );
  }

  async updateConfigs(updates: Record<string, any>): Promise<string> {
    const writableUpdates: Record<string, any> = {};
    for (const [keyPath, value] of Object.entries(updates)) {
      if (!this.isFieldReadonly(keyPath)) {
        writableUpdates[keyPath] = value;
      }
    }
    updates = writableUpdates;
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

    const actualValues: Record<string, any> = {};
    for (const [keyPath, value] of Object.entries(updates)) {
      const oldValue = getValueByKeyPath(jsonObj, keyPath);
      let safeValue = restoreMaskedValues(value, oldValue);
      const fieldSchema = this.schemaRegistry.findField(keyPath);
      if (fieldSchema?.type === 'sha256') {
        if (value === '******' || value === oldValue || typeof value !== 'string') {
          safeValue = oldValue;
        } else if (value.trim().length > 0) {
          safeValue = crypto.createHash('sha256').update(value).digest('hex');
        } else {
          safeValue = '';
        }
      }
      actualValues[keyPath] = safeValue;
      setValueByKeyPath(jsonObj, keyPath, safeValue);
    }

    await this.fileHandler.writeFreyaConfig(jsonObj);

    const rawConfig = JSON.parse(JSON.stringify(this.context.config));
    for (const [keyPath, safeValue] of Object.entries(actualValues)) {
      setValueByKeyPath(rawConfig, keyPath, safeValue);
    }
    this.updateContextConfig(rawConfig);

    if (updates['system.language']) {
      this.context.eventBus.emit('config:language_changed', { language: updates['system.language'] });
    }

    return this.i18n.t(
      'config.update.globalSuccess',
      'Global configuration has been updated and hot reloaded successfully.'
    );
  }

  async listProviders(): Promise<any[]> {
    return await this.fileHandler.readProviders();
  }

  async addProvider(data: { id: string; name: string; type: string; baseURL: string; apiKey?: string }): Promise<string> {
    const id = String(data.id || '').trim();
    if (!id) {
      return this.i18n.t('config.provider.missingId', '❌ Missing required parameter: id cannot be empty.');
    }
    const providers = await this.fileHandler.readProviders();
    if (providers.find((p) => p.id === id)) {
      return this.i18n.t('config.provider.alreadyExists', '❌ Provider ID "{id}" already exists.', { id });
    }
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
    this.context.logger.info(`[FreyaConfigManager] Added model provider: ${id}`);
    return this.i18n.t('config.provider.addSuccess', 'Model provider "{id}" added successfully.', { id });
  }

  async editProvider(providerId: string, updates: Record<string, any>): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      return this.i18n.t('config.provider.notFound', '❌ Provider with ID "{id}" not found.', { id: providerId });
    }
    const updatedKeys: string[] = [];
    if (updates.name !== undefined) { provider.name = String(updates.name).trim(); updatedKeys.push('name'); }
    if (updates.type !== undefined) { provider.type = String(updates.type).trim(); updatedKeys.push('type'); }
    if (updates.baseURL !== undefined) { provider.baseURL = String(updates.baseURL).trim(); updatedKeys.push('baseURL'); }
    if (updates.apiKey !== undefined) { provider.apiKey = String(updates.apiKey); updatedKeys.push('apiKey'); }
    if (updatedKeys.length === 0) {
      return this.i18n.t('config.provider.noUpdates', '⚠️ No attributes specified to update.');
    }
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] Updated model provider "${providerId}" attributes: ${updatedKeys.join(', ')}`);
    return this.i18n.t(
      'config.provider.updateSuccess',
      'Provider "{id}" attributes [{keys}] updated successfully.',
      { id: providerId, keys: updatedKeys.join(', ') }
    );
  }

  async removeProvider(providerId: string): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const index = providers.findIndex((p) => p.id === providerId);
    if (index === -1) {
      return this.i18n.t('config.provider.notFound', '❌ Provider with ID "{id}" not found.', { id: providerId });
    }
    providers.splice(index, 1);
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] Deleted model provider: ${providerId}`);
    return this.i18n.t('config.provider.deleteSuccess', 'Model provider "{id}" and all its models deleted.', { id: providerId });
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
    if (!modelId) {
      return this.i18n.t('config.model.missingId', '❌ Missing required parameter: id cannot be empty.');
    }
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      return this.i18n.t('config.provider.notFound', '❌ Provider with ID "{id}" not found.', { id: providerId });
    }

    if (!Array.isArray(provider.models)) provider.models = [];
    if (provider.models.find((m: any) => m.id === modelId)) {
      return this.i18n.t(
        'config.model.alreadyExists',
        '❌ Model ID "{modelId}" already exists under provider "{providerId}".',
        { modelId, providerId }
      );
    }

    provider.models.push({
      id: modelId,
      name: String(data.name || '').trim(),
      inputPrice: Number(data.inputPrice) || 0,
      outputPrice: Number(data.outputPrice) || 0,
      cachedInputPrice: Number(data.cachedInputPrice) || 0,
      contextWindow: Number(data.contextWindow) || 128000,
      contextTokens: data.contextTokens !== undefined && data.contextTokens !== null && String(data.contextTokens).trim() !== '' ? Number(data.contextTokens) : 128000,
      maxTokens: data.maxTokens !== undefined && data.maxTokens !== null && String(data.maxTokens).trim() !== '' ? Number(data.maxTokens) : 4096,
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : ['text']
    });

    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] Added model: ${providerId}/${modelId}`);
    return this.i18n.t(
      'config.model.addSuccess',
      'Model "{modelId}" added to provider "{providerId}" successfully.',
      { modelId, providerId }
    );
  }

  async editModel(providerId: string, modelId: string, updates: Record<string, any>): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      return this.i18n.t('config.provider.notFound', '❌ Provider with ID "{id}" not found.', { id: providerId });
    }

    const models = Array.isArray(provider.models) ? provider.models : [];
    const model = models.find((m: any) => m.id === modelId);
    if (!model) {
      return this.i18n.t(
        'config.model.notFound',
        '❌ Model ID "{modelId}" not found (provider "{providerId}").',
        { modelId, providerId }
      );
    }

    const updatedKeys: string[] = [];
    if (updates.name !== undefined) { model.name = String(updates.name).trim(); updatedKeys.push('name'); }
    if (updates.inputPrice !== undefined) { model.inputPrice = Number(updates.inputPrice); updatedKeys.push('inputPrice'); }
    if (updates.outputPrice !== undefined) { model.outputPrice = Number(updates.outputPrice); updatedKeys.push('outputPrice'); }
    if (updates.cachedInputPrice !== undefined) { model.cachedInputPrice = Number(updates.cachedInputPrice); updatedKeys.push('cachedInputPrice'); }
    if (updates.contextWindow !== undefined) { model.contextWindow = Number(updates.contextWindow); updatedKeys.push('contextWindow'); }
    if (updates.contextTokens !== undefined) { model.contextTokens = Number(updates.contextTokens); updatedKeys.push('contextTokens'); }
    if (updates.maxTokens !== undefined) { model.maxTokens = Number(updates.maxTokens); updatedKeys.push('maxTokens'); }
    if (updates.capabilities !== undefined) { model.capabilities = updates.capabilities; updatedKeys.push('capabilities'); }

    if (updatedKeys.length === 0) {
      return this.i18n.t('config.provider.noUpdates', '⚠️ No attributes specified to update.');
    }

    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] Updated model "${providerId}/${modelId}" attributes: ${updatedKeys.join(', ')}`);
    return this.i18n.t(
      'config.model.updateSuccess',
      'Model "{modelId}" (provider "{providerId}") attributes [{keys}] updated successfully.',
      { modelId, providerId, keys: updatedKeys.join(', ') }
    );
  }

  async removeModel(providerId: string, modelId: string): Promise<string> {
    const providers = await this.fileHandler.readProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
      return this.i18n.t('config.provider.notFound', '❌ Provider with ID "{id}" not found.', { id: providerId });
    }

    const models = Array.isArray(provider.models) ? provider.models : [];
    const index = models.findIndex((m: any) => m.id === modelId);
    if (index === -1) {
      return this.i18n.t(
        'config.model.notFound',
        '❌ Model ID "{modelId}" not found (provider "{providerId}").',
        { modelId, providerId }
      );
    }

    models.splice(index, 1);
    await this.fileHandler.writeProviders(providers);
    if (this.llmRegistry) this.llmRegistry.setProviders(providers);
    this.context.logger.info(`[FreyaConfigManager] Deleted model: ${providerId}/${modelId}`);
    return this.i18n.t(
      'config.model.deleteSuccess',
      'Model "{modelId}" (provider "{providerId}") deleted successfully.',
      { modelId, providerId }
    );
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
    if (!this.pluginManager) {
      return this.i18n.t('config.plugin.notInit', '❌ Plugin service is not initialized.');
    }
    return await this.pluginManager.togglePlugin(pluginId, enabled);
  }

  listSkills(): FreyaSkill[] {
    if (!this.skillRegistry) return [];
    return this.skillRegistry.getAllSkills();
  }

  async toggleSkill(skillId: string, enabled: boolean): Promise<string> {
    if (!this.skillRegistry) {
      return this.i18n.t('config.skill.notInit', '❌ Skill registry service is not initialized.');
    }
    return await this.skillRegistry.toggleSkill(skillId, enabled);
  }

  async readPrompt(name: string, lang?: string): Promise<string> {
    const promptName = String(name).trim().toUpperCase();
    if (!ALLOWED_PROMPTS.has(promptName)) {
      return this.i18n.t(
        'config.prompt.notAllowed',
        '❌ Access denied: prompt document "{name}" is not in whitelist (allowed: IDENTITY, SOUL, USER, TOOLS, AGENTS, MEMORY).',
        { name: promptName }
      );
    }
    if (!this.promptManager) {
      return this.i18n.t('config.prompt.notInit', '❌ Prompt service is not initialized.');
    }
    return await this.promptManager.readPrompt(promptName, lang);
  }

  async writePrompt(name: string, content: string): Promise<string> {
    const promptName = String(name).trim().toUpperCase();
    if (!ALLOWED_PROMPTS.has(promptName)) {
      return this.i18n.t(
        'config.prompt.notAllowed',
        '❌ Access denied: prompt document "{name}" is not in whitelist (allowed: IDENTITY, SOUL, USER, TOOLS, AGENTS, MEMORY).',
        { name: promptName }
      );
    }
    if (!this.promptManager) {
      return this.i18n.t('config.prompt.notInit', '❌ Prompt service is not initialized.');
    }

    await this.promptManager.writePrompt(promptName, content);
    this.context.logger.info(`[FreyaConfigManager] Primary prompt "${promptName}" fully overridden and hot reloaded into core.`);
    return this.i18n.t(
      'config.prompt.overwriteSuccess',
      'Primary prompt [{name}] overridden and hot reloaded.',
      { name: promptName }
    );
  }

  async editPrompt(name: string, targetContent: string, replacementContent: string): Promise<string> {
    const promptName = String(name).trim().toUpperCase();
    if (!ALLOWED_PROMPTS.has(promptName)) {
      return this.i18n.t(
        'config.prompt.notAllowed',
        '❌ Access denied: prompt document "{name}" is not in whitelist (allowed: IDENTITY, SOUL, USER, TOOLS, AGENTS, MEMORY).',
        { name: promptName }
      );
    }
    if (!this.promptManager) {
      return this.i18n.t('config.prompt.notInit', '❌ Prompt service is not initialized.');
    }

    try {
      await this.promptManager.editPrompt(promptName, targetContent, replacementContent);
      this.context.logger.info(`[FreyaConfigManager] Primary prompt "${promptName}" partial update hot reloaded.`);
      return this.i18n.t(
        'config.prompt.editSuccess',
        'Primary prompt [{name}] partially replaced and applied.',
        { name: promptName }
      );
    } catch (err: any) {
      return this.i18n.t(
        'config.prompt.editFailed',
        '❌ Modification failed: {message}',
        { message: err.message }
      );
    }
  }

  registerCoreSchema(): void {
    const modelItemChildren: ConfigFieldSchema[] = [
      { key: 'provider', type: 'string', required: true, description: this.i18n.all('schema.core.models.item.provider.desc', 'LLM provider identifier') },
      { key: 'model', type: 'string', required: true, description: this.i18n.all('schema.core.models.item.model.desc', 'Model name') },
      { key: 'name', type: 'string', required: true, description: this.i18n.all('schema.core.models.item.name.desc', 'Display name') },
    ];

    const coreFields: ConfigFieldSchema[] = [
      {
        key: 'system.language',
        defaultValue: 'auto',
        description: this.i18n.all('schema.core.system.language.desc', 'System UI and interaction language'),
        type: 'string',
        enumValues: [
          { value: 'auto', label: this.i18n.all('schema.core.system.language.enum.auto', 'Auto Detect (auto)') },
          { value: 'zh', label: this.i18n.all('schema.core.system.language.enum.zh', 'Chinese (zh)') },
          { value: 'en', label: this.i18n.all('schema.core.system.language.enum.en', 'English (en)') }
        ],
        uiHint: 'select'
      },
      {
        key: 'models.default',
        defaultValue: [],
        description: this.i18n.all('schema.core.models.default.desc', 'Default model fallback chain list'),
        type: 'array',
        category: this.i18n.all('schema.core.category.models', 'Models'),
        children: modelItemChildren,
        manualOnly: true
      },
      {
        key: 'models.image',
        defaultValue: [],
        description: this.i18n.all('schema.core.models.image.desc', 'Image models list'),
        type: 'array',
        category: this.i18n.all('schema.core.category.models', 'Models'),
        children: modelItemChildren
      },
      {
        key: 'models.audio',
        defaultValue: [],
        description: this.i18n.all('schema.core.models.audio.desc', 'Audio transcription models list'),
        type: 'array',
        category: this.i18n.all('schema.core.category.models', 'Models'),
        children: modelItemChildren
      },
      {
        key: 'server.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.server.enabled.desc', 'Enable Web gateway service and WebSocket channel'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.server', 'Server'),
        manualOnly: true
      },
      {
        key: 'server.port',
        defaultValue: 3000,
        description: this.i18n.all('schema.core.server.port.desc', 'Web gateway service port'),
        type: 'number',
        required: true,
        min: 1,
        max: 65535,
        category: this.i18n.all('schema.core.category.server', 'Server'),
        manualOnly: true
      },
      {
        key: 'server.auth.enabled',
        defaultValue: false,
        description: this.i18n.all('schema.core.server.auth.enabled.desc', 'Enable Web and WebSocket login authentication'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.server', 'Server'),
        manualOnly: true
      },
      {
        key: 'server.auth.password',
        defaultValue: '',
        description: this.i18n.all('schema.core.server.auth.password.desc', 'Web console login password'),
        type: 'sha256',
        sensitive: true,
        uiHint: 'password',
        category: this.i18n.all('schema.core.category.server', 'Server'),
        manualOnly: true
      },
      {
        key: 'cli.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.cli.enabled.desc', 'Enable command-line terminal interaction channel'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.server', 'Server'),
        manualOnly: true
      },
      {
        key: 'workspace',
        defaultValue: 'workspace',
        description: this.i18n.all('schema.core.workspace.desc', 'User document workspace directory name'),
        type: 'string',
        required: true,
        category: this.i18n.all('schema.core.category.system', 'System Parameters'),
        manualOnly: true
      },
      {
        key: 'config.authTimeout',
        defaultValue: 30,
        description: this.i18n.all('schema.core.config.authTimeout.desc', 'Timeout seconds for AI agent waiting for config authorization'),
        type: 'number',
        min: 10,
        max: 300,
        category: this.i18n.all('schema.core.category.system', 'System Parameters'),
        manualOnly: true
      },
      {
        key: 'contextManagement.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.context.enabled.desc', 'Enable context management'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'contextManagement.maxHistoryTurns',
        defaultValue: 15,
        description: this.i18n.all('schema.core.context.maxHistoryTurns.desc', 'Maximum turns of context history'),
        type: 'number',
        min: 1,
        max: 100,
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'contextManagement.historyLimit',
        defaultValue: 100,
        description: this.i18n.all('schema.core.context.historyLimit.desc', 'Upper limit of context history message count'),
        type: 'number',
        min: 10,
        max: 500,
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'contextManagement.keepRecentTurns',
        defaultValue: 6,
        description: this.i18n.all('schema.core.context.keepRecentTurns.desc', 'Recent turns preserved during compression'),
        type: 'number',
        min: 1,
        max: 50,
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'contextManagement.summarizeEnabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.context.summarizeEnabled.desc', 'Enable context summary compression'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'contextManagement.summaryMaxTokens',
        defaultValue: 150,
        description: this.i18n.all('schema.core.context.summaryMaxTokens.desc', 'Maximum token length of summary generated during compression'),
        type: 'number',
        min: 50,
        max: 4096,
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'contextManagement.toolboxIdleTimeoutRounds',
        defaultValue: 10,
        description: this.i18n.all('schema.core.context.toolboxIdleTimeoutRounds.desc', 'Max idle turns before automatically unloading an active toolbox'),
        type: 'number',
        min: 1,
        max: 100,
        category: this.i18n.all('schema.core.category.context', 'Context Management')
      },
      {
        key: 'tools.builtin.config.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.tools.config.enabled.desc', 'Enable core config toolbox (allows model to view/modify config)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.tools', 'Builtin Tools'),
        manualOnly: true
      },
      {
        key: 'tools.builtin.agent.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.tools.agent.enabled.desc', 'Enable core agent delegation toolbox (allows model to delegate subtasks)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.tools', 'Builtin Tools'),
        manualOnly: true
      },
      {
        key: 'commands.builtin.auth.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.commands.auth.enabled.desc', 'Enable sensitive operation approval commands (/approve and /reject)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.commands', 'Builtin Commands'),
        manualOnly: true
      },
      {
        key: 'commands.builtin.session.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.commands.session.enabled.desc', 'Enable session management commands (/session and subcommands)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.commands', 'Builtin Commands'),
        manualOnly: true
      },
      {
        key: 'commands.builtin.model.enabled',
        defaultValue: true,
        description: this.i18n.all('schema.core.commands.model.enabled.desc', 'Enable model switching commands (/model and subcommands)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.commands', 'Builtin Commands'),
        manualOnly: true
      },
      {
        key: 'log.console.error',
        defaultValue: true,
        description: this.i18n.all('schema.core.log.console.error.desc', 'Console ERROR logs output (red)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.log', 'Logging')
      },
      {
        key: 'log.console.warn',
        defaultValue: false,
        description: this.i18n.all('schema.core.log.console.warn.desc', 'Console WARN logs output (yellow)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.log', 'Logging')
      },
      {
        key: 'log.console.info',
        defaultValue: false,
        description: this.i18n.all('schema.core.log.console.info.desc', 'Console INFO logs output (green)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.log', 'Logging')
      },
      {
        key: 'log.console.debug',
        defaultValue: false,
        description: this.i18n.all('schema.core.log.console.debug.desc', 'Console DEBUG logs output (gray)'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.log', 'Logging')
      },
      {
        key: 'log.llm',
        defaultValue: false,
        description: this.i18n.all('schema.core.log.llm.desc', 'Record LLM interaction logs'),
        type: 'boolean',
        category: this.i18n.all('schema.core.category.log', 'Logging')
      }
    ];

    this.schemaRegistry.register('core', coreFields);
  }

  getSchema(): Map<string, ConfigFieldSchema[]> {
    return this.schemaRegistry.getSchema();
  }
}
