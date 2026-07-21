import type { ConfigFieldSchema, FreyaContext, FreyaPlugin } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FreyaCommandRegistry } from '../command/command-registry.js';
import { FreyaConfigSchemaRegistry } from '../config/schema-registry.js';
import { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import { APP_ROOT, PROJECT_ROOT } from '../utils/paths.js';
import { FreyaPluginRegistry } from './plugin-registry.js';

export interface PluginConfigEntry {
  id: string;
  enabled: boolean;
  valid?: boolean;
  status?: 'active' | 'disabled' | 'error' | 'not_found' | 'invalid';
  errorReason?: string;
  displayName?: string;
  description?: string;
  version?: string;
  source?: 'builtin' | 'runtime' | 'npm';
}

interface DiscoveredPluginInfo {
  id: string;
  resolvedDir: string;
  mainEntry: string;
  displayName: string;
  description: string;
  version: string;
  source: 'builtin' | 'runtime' | 'npm';
  defaultEnabled?: boolean;
  prompts?: string[];
  valid: boolean;
  errorReason?: string;
  schema?: ConfigFieldSchema[];
}

/**
 * Freya 插件生命周期与模块管理器
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
   */
  async loadPlugin(
    pluginPath: string,
    meta: { id: string; displayName?: string; version?: string; prompts?: string[]; resolvedDir?: string },
    ctx: FreyaContext
  ): Promise<FreyaPlugin> {
    const fileUrl = pathToFileURL(pluginPath).toString();
    ctx.logger.info(`正在加载插件模块: ${pluginPath}`);

    const module = await import(fileUrl);
    const PluginClass = module.default || module.Plugin;
    if (!PluginClass) {
      throw new Error(`插件路径 ${pluginPath} 未定义默认导出或 Plugin 命名导出。`);
    }

    const plugin: FreyaPlugin = new PluginClass();

    // 自动补全后写入静态元数据
    plugin.id = plugin.id || meta.id;
    plugin.name = plugin.name || meta.displayName || meta.id;
    plugin.version = plugin.version || meta.version || '0.1.0';

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

    ctx.logger.info(`插件组件挂载成功: ${plugin.name} (ID: ${plugin.id})`);
    return plugin;
  }

  /**
   * 启动已载入内存的所有插件实例
   */
  async setupAndStartAll(ctx: FreyaContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      ctx.logger.debug(`正在初始化插件: ${plugin.name}`);
      await plugin.setup(ctx);
    }
    for (const plugin of this.plugins.values()) {
      if (plugin.start) {
        ctx.logger.debug(`正在启动插件: ${plugin.name}`);
        await plugin.start(ctx);
      }
    }
  }

  /**
   * 停止所有运行中的插件实例
   */
  async stopAll(ctx: FreyaContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.stop) {
        ctx.logger.debug(`正在停止插件: ${plugin.name}`);
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

  getPluginMeta(pluginId: string): { description: string } | undefined {
    const entry = this.pluginEntries.find((e) => e.id === pluginId);
    return entry ? { description: entry.description || '' } : undefined;
  }

  /**
   * 切换插件的启停状态并同步物理配置
   */
  async togglePlugin(pluginId: string, enabled: boolean): Promise<string> {
    const entry = this.pluginEntries.find((e: PluginConfigEntry) => e.id === pluginId);
    if (!entry) {
      return `❌ 未找到 ID 为 "${pluginId}" 的插件，请检查名称是否正确。`;
    }

    if (enabled && entry.valid === false) {
      return `❌ 无法启用插件 "${pluginId}": ${entry.errorReason || '该插件状态非法'}`;
    }

    if (entry.enabled === enabled) {
      return `ℹ️ 插件 "${pluginId}" 状态已是 ${enabled ? '启用' : '禁用'}。`;
    }

    entry.enabled = enabled;
    entry.status = enabled ? 'active' : 'disabled';

    const configPluginsPath = path.join(PROJECT_ROOT, 'config', 'plugins.json');
    try {
      await fs.mkdir(path.dirname(configPluginsPath), { recursive: true });
      const rawEntries = this.pluginEntries.map((e) => ({ id: e.id, enabled: e.enabled }));
      await fs.writeFile(configPluginsPath, JSON.stringify(rawEntries, null, 2) + '\n', 'utf-8');
    } catch (err: any) {
      return `❌ 插件状态变更成功，但写入 plugins.json 失败: ${err.message}`;
    }

    if (enabled) {
      const loadPath = this.pluginPaths.get(pluginId);
      if (loadPath) {
        try {
          const prompts = this.pluginPrompts.get(pluginId) || [];
          const resolvedDir = this.pluginResolvedDirs.get(pluginId);
          const loadedPlugin = await this.loadPlugin(
            loadPath,
            { id: pluginId, displayName: entry.displayName, version: entry.version, prompts, resolvedDir },
            this.ctx
          );
          await loadedPlugin.setup(this.ctx);
          if (loadedPlugin.start) {
            await loadedPlugin.start(this.ctx);
          }
          this.pluginRegistry.register(loadedPlugin, this.ctx);
          this.plugins.set(pluginId, loadedPlugin);
          this.ctx.logger.info(`[FreyaPluginManager] 插件 "${pluginId}" 热激活成功。`);
        } catch (err: any) {
          entry.status = 'error';
          entry.valid = false;
          entry.errorReason = `热激活载入代码失败: ${err.message}`;
          this.ctx.logger.error(`[FreyaPluginManager] 插件 "${pluginId}" 热激活失败:`, err.message);
          return `❌ 插件 "${pluginId}" 开启失败: ${err.message}`;
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
          this.ctx.logger.info(`[FreyaPluginManager] 插件 "${pluginId}" 热停用成功并移除挂载。`);
        } catch (err: any) {
          this.ctx.logger.error(`[FreyaPluginManager] 插件 "${pluginId}" 卸载时异常:`, err.message);
        }
      }
    }

    this.ctx.eventBus.emit('plugin:toggled', { pluginId, enabled });
    return `✅ 插件 "${pluginId}" 已${enabled ? '启用' : '禁用'}并立即生效。`;
  }

  /**
   * 检验与分析指定物理目录下的插件包
   */
  private async inspectPluginPackage(
    dirPath: string,
    source: 'builtin' | 'runtime' | 'npm'
  ): Promise<DiscoveredPluginInfo | null> {
    try {
      const pkgPath = path.join(dirPath, 'package.json');
      const rawPkg = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(rawPkg);

      const id = String(pkg.name || '').trim();
      if (!id) {
        return null;
      }

      const displayName = String(pkg.freya?.displayName || pkg.displayName || id);
      const description = String(pkg.description || '');
      const version = String(pkg.version || '0.1.0');
      const defaultEnabled = (source === 'builtin' && pkg.freya?.defaultEnabled === true);
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
   */
  private async resolveNpmPlugin(pkgName: string): Promise<DiscoveredPluginInfo> {
    try {
      const req = createRequire(import.meta.url);
      let pkgJsonPath = '';
      try {
        pkgJsonPath = req.resolve(`${pkgName}/package.json`, {
          paths: [path.join(PROJECT_ROOT), path.join(APP_ROOT), process.cwd()]
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
   */
  private async scanAllChannels(configuredIds: Set<string>): Promise<DiscoveredPluginInfo[]> {
    const map = new Map<string, DiscoveredPluginInfo>();

    const builtinDir = path.join(APP_ROOT, 'plugins');
    try {
      const entries = await fs.readdir(builtinDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const info = await this.inspectPluginPackage(path.join(builtinDir, entry.name), 'builtin');
          if (info) map.set(info.id, info);
        }
      }
    } catch { }

    const runtimeDir = path.join(PROJECT_ROOT, 'plugins');
    try {
      const entries = await fs.readdir(runtimeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const info = await this.inspectPluginPackage(path.join(runtimeDir, entry.name), 'runtime');
          if (info) map.set(info.id, info);
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
   */
  async loadConfiguredPlugins(pluginRegistry: FreyaPluginRegistry, ctx: FreyaContext): Promise<void> {
    this.ctx = ctx;
    this.pluginRegistry = pluginRegistry;
    const configPluginsPath = path.join(PROJECT_ROOT, 'config', 'plugins.json');

    let configList: Array<{ id: string; enabled: boolean }> = [];
    try {
      const raw = await fs.readFile(configPluginsPath, 'utf-8');
      configList = JSON.parse(raw);
      if (!Array.isArray(configList)) configList = [];
    } catch {
      ctx.logger.info('config/plugins.json 未读取到现有配置，将自动进行扫描初始化。');
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
    ctx.logger.info(`三通道共扫描检测到 ${discovered.length} 个插件模块。`);

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
        ctx.logger.info('插件控制配置 plugins.json 已完成更新落地。');
      }
    } catch (err: any) {
      ctx.logger.error('持久化写入 plugins.json 出现异常:', err.message);
    }

    this.pluginEntries = finalEntries;

    for (const entry of finalEntries) {
      if (!entry.enabled || !entry.valid) {
        if (entry.enabled && !entry.valid) {
          ctx.logger.warn(`插件 "${entry.id}" 已使能，但诊断未通过: ${entry.errorReason}`);
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
          { id: entry.id, displayName: entry.displayName, version: entry.version, prompts, resolvedDir },
          ctx
        );
        pluginRegistry.register(loadedPlugin, ctx);
        this.plugins.set(entry.id, loadedPlugin);
      } catch (err: any) {
        entry.valid = false;
        entry.status = 'error';
        entry.errorReason = `载入运行失败: ${err.message}`;
        ctx.logger.error(`插件 "${entry.id}" 实例化抛错: ${err.message}`);
      }
    }
  }
}
