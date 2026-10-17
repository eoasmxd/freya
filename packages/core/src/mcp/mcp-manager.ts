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

/**
 * MCP 核心管理器，统筹配置探测、工具箱注册、连接与生命周期调度
 * MCP core manager orchestrating config probing, toolboxes registration and connection lifecycle
 */
export class FreyaMcpManager {
  private servers = new Map<string, McpServerConfig>();
  private sessions = new Map<string, McpClientSession>();
  private toolboxes = new Map<string, McpToolbox>();
  private statuses = new Map<string, McpServerStatus>();

  private readonly cacheManager = new McpCacheManager();
  private readonly authManager: McpOAuthManager;

  constructor(
    private readonly context: FreyaContext,
    private readonly toolRegistry: FreyaToolRegistry,
    private readonly promptRegistry: FreyaPromptRegistry
  ) {
    this.authManager = new McpOAuthManager(undefined, this.context);
    this.authManager.setOnAuthSuccess(async (serverId) => {
      const cfg = this.servers.get(serverId);
      if (cfg) {
        await this.probeServer(serverId, cfg);
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
    if (config.auth?.type === 'headers') {
      Object.assign(headers, config.auth.headers);
    } else if (config.auth?.type === 'oauth') {
      const provider = this.authManager.getProvider(serverId);
      if (provider) {
        const token = await provider.getValidToken();
        headers['Authorization'] = `Bearer ${token}`;
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

    for (const [serverId, config] of this.servers.entries()) {
      if (config.enabled === false) {
        this.statuses.set(serverId, 'disabled');
        continue;
      }

      if (config.auth?.type === 'oauth') {
        this.authManager.registerServer(serverId, config.auth);
      }

      const toolboxId = `mcp_${serverId}`;
      const session = new McpClientSession(
        config,
        () => this.buildAuthHeaders(serverId, config)
      );
      this.sessions.set(serverId, session);

      const cached = await this.cacheManager.loadCache(serverId);
      if (cached && cached.tools && cached.tools.length > 0) {
        const toolbox = new McpToolbox(serverId, toolboxId);
        toolbox.setDescription(cached.description || config.description);
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
    return createOAuthCallbackHandler(
      this.authManager,
      async (serverId) => {
        const cfg = this.servers.get(serverId);
        if (cfg) {
          await this.probeServer(serverId, cfg);
        }
      },
      this.context
    );
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
      } catch {
        return null;
      }
    };

    const launchConfig = await tryRead(launchPath);
    if (launchConfig?.mcpServers) {
      for (const [k, v] of Object.entries(launchConfig.mcpServers)) {
        merged[k] = { ...v, enabled: v.enabled ?? false };
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
  async probeServer(serverId: string, config: McpServerConfig): Promise<void> {
    const session = this.sessions.get(serverId);
    if (!session) return;

    try {
      const configHash = crypto.createHash('md5').update(JSON.stringify(config)).digest('hex');
      const cached = await this.cacheManager.loadCache(serverId);

      if (cached && cached.configHash === configHash) {
        return;
      }

      this.context.logger.info(`[FreyaMcpManager] Probing remote MCP server '${serverId}'...`);
      const { tools, instructions, serverInfo } = await session.listTools();

      let finalDescription = config.description;
      if (!finalDescription) {
        finalDescription = await this.generateDescriptionWithLLM(serverId, tools, instructions);
      }

      await this.cacheManager.saveCache(serverId, {
        configHash,
        serverInfo,
        instructions,
        description: finalDescription,
        tools,
        updatedAt: Date.now()
      });

      let toolbox = this.toolboxes.get(serverId);
      if (!toolbox) {
        toolbox = new McpToolbox(serverId, `mcp_${serverId}`);
        this.toolboxes.set(serverId, toolbox);
        this.toolRegistry.registerToolbox(toolbox);
      }

      toolbox.setDescription(finalDescription);
      toolbox.setInstructions(instructions);
      this.mountToolsToBox(serverId, toolbox, tools, session);
      this.statuses.set(serverId, 'ready');

      await session.disconnect();
    } catch (err: any) {
      if (err instanceof McpAuthRequiredError || err.name === 'McpAuthRequiredError') {
        this.statuses.set(serverId, 'auth_required');
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
        }
      });
    });
    toolbox.setTools(bridgedTools);
  }

  private matchWildcard(pattern: string, text: string): boolean {
    if (pattern === '*') return true;
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    return regex.test(text);
  }

  /**
   * 处理工具调用时的服务级致命故障，动态卸载工具箱
   * Handle fatal service-level tool execution errors and unmount toolbox dynamically
   */
  private handleToolExecutionFault(serverId: string, err: Error): void {
    if (err instanceof McpAuthRequiredError || err.name === 'McpAuthRequiredError') {
      this.context.logger.warn(`[FreyaMcpManager] Server '${serverId}' authentication required or expired.`);
      this.statuses.set(serverId, 'auth_required');
      this.toolRegistry.unregisterToolbox(`mcp_${serverId}`);
      this.toolboxes.delete(serverId);
    } else if (err instanceof McpConnectionError || err.name === 'McpConnectionError') {
      this.context.logger.warn(`[FreyaMcpManager] Server '${serverId}' connection lost during execution: ${err.message}`);
      this.statuses.set(serverId, 'error');
      this.toolRegistry.unregisterToolbox(`mcp_${serverId}`);
      this.toolboxes.delete(serverId);
    }
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
    await this.probeServer(serverId, config);
  }

  /**
   * 初次探测时调用 LLM 提炼简明概要
   * Summarize service capabilities via LLM during initial probe
   */
  private async generateDescriptionWithLLM(
    serverId: string,
    tools: McpToolSchema[],
    instructions?: string
  ): Promise<string> {
    try {
      const toolSummaries = tools.map((t) => `- ${t.name}: ${t.description || 'No description'}`).join('\n');
      const promptTemplate = this.promptRegistry.get('core.prompt.mcp_summarize') ||
        'Summarize the following MCP service tools into a 50-100 word concise description:\n{content}';

      const content = `Server: ${serverId}\nInstructions: ${(instructions || '').slice(0, MAX_SUMMARIZE_INSTRUCTIONS_LENGTH)}\nTools:\n${toolSummaries}`;
      const prompt = promptTemplate.replace('{content}', content);

      const res = await this.context.llm.chat([
        { role: 'user', content: prompt }
      ]);

      return res.message.content?.trim() || `Provides tools for ${serverId}`;
    } catch {
      return `Remote MCP tools for ${serverId}`;
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
   * 内核关闭时断开所有活跃会话
   * Disconnect all active client sessions on shutdown
   */
  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.disconnect().catch(() => { });
    }
  }
}
