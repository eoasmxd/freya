import type { ConfigFieldSchema, FreyaContext, FreyaPlugin, LocalizedText } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FreyaCommandRegistry } from '../command/command-registry.js';
import { FreyaConfigSchemaRegistry } from '../config/schema-registry.js';
import { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from '../utils/paths.js';
import { FreyaPluginRegistry } from './plugin-registry.js';

export interface PluginConfigEntry {
  id: string;
  enabled: boolean;
  valid?: boolean;
  status?: 'active' | 'disabled' | 'error' | 'not_found' | 'invalid';
  errorReason?: string;
  displayName?: LocalizedText;
  description?: LocalizedText;
  version?: string;
  source?: 'builtin' | 'launch' | 'runtime' | 'npm';
}

interface DiscoveredPluginInfo {
  id: string;
  resolvedDir: string;
  mainEntry: string;
  displayName: LocalizedText;
  description: LocalizedText;
  version: string;
  source: 'builtin' | 'launch' | 'runtime' | 'npm';
  defaultEnabled?: boolean;
  prompts?: string[];
  valid: boolean;
  errorReason?: string;
  schema?: ConfigFieldSchema[];
}

function getPluginLogName(plugin: FreyaPlugin): string {
  if (!plugin.name) return plugin.id || 'unknown';
  if (typeof plugin.name === 'string') return plugin.name;
  return plugin.name['en'] || Object.values(plugin.name)[0] || plugin.id || 'unknown';
}

/**
 * Freya 插件生命周期与模块管理器
 * Freya plugin lifecycle and module manager
 */
export class FreyaPluginManager {
  private plugins = new Map<string, FreyaPlugin>();
  private pluginEntries: PluginConfigEntry[] = [];
  private pluginPaths = new Map<string, string>();
  private pluginPrompts = new Map<string, string[]>();
  private pluginResolvedDirs = new Map<string, string>();
  private ctx!: FreyaContext;
  private pluginRegistry!: FreyaPluginRegistry;

  constructor(
    private configSchemaRegistry: FreyaConfigSchemaRegistry,
    private commandRegistry: FreyaCommandRegistry,
    private promptRegistry: FreyaPromptRegistry
  ) { }

  /**
   * 加载指定路径的插件模块并挂载所属 Command 与 Prompt 声明
   * Load plugin module from specified path and mount associated Command and Prompt declarations
   */
  async loadPlugin(
    pluginPath: string,
    meta: { id: string; displayName?: LocalizedText; description?: LocalizedText; version?: string; prompts?: string[]; resolvedDir?: string },
    ctx: FreyaContext
  ): Promise<FreyaPlugin> {
    const fileUrl = pathToFileURL(pluginPath).toString();
    ctx.logger.debug(`Loading plugin module: ${pluginPath}`);

    const module = await import(fileUrl);
    const PluginClass = module.default || module.Plugin;
    if (!PluginClass) {
      throw new Error(`插件路径 ${pluginPath} 未定义默认导出或 Plugin 命名导出。`);
    }

    const plugin: FreyaPlugin = new PluginClass();

    // 自动补全后写入静态元数据
    // Write static metadata after autocomplete
    plugin.id = meta.id;
    plugin.name = meta.displayName || meta.id;
    plugin.description = meta.description || '';
    plugin.version = meta.version || '0.1.0';

    if (plugin.commands && Array.isArray(plugin.commands)) {
      for (const cmd of plugin.commands) {
        this.commandRegistry.register(cmd, meta.id);
      }
    }

    if (meta.prompts && meta.prompts.length > 0) {
      const baseDir = meta.resolvedDir || path.dirname(pluginPath);
      for (const file of meta.prompts) {
        const name = file.endsWith('.md') ? file.slice(0, -3) : file;
        await this.promptRegistry.register({
          key: name,
          defaultPath: path.join(baseDir, 'config', 'prompts', file)
        });
      }
    }

    ctx.logger.info(`Plugin mounted successfully: ${getPluginLogName(plugin)} (${plugin.id})`);
    return plugin;
  }

  /**
   * 启动已载入内存的所有插件实例
   * Initialize and start all plugin instances loaded in memory
   */
  async setupAndStartAll(ctx: FreyaContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      ctx.logger.debug(`Initializing plugin: ${getPluginLogName(plugin)}`);
      await plugin.setup(ctx);
    }
    for (const plugin of this.plugins.values()) {
      if (plugin.start) {
        ctx.logger.debug(`Starting plugin: ${getPluginLogName(plugin)}`);
        await plugin.start(ctx);
      }
    }
  }

  /**
   * 停止所有运行中的插件实例
   * Stop all running plugin instances
   */
  async stopAll(ctx: FreyaContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.stop) {
        ctx.logger.debug(`Stopping plugin: ${getPluginLogName(plugin)}`);
        await plugin.stop(ctx);
      }
    }
  }

  getLoadedPlugins(): FreyaPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPluginEntries(): PluginConfigEntry[] {
    return this.pluginEntries;
  }

  getPlugins(): FreyaPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPluginMeta(pluginId: string): { description?: LocalizedText } | undefined {
    const entry = this.pluginEntries.find((e) => e.id === pluginId);
    return entry ? { description: entry.description } : undefined;
  }

  /**
   * 切换插件的启停状态并同步物理配置
   * Toggle plugin enabled/disabled status and synchronize physical configuration
   */
  async togglePlugin(pluginId: string, enabled: boolean): Promise<string> {
    const i18n = new I18n({ zh, en }, this.ctx);
    const entry = this.pluginEntries.find((e: PluginConfigEntry) => e.id === pluginId);
    if (!entry) {
      return i18n.t('plugin.toggle.notFound', '❌ Plugin with ID "{id}" not found. Please verify the name.', { id: pluginId });
    }

    if (enabled && entry.valid === false) {
      const reason = entry.errorReason || i18n.t('plugin.toggle.invalidStateDefault', 'plugin is in an invalid state');
      return i18n.t('plugin.toggle.invalidState', '❌ Cannot enable plugin "{id}": {reason}', { id: pluginId, reason });
    }

    if (entry.enabled === enabled) {
      const state = enabled
        ? i18n.t('plugin.toggle.stateEnabled', 'enabled')
        : i18n.t('plugin.toggle.stateDisabled', 'disabled');
      return i18n.t('plugin.toggle.alreadyInState', 'ℹ️ Plugin "{id}" is already {state}.', { id: pluginId, state });
    }

    entry.enabled = enabled;
    entry.status = enabled ? 'active' : 'disabled';

    const configPluginsPath = path.join(FREYA_HOME, 'config', 'plugins.json');
    try {
      await fs.mkdir(path.dirname(configPluginsPath), { recursive: true });
      const rawEntries = this.pluginEntries.map((e) => ({ id: e.id, enabled: e.enabled }));
      await fs.writeFile(configPluginsPath, JSON.stringify(rawEntries, null, 2) + '\n', 'utf-8');
    } catch (err: any) {
      return i18n.t('plugin.toggle.writeFailed', '❌ Plugin state changed, but failed to write plugins.json: {message}', { message: err.message });
    }

    if (enabled) {
      const loadPath = this.pluginPaths.get(pluginId);
      if (loadPath) {
        try {
          const prompts = this.pluginPrompts.get(pluginId) || [];
          const resolvedDir = this.pluginResolvedDirs.get(pluginId);
          const loadedPlugin = await this.loadPlugin(
            loadPath,
            { id: pluginId, displayName: entry.displayName, description: entry.description, version: entry.version, prompts, resolvedDir },
            this.ctx
          );
          await loadedPlugin.setup(this.ctx);
          if (loadedPlugin.start) {
            await loadedPlugin.start(this.ctx);
          }
          this.pluginRegistry.register(loadedPlugin, this.ctx);
          this.plugins.set(pluginId, loadedPlugin);
          this.ctx.logger.info(`[FreyaPluginManager] Plugin "${pluginId}" hot activated successfully.`);
        } catch (err: any) {
          entry.status = 'error';
          entry.valid = false;
          entry.errorReason = `Hot activate load failed: ${err.message}`;
          this.ctx.logger.error(`[FreyaPluginManager] Failed to hot activate plugin "${pluginId}":`, err.message);
          return i18n.t('plugin.toggle.startFailed', '❌ Failed to start plugin "{id}": {message}', { id: pluginId, message: err.message });
        }
      }
    } else {
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        try {
          if (plugin.stop) {
            await plugin.stop(this.ctx);
          }
          this.pluginRegistry.unregister(plugin);
          this.commandRegistry.unregisterByPlugin(pluginId);

          const prompts = this.pluginPrompts.get(pluginId) || [];
          for (const file of prompts) {
            const name = file.endsWith('.md') ? file.slice(0, -3) : file;
            this.promptRegistry.unregister(name);
          }

          this.plugins.delete(pluginId);
          this.ctx.logger.info(`[FreyaPluginManager] Plugin "${pluginId}" hot deactivated and unmounted successfully.`);
        } catch (err: any) {
          this.ctx.logger.error(`[FreyaPluginManager] Error unmounting plugin "${pluginId}":`, err.message);
        }
      }
    }

    this.ctx.eventBus.emit('plugin:toggled', { pluginId, enabled });
    const state = enabled
      ? i18n.t('plugin.toggle.stateEnabled', 'enabled')
      : i18n.t('plugin.toggle.stateDisabled', 'disabled');
    return i18n.t('plugin.toggle.success', '✅ Plugin "{id}" has been {state} and took effect immediately.', { id: pluginId, state });
  }

  /**
   * 检验与分析指定物理目录下的插件包
   * Inspect and analyze plugin package under specified physical directory
   */
  private async inspectPluginPackage(
    dirPath: string,
    source: 'builtin' | 'launch' | 'runtime' | 'npm'
  ): Promise<DiscoveredPluginInfo | null> {
    try {
      const pkgPath = path.join(dirPath, 'package.json');
      const rawPkg = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(rawPkg);

      const id = String(pkg.name || '').trim();
      if (!id) {
        return null;
      }

      const displayName: LocalizedText = (pkg.freya?.displayName || pkg.displayName || id) as LocalizedText;
      const description: LocalizedText = (pkg.freya?.description || pkg.description || '') as LocalizedText;
      const version = String(pkg.version || '0.1.0');
      const defaultEnabled = ((source === 'builtin' || source === 'launch') && pkg.freya?.defaultEnabled === true);
      const rawPrompts = pkg.freya?.prompts;
      const prompts = Array.isArray(rawPrompts) ? rawPrompts.map(String) : [];

      const isFreyaPlugin = Boolean(
        pkg.freya ||
        pkg.dependencies?.['@eoasmxd/freya-sdk'] ||
        pkg.peerDependencies?.['@eoasmxd/freya-sdk']
      );

      if (!isFreyaPlugin) {
        return {
          id,
          resolvedDir: dirPath,
          mainEntry: '',
          displayName,
          description,
          version,
          source,
          valid: false,
          errorReason: `缺少 Freya 身份标识 (package.json 需包含 freya 节点或依赖 @eoasmxd/freya-sdk)`
        };
      }

      const mainFile = pkg.main;
      if (!mainFile) {
        return {
          id,
          resolvedDir: dirPath,
          mainEntry: '',
          displayName,
          description,
          version,
          source,
          valid: false,
          errorReason: `package.json 未定义 main 入口声明`
        };
      }

      const entryPath = path.resolve(dirPath, mainFile);
      try {
        await fs.access(entryPath);
      } catch {
        return {
          id,
          resolvedDir: dirPath,
          mainEntry: '',
          displayName,
          description,
          version,
          source,
          valid: false,
          errorReason: `未找到 package.json 指定的物理入口文件: ${mainFile}`
        };
      }

      const relativeSchemaPath = pkg.freya?.schema || './schema.json';
      const schemaPath = path.resolve(dirPath, relativeSchemaPath);
      let schema: ConfigFieldSchema[] = [];

      try {
        const schemaRaw = await fs.readFile(schemaPath, 'utf-8');
        schema = JSON.parse(schemaRaw);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          return {
            id,
            resolvedDir: dirPath,
            mainEntry: entryPath,
            displayName,
            description,
            version,
            source,
            valid: false,
            errorReason: `静态配置声明文件 ${relativeSchemaPath} 损坏解析失败: ${err.message}`
          };
        }
        schema = [];
      }

      return {
        id,
        resolvedDir: dirPath,
        mainEntry: entryPath,
        displayName,
        description,
        version,
        source,
        defaultEnabled,
        prompts,
        valid: true,
        schema
      };
    } catch {
      return null;
    }
  }

  /**
   * 解析系统中指定 NPM 包名的插件模块
   * Resolve plugin module with specified NPM package name in system
   */
  private async resolveNpmPlugin(pkgName: string): Promise<DiscoveredPluginInfo> {
    try {
      const req = createRequire(import.meta.url);
      let pkgJsonPath = '';
      try {
        pkgJsonPath = req.resolve(`${pkgName}/package.json`, {
          paths: [path.join(FREYA_LAUNCH), path.join(FREYA_HOME), path.join(FREYA_APP), process.cwd()]
        });
      } catch {
        return {
          id: pkgName,
          resolvedDir: '',
          mainEntry: '',
          displayName: pkgName,
          description: '',
          version: '',
          source: 'npm',
          valid: false,
          errorReason: `系统中未找到名为 "${pkgName}" 的 NPM 包`
        };
      }

      const pluginDir = path.dirname(pkgJsonPath);
      const info = await this.inspectPluginPackage(pluginDir, 'npm');
      if (!info) {
        return {
          id: pkgName,
          resolvedDir: pluginDir,
          mainEntry: '',
          displayName: pkgName,
          description: '',
          version: '',
          source: 'npm',
          valid: false,
          errorReason: `NPM 包 "${pkgName}" 读取 package.json 失败`
        };
      }
      return info;
    } catch (err: any) {
      return {
        id: pkgName,
        resolvedDir: '',
        mainEntry: '',
        displayName: pkgName,
        description: '',
        version: '',
        source: 'npm',
        valid: false,
        errorReason: `解析 NPM 插件异常: ${err.message}`
      };
    }
  }

  /**
   * 收集并检索应用内置、运行环境及配置所指定的全部插件来源
   * Scan and collect all plugin sources from built-in, runtime, and configuration
   */
  private async scanAllChannels(configuredIds: Set<string>): Promise<DiscoveredPluginInfo[]> {
    const map = new Map<string, DiscoveredPluginInfo>();

    const builtinDir = path.join(FREYA_APP, 'plugins');
    try {
      const entries = await fs.readdir(builtinDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const info = await this.inspectPluginPackage(path.join(builtinDir, entry.name), 'builtin');
          if (info) map.set(info.id, info);
        }
      }
    } catch { }

    const launchPluginsDir = path.join(FREYA_LAUNCH, 'plugins');
    const resolvedBuiltin = path.resolve(builtinDir);
    const resolvedLaunch = path.resolve(launchPluginsDir);
    const resolvedRuntime = path.resolve(path.join(FREYA_HOME, 'plugins'));

    if (resolvedLaunch !== resolvedBuiltin && resolvedLaunch !== resolvedRuntime) {
      try {
        const entries = await fs.readdir(launchPluginsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const info = await this.inspectPluginPackage(path.join(launchPluginsDir, entry.name), 'launch');
            if (info) {
              const existing = map.get(info.id);
              if (existing?.source === 'builtin') {
                info.source = 'builtin';
              }
              map.set(info.id, info);
            }
          }
        }
      } catch { }
    }

    const runtimeDir = path.join(FREYA_HOME, 'plugins');
    try {
      const entries = await fs.readdir(runtimeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const info = await this.inspectPluginPackage(path.join(runtimeDir, entry.name), 'runtime');
          if (info) {
            const existing = map.get(info.id);
            if (existing?.source === 'builtin') {
              info.source = 'builtin';
            }
            map.set(info.id, info);
          }
        }
      }
    } catch { }

    for (const pkgName of configuredIds) {
      if (!map.has(pkgName)) {
        const info = await this.resolveNpmPlugin(pkgName);
        map.set(info.id, info);
      }
    }

    return Array.from(map.values());
  }

  /**
   * 根据配置文件加载与激活目标插件
   * Load and activate target plugins according to configuration files
   */
  async loadConfiguredPlugins(pluginRegistry: FreyaPluginRegistry, ctx: FreyaContext): Promise<void> {
    this.ctx = ctx;
    this.pluginRegistry = pluginRegistry;
    const configPluginsPath = path.join(FREYA_HOME, 'config', 'plugins.json');

    let configList: Array<{ id: string; enabled: boolean }> = [];
    try {
      const raw = await fs.readFile(configPluginsPath, 'utf-8');
      configList = JSON.parse(raw);
      if (!Array.isArray(configList)) configList = [];
    } catch {
      ctx.logger.info('No existing configuration in config/plugins.json, initiating auto-scan initialization.');
      configList = [];
    }

    const configMap = new Map<string, boolean>();
    const configuredIds = new Set<string>();
    for (const item of configList) {
      if (item && typeof item.id === 'string') {
        configMap.set(item.id, !!item.enabled);
        configuredIds.add(item.id);
      }
    }

    const discovered = await this.scanAllChannels(configuredIds);
    ctx.logger.info(`Discovered ${discovered.length} plugin modules across cascading scan paths.`);

    this.pluginPaths.clear();
    this.pluginPrompts.clear();
    const finalEntries: PluginConfigEntry[] = [];
    let configChanged = false;

    for (const info of discovered) {
      if (info.valid && info.schema) {
        this.configSchemaRegistry.register(info.id, info.schema);
      }

      this.pluginPaths.set(info.id, info.mainEntry);
      this.pluginPrompts.set(info.id, info.prompts || []);
      this.pluginResolvedDirs.set(info.id, info.resolvedDir);

      const isEnabledInConfig = configMap.get(info.id);
      const enabled = isEnabledInConfig !== undefined ? isEnabledInConfig : (info.defaultEnabled ?? false);

      if (isEnabledInConfig === undefined) {
        configChanged = true;
      }

      let status: PluginConfigEntry['status'] = 'disabled';
      if (!info.valid) {
        status = 'invalid';
      } else if (enabled) {
        status = 'active';
      }

      finalEntries.push({
        id: info.id,
        enabled,
        valid: info.valid,
        status,
        errorReason: info.errorReason,
        displayName: info.displayName,
        description: info.description,
        version: info.version,
        source: info.source
      });
    }

    const discoveredIds = new Set(discovered.map((d) => d.id));
    for (const id of configuredIds) {
      if (!discoveredIds.has(id)) {
        configChanged = true;
      }
    }

    const rawToPersist = finalEntries.map((e) => ({ id: e.id, enabled: e.enabled }));
    try {
      await fs.mkdir(path.dirname(configPluginsPath), { recursive: true });
      await fs.writeFile(configPluginsPath, JSON.stringify(rawToPersist, null, 2) + '\n', 'utf-8');
      if (configChanged) {
        ctx.logger.info('Plugin configuration plugins.json updated and persisted.');
      }
    } catch (err: any) {
      ctx.logger.error('Error persisting plugins.json:', err.message);
    }

    this.pluginEntries = finalEntries;

    for (const entry of finalEntries) {
      if (!entry.enabled || !entry.valid) {
        if (entry.enabled && !entry.valid) {
          ctx.logger.warn(`Plugin "${entry.id}" is enabled but failed diagnostics: ${entry.errorReason}`);
        }
        continue;
      }

      const mainEntryPath = this.pluginPaths.get(entry.id);
      if (!mainEntryPath) continue;

      try {
        const prompts = this.pluginPrompts.get(entry.id) || [];
        const resolvedDir = this.pluginResolvedDirs.get(entry.id);
        const loadedPlugin = await this.loadPlugin(
          mainEntryPath,
          { id: entry.id, displayName: entry.displayName, description: entry.description, version: entry.version, prompts, resolvedDir },
          ctx
        );
        pluginRegistry.register(loadedPlugin, ctx);
        this.plugins.set(entry.id, loadedPlugin);
      } catch (err: any) {
        entry.valid = false;
        entry.status = 'error';
        entry.errorReason = `载入运行失败: ${err.message}`;
        ctx.logger.error(`Error instantiating plugin "${entry.id}": ${err.message}`);
      }
    }
  }
}
