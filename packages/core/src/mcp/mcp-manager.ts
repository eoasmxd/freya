import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaToolRegistry } from '../tools/tool-registry.js';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { HttpRouteHandler } from '@eoasmxd/freya-sdk';
import { FREYA_HOME, FREYA_LAUNCH } from '../utils/paths.js';
import type {
  McpAuthStartResult,
  McpConfigFile,
  McpServerConfig,
  McpServerStatus,
  McpToolSchema
} from './types.js';
import { McpAuthRequiredError, McpConnectionError } from './types.js';
import { McpNaming } from './mcp-naming.js';
import { McpToolbox } from './mcp-toolbox.js';
import { McpBridgedTool } from './mcp-tool.js';
import { McpClientSession } from './mcp-client.js';
import { McpCacheManager } from './mcp-cache.js';
import { McpOAuthManager } from './auth/oauth-manager.js';
import { createOAuthCallbackHandler } from './auth/oauth-handler.js';

const MAX_SUMMARIZE_INSTRUCTIONS_LENGTH = 4000;
const MAX_CONSECUTIVE_CONNECTION_FAILURES = 3;

/**
 * MCP 核心管理器，统筹配置探测、工具箱注册、连接与生命周期调度
 * MCP core manager orchestrating config probing, toolboxes registration and connection lifecycle
 */
export class FreyaMcpManager {
  private servers = new Map<string, McpServerConfig>();
  private sessions = new Map<string, McpClientSession>();
  private toolboxes = new Map<string, McpToolbox>();
  private statuses = new Map<string, McpServerStatus>();
  private connectionFailureCounts = new Map<string, number>();
  private launchServerIds = new Set<string>();

  private readonly cacheManager = new McpCacheManager();
  private readonly authManager: McpOAuthManager;

  constructor(
    private readonly context: FreyaContext,
    private readonly toolRegistry: FreyaToolRegistry,
    private readonly promptRegistry: FreyaPromptRegistry
  ) {
    this.authManager = new McpOAuthManager(undefined, this.context);
    this.authManager.setServerUrlResolver((serverId) => this.servers.get(serverId)?.url);
    this.authManager.setOnAuthSuccess(async (serverId) => {
      const cfg = this.servers.get(serverId);
      if (cfg) {
        await this.probeServer(serverId, cfg, { force: true });
      }
    });
  }

  /**
   * 获取 OAuth 授权管理器
   * Get central OAuth manager instance
   */
  getAuthManager(): McpOAuthManager {
    return this.authManager;
  }

  /**
   * 发起指定 MCP 服务的授权流程（优先设备码模式）
   * start OAuth flow for specified server (prioritizing device flow)
   */
  async startAuth(serverId: string, callbackUrl?: string): Promise<McpAuthStartResult> {
    return await this.authManager.startAuth(serverId, callbackUrl);
  }

  getServerStatus(serverId: string): McpServerStatus {
    return this.statuses.get(serverId) || 'disabled';
  }

  /**
   * 设置 OAuth 回调地址使用的实际 Web 服务端口
   * Set actual Web server port used for OAuth redirect URI
   */
  setOAuthCallbackPort(port: number): void {
    this.authManager.setCallbackPort(port);
  }

  /**
   * 处理 OAuth 授权回调换票
   * handle OAuth callback code exchange
   */
  async handleAuthCallback(code: string, state: string, serverIdHint?: string): Promise<string> {
    return await this.authManager.handleCallback(code, state, serverIdHint);
  }

  /**
   * 为指定服务构造鉴权请求头（支持静态配置与 OAuth 自动刷新）
   * Build authentication headers for specified server
   */
  private async buildAuthHeaders(serverId: string, config: McpServerConfig): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (config.headers) {
      Object.assign(headers, config.headers);
    }
    if (config.auth?.type === 'headers') {
      Object.assign(headers, config.auth.headers);
    } else if (config.auth?.type === 'oauth' || !config.auth) {
      const provider = this.authManager.getProvider(serverId);
      if (provider) {
        const token = await provider.getValidToken().catch(() => null);
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
    return headers;
  }

  /**
   * 初始化：读取配置并依据本地缓存快速注册工具箱，后台异步探测连通性
   * Initialize: load config, register toolboxes from cache, and probe asynchronously
   */
  async init(): Promise<void> {
    await this.loadConfig();

    const toolboxOwners = new Map<string, string>();

    for (const [serverId, config] of this.servers.entries()) {
      if (config.enabled === false) {
        this.statuses.set(serverId, 'disabled');
        continue;
      }

      const toolboxId = McpNaming.getToolboxId(serverId);
      const existingOwner = toolboxOwners.get(toolboxId);
      if (existingOwner) {
        this.context.logger.warn(
          `[FreyaMcpManager] Server '${serverId}' conflicts with '${existingOwner}' on toolbox ID '${toolboxId}'. Skipped.`
        );
        this.statuses.set(serverId, 'error');
        continue;
      }
      toolboxOwners.set(toolboxId, serverId);

      if (config.auth?.type === 'oauth') {
        this.authManager.registerServer(serverId, config.auth);
      }

      const session = new McpClientSession(
        config,
        () => this.buildAuthHeaders(serverId, config)
      );
      this.sessions.set(serverId, session);

      const cached = await this.cacheManager.loadCache(serverId);
      if (cached && cached.tools && cached.tools.length > 0) {
        const toolbox = new McpToolbox(serverId, toolboxId);
        toolbox.setDescription(cached.description || config.description || this.getFallbackDescription(serverId));
        toolbox.setInstructions(cached.instructions);
        this.mountToolsToBox(serverId, toolbox, cached.tools, session);
        this.toolboxes.set(serverId, toolbox);
        this.toolRegistry.registerToolbox(toolbox);
        this.statuses.set(serverId, 'ready');
      } else {
        this.statuses.set(serverId, 'connecting');
      }
    }

    this.probeAll().catch((err) => {
      this.context.logger.error('[FreyaMcpManager] Background probing error:', err);
    });
  }

  /**
   * 创建 OAuth 回调 HTTP 路由处理器
   * Create OAuth callback HTTP route handler
   */
  createOAuthHandler(): HttpRouteHandler {
    return createOAuthCallbackHandler(this.authManager, undefined, this.context);
  }

  /**
   * 读取 mcp.json 配置（支持 LAUNCH 与 HOME 双层合并）
   * Read and merge mcp.json configuration from LAUNCH and HOME tiers
   */
  private async loadConfig(): Promise<void> {
    const launchPath = path.join(FREYA_LAUNCH, 'config', 'mcp.json');
    const homePath = path.join(FREYA_HOME, 'config', 'mcp.json');

    const merged: Record<string, McpServerConfig> = {};

    const tryRead = async (filePath: string): Promise<McpConfigFile | null> => {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw) as McpConfigFile;
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.context.logger.warn(`[FreyaMcpManager] Failed to read or parse configuration file '${filePath}': ${err.message}`);
        }
        return null;
      }
    };

    const launchConfig = await tryRead(launchPath);
    this.launchServerIds.clear();
    if (launchConfig?.mcpServers) {
      for (const [k, v] of Object.entries(launchConfig.mcpServers)) {
        merged[k] = { ...v, enabled: v.enabled ?? false };
        this.launchServerIds.add(k);
      }
    }

    const homeConfig = await tryRead(homePath);
    if (homeConfig?.mcpServers) {
      for (const [k, v] of Object.entries(homeConfig.mcpServers)) {
        merged[k] = { ...(merged[k] || {}), ...v };
      }
    }

    this.servers.clear();
    for (const [k, v] of Object.entries(merged)) {
      if (v.url) {
        this.servers.set(k, v);
      }
    }
  }

  /**
   * 异步探测所有启用中的服务并刷新本地缓存
   * Asynchronously probe all enabled services and refresh cache
   */
  private async probeAll(): Promise<void> {
    for (const [serverId, config] of this.servers.entries()) {
      if (config.enabled === false) continue;
      await this.probeServer(serverId, config).catch((err) => {
        this.context.logger.warn(`[FreyaMcpManager] Probing server '${serverId}' failed: ${err.message}`);
      });
    }
  }

  /**
   * 探测单个服务
   * Probe a single remote MCP service
   */
  async probeServer(serverId: string, config: McpServerConfig, options: { force?: boolean } = {}): Promise<void> {
    const session = this.sessions.get(serverId);
    if (!session) return;

    try {
      const configHash = crypto.createHash('md5').update(JSON.stringify(config)).digest('hex');
      const cached = await this.cacheManager.loadCache(serverId);

      const hasRegisteredToolbox = this.toolboxes.has(serverId);
      const hasDescription = Boolean(config.description || cached?.description);
      if (!options.force && cached && cached.configHash === configHash && hasRegisteredToolbox && hasDescription) {
        return;
      }

      this.context.logger.info(`[FreyaMcpManager] Probing remote MCP server '${serverId}'...`);
      const { tools, instructions, serverInfo } = await session.listTools();

      const resolvedDescription = config.description
        || await this.generateDescriptionWithLLM(serverId, tools, instructions);

      await this.cacheManager.saveCache(serverId, {
        configHash,
        serverInfo,
        instructions,
        description: resolvedDescription,
        tools,
        updatedAt: Date.now()
      });

      let toolbox = this.toolboxes.get(serverId);
      if (!toolbox) {
        toolbox = new McpToolbox(serverId, McpNaming.getToolboxId(serverId));
        this.toolboxes.set(serverId, toolbox);
        this.toolRegistry.registerToolbox(toolbox);
      }

      toolbox.setDescription(resolvedDescription || this.getFallbackDescription(serverId));
      toolbox.setInstructions(instructions);
      this.mountToolsToBox(serverId, toolbox, tools, session);
      this.statuses.set(serverId, 'ready');
      this.connectionFailureCounts.delete(serverId);

      await session.disconnect();
    } catch (err: any) {
      if (err instanceof McpAuthRequiredError || err.name === 'McpAuthRequiredError') {
        this.statuses.set(serverId, 'auth_required');
        const provider = this.authManager.getProvider(serverId);
        if (provider && (err.authHeader || err.responseBody)) {
          provider.setAuthHint(err.authHeader, err.responseBody);
        }
      } else {
        this.statuses.set(serverId, 'error');
      }
      throw err;
    }
  }

  /**
   * 将远程工具清单按过滤规则筛选后挂载到本地工具箱
   * Filter and mount remote tools definition to local toolbox
   */
  private mountToolsToBox(
    serverId: string,
    toolbox: McpToolbox,
    tools: McpToolSchema[],
    session: McpClientSession
  ): void {
    const config = this.servers.get(serverId);
    let filteredTools = tools;

    if (config?.toolFilter) {
      const { include, exclude } = config.toolFilter;
      if (include && include.length > 0) {
        filteredTools = filteredTools.filter((t) => include.some((pattern) => this.matchWildcard(pattern, t.name)));
      }
      if (exclude && exclude.length > 0) {
        filteredTools = filteredTools.filter((t) => !exclude.some((pattern) => this.matchWildcard(pattern, t.name)));
      }
    }

    const bridgedTools: McpBridgedTool[] = filteredTools.map((t) => {
      const exposedName = McpNaming.formatToolName(serverId, t.name);
      return new McpBridgedTool(serverId, exposedName, t.name, t, {
        callTool: (originalName, args) => session.callTool(originalName, args),
        handleExecutionError: (err) => {
          this.handleToolExecutionFault(serverId, err);
        },
        handleExecutionSuccess: () => {
          this.handleToolExecutionSuccess(serverId);
        }
      });
    });
    toolbox.setTools(bridgedTools);
  }

  private matchWildcard(pattern: string, text: string): boolean {
    if (pattern === '*') return true;
    const escapedPattern = pattern
      .split('*')
      .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${escapedPattern}$`).test(text);
  }

  /**
   * 处理工具调用时的服务级故障：鉴权失效立即卸载，连接故障连续达到阈值后卸载
   * Handle service-level tool execution faults: unmount on auth failure, or after consecutive connection failures reach threshold
   */
  private handleToolExecutionFault(serverId: string, err: Error): void {
    if (err instanceof McpAuthRequiredError || err.name === 'McpAuthRequiredError') {
      this.context.logger.warn(`[FreyaMcpManager] Server '${serverId}' authentication required or expired.`);
      this.statuses.set(serverId, 'auth_required');
      const provider = this.authManager.getProvider(serverId);
      if (provider && ((err as any).authHeader || (err as any).responseBody)) {
        provider.setAuthHint((err as any).authHeader, (err as any).responseBody);
      }
      this.unmountToolbox(serverId);
    } else if (err instanceof McpConnectionError || err.name === 'McpConnectionError') {
      const failures = (this.connectionFailureCounts.get(serverId) || 0) + 1;
      this.connectionFailureCounts.set(serverId, failures);
      this.statuses.set(serverId, 'error');
      this.context.logger.warn(
        `[FreyaMcpManager] Server '${serverId}' connection error during execution (${failures}/${MAX_CONSECUTIVE_CONNECTION_FAILURES}): ${err.message}`
      );
      if (failures >= MAX_CONSECUTIVE_CONNECTION_FAILURES) {
        this.unmountToolbox(serverId);
      }
    }
  }

  /**
   * 工具调用成功后重置连接失败计数并恢复服务状态
   * Reset connection failure counter and restore status after successful tool execution
   */
  private handleToolExecutionSuccess(serverId: string): void {
    this.connectionFailureCounts.delete(serverId);
    if (this.statuses.get(serverId) === 'error') {
      this.statuses.set(serverId, 'ready');
    }
  }

  /**
   * 卸载指定服务的工具箱
   * Unmount toolbox of specified server
   */
  private unmountToolbox(serverId: string): void {
    this.toolRegistry.unregisterToolbox(McpNaming.getToolboxId(serverId));
    this.toolboxes.delete(serverId);
    this.connectionFailureCounts.delete(serverId);
  }

  /**
   * 重新探测指定服务并尝试重新挂载工具箱
   * Re-probe specified server and attempt remounting toolbox
   */
  async retryServer(serverId: string): Promise<void> {
    const config = this.servers.get(serverId);
    if (!config) {
      throw new Error(`Server '${serverId}' not found in configuration.`);
    }
    if (config.enabled === false) {
      throw new Error(`Server '${serverId}' is disabled in configuration.`);
    }
    if (!this.sessions.has(serverId)) {
      throw new Error(`Server '${serverId}' is not initialized.`);
    }
    await this.probeServer(serverId, config, { force: true });
  }

  /**
   * 生成服务描述缺失时的兜底描述
   * Build fallback description when service description is unavailable
   */
  private getFallbackDescription(serverId: string): string {
    return `Remote MCP tools for ${serverId}`;
  }

  /**
   * 初次探测时调用 LLM 提炼简明概要，失败时返回 undefined
   * Summarize service capabilities via LLM during initial probe, returning undefined on failure
   */
  private async generateDescriptionWithLLM(
    serverId: string,
    tools: McpToolSchema[],
    instructions?: string
  ): Promise<string | undefined> {
    try {
      const toolSummaries = tools.map((t) => `- ${t.name}: ${t.description || 'No description'}`).join('\n');
      const promptTemplate = this.promptRegistry.get('core.prompt.mcp_summarize') || '';
      if (!promptTemplate) {
        return undefined;
      }

      const content = `Server: ${serverId}\nInstructions: ${(instructions || '').slice(0, MAX_SUMMARIZE_INSTRUCTIONS_LENGTH)}\nTools:\n${toolSummaries}`;
      const prompt = promptTemplate.replace('{content}', () => content);

      const res = await this.context.llm.chat([
        { role: 'user', content: prompt }
      ]);

      return res.message.content?.trim() || undefined;
    } catch (err: any) {
      this.context.logger.warn(`[FreyaMcpManager] LLM description generation failed for '${serverId}': ${err?.message}`);
      return undefined;
    }
  }

  /**
   * 获取所有注册的服务状态
   * Get statuses of all registered MCP servers
   */
  getServerStatuses(): Record<string, { status: McpServerStatus; url: string; toolCount: number }> {
    const result: Record<string, { status: McpServerStatus; url: string; toolCount: number }> = {};
    for (const [sId, config] of this.servers.entries()) {
      const toolbox = this.toolboxes.get(sId);
      result[sId] = {
        status: this.statuses.get(sId) || 'disabled',
        url: config.url,
        toolCount: toolbox ? toolbox.getTools().length : 0
      };
    }
    return result;
  }

  /**
   * 获取运行时持久化配置 (FREYA_HOME/config/mcp.json)
   * Read runtime persistent config
   */
  private async readHomeConfig(): Promise<Record<string, McpServerConfig>> {
    const homePath = path.join(FREYA_HOME, 'config', 'mcp.json');
    try {
      const raw = await fs.readFile(homePath, 'utf-8');
      const data = JSON.parse(raw) as McpConfigFile;
      return data?.mcpServers || {};
    } catch {
      return {};
    }
  }

  /**
   * 原子化写入运行时持久化配置 (FREYA_HOME/config/mcp.json)
   * Atomically save runtime persistent config
   */
  private async writeHomeConfig(mcpServers: Record<string, McpServerConfig>): Promise<void> {
    const homeConfigDir = path.join(FREYA_HOME, 'config');
    await fs.mkdir(homeConfigDir, { recursive: true });
    const homePath = path.join(homeConfigDir, 'mcp.json');
    const tempPath = `${homePath}.tmp.${Date.now()}`;
    const payload: McpConfigFile = { mcpServers };

    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
    try {
      await fs.rename(tempPath, homePath);
    } catch {
      await fs.copyFile(tempPath, homePath);
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  /**
   * 获取所有 MCP 服务完整清单及其实时运行状态
   * List all MCP servers with their runtime statuses and registered tools
   */
  async listServers(): Promise<any[]> {
    const result: any[] = [];
    for (const [id, config] of this.servers.entries()) {
      const toolbox = this.toolboxes.get(id);
      const isLaunch = this.launchServerIds.has(id);
      result.push({
        id,
        toolboxId: McpNaming.getToolboxId(id),
        url: config.url,
        description: config.description || toolbox?.getDescription() || '',
        enabled: config.enabled !== false,
        source: isLaunch ? 'launch' : 'runtime',
        status: this.statuses.get(id) || 'disabled',
        toolCount: toolbox ? toolbox.getTools().length : 0,
        headers: config.headers,
        auth: config.auth,
        config,
        toolFilter: config.toolFilter,
        timeoutMs: config.timeoutMs,
        idleTimeoutMs: config.idleTimeoutMs,
        tools: toolbox ? toolbox.getTools().map(t => {
          const def = t.getDefinition();
          return {
            name: (t as any).getOriginalName?.() || def.name,
            exposedName: def.name,
            description: def.description,
            parameters: def.parameters
          };
        }) : []
      });
    }
    return result;
  }

  /**
   * 热新增或更新单个 MCP 服务配置
   * Upsert MCP server configuration and apply changes dynamically
   */
  async saveServer(serverId: string, config: McpServerConfig): Promise<void> {
    const cleanId = serverId.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) {
      throw new Error(`Invalid serverId: '${cleanId}'. Only alphanumeric characters, dashes, and underscores are allowed.`);
    }
    if (!config?.url || !/^https?:\/\//i.test(config.url)) {
      throw new Error(`Invalid server URL: '${config?.url}'. Must be a valid HTTP/HTTPS endpoint.`);
    }

    const homeServers = await this.readHomeConfig();
    homeServers[cleanId] = config;
    await this.writeHomeConfig(homeServers);

    const oldSession = this.sessions.get(cleanId);
    if (oldSession) {
      await oldSession.disconnect().catch(() => {});
    }

    this.servers.set(cleanId, config);

    if (config.auth?.type === 'oauth') {
      this.authManager.registerServer(cleanId, config.auth, config.url);
    } else {
      this.authManager.registerServer(cleanId, { type: 'oauth' }, config.url);
    }

    if (config.enabled !== false) {
      const session = new McpClientSession(
        config,
        () => this.buildAuthHeaders(cleanId, config)
      );
      this.sessions.set(cleanId, session);
      this.statuses.set(cleanId, 'connecting');

      this.probeServer(cleanId, config, { force: true }).catch((err) => {
        this.context.logger.warn(`[FreyaMcpManager] Hot apply probe failed for '${cleanId}': ${err.message}`);
      });
    } else {
      this.unmountToolbox(cleanId);
      this.statuses.set(cleanId, 'disabled');
    }
  }

  /**
   * 热删除指定 MCP 服务（保留本地 Token 凭据与缓存历史数据）
   * Remove MCP server dynamically while preserving historical tokens and cache
   */
  async removeServer(serverId: string): Promise<void> {
    const oldSession = this.sessions.get(serverId);
    if (oldSession) {
      await oldSession.disconnect().catch(() => {});
    }

    this.unmountToolbox(serverId);
    this.servers.delete(serverId);
    this.sessions.delete(serverId);
    this.statuses.delete(serverId);
    this.connectionFailureCounts.delete(serverId);

    const homeServers = await this.readHomeConfig();
    if (serverId in homeServers) {
      delete homeServers[serverId];
      await this.writeHomeConfig(homeServers);
    }
  }

  /**
   * 热切换指定 MCP 服务的启用/禁用状态
   * Toggle MCP server enabled state dynamically
   */
  async toggleServer(serverId: string, enabled: boolean): Promise<void> {
    const config = this.servers.get(serverId);
    if (!config) {
      throw new Error(`Server '${serverId}' not found.`);
    }

    const updatedConfig: McpServerConfig = { ...config, enabled };
    this.servers.set(serverId, updatedConfig);

    const homeServers = await this.readHomeConfig();
    homeServers[serverId] = { ...(homeServers[serverId] || {}), ...updatedConfig };
    await this.writeHomeConfig(homeServers);

    if (!enabled) {
      const oldSession = this.sessions.get(serverId);
      if (oldSession) {
        await oldSession.disconnect().catch(() => {});
      }
      this.unmountToolbox(serverId);
      this.statuses.set(serverId, 'disabled');
    } else {
      let session = this.sessions.get(serverId);
      if (!session) {
        session = new McpClientSession(
          updatedConfig,
          () => this.buildAuthHeaders(serverId, updatedConfig)
        );
        this.sessions.set(serverId, session);
      }

      const cached = await this.cacheManager.loadCache(serverId);
      if (cached && cached.tools && cached.tools.length > 0) {
        const toolboxId = McpNaming.getToolboxId(serverId);
        const toolbox = new McpToolbox(serverId, toolboxId);
        toolbox.setDescription(cached.description || updatedConfig.description || this.getFallbackDescription(serverId));
        toolbox.setInstructions(cached.instructions);
        this.mountToolsToBox(serverId, toolbox, cached.tools, session);
        this.toolboxes.set(serverId, toolbox);
        this.toolRegistry.registerToolbox(toolbox);
        this.statuses.set(serverId, 'ready');
      } else {
        this.statuses.set(serverId, 'connecting');
      }

      this.probeServer(serverId, updatedConfig).catch((err) => {
        this.context.logger.warn(`[FreyaMcpManager] Toggle probe failed for '${serverId}': ${err.message}`);
      });
    }
  }

  /**
   * 内核关闭时断开所有活跃会话
   * Disconnect all active client sessions on shutdown
   */
  async stop(): Promise<void> {
    this.authManager.stop();
    for (const session of this.sessions.values()) {
      await session.disconnect().catch(() => { });
    }
  }
}
