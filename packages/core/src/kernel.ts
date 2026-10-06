import { FreyaAgentExecutor } from './agent/agent-executor.js';
import { FreyaAgentService } from './agent/agent-service.js';
import { FreyaBillingService } from './billing/billing-service.js';
import { CommandBootstrapper } from './command/command-bootstrapper.js';
import { FreyaCommandRegistry } from './command/command-registry.js';
import { FreyaCommandExecutor } from './command/command-executor.js';
import { FreyaConfigManager } from './config/config-manager.js';
import { FreyaConfigSchemaRegistry } from './config/schema-registry.js';
import { FreyaConnectionManager } from './connection/connection-manager.js';
import { DefaultFreyaContext } from './context.js';
import { FreyaEventBus } from './event/event-bus.js';
import { FreyaLLMProxy } from './llm/llm-proxy.js';
import { FreyaLLMRegistry } from './llm/llm-registry.js';
import { FreyaLogger } from './logger.js';
import { FreyaPluginManager } from './plugin/plugin-manager.js';
import { FreyaPluginRegistry } from './plugin/plugin-registry.js';
import { FreyaChannelRegistry } from './channel/channel-registry.js';
import { FreyaCliChannel } from './channel/cli-channel.js';
import { FreyaWsChannel } from './channel/ws-channel.js';
import { FreyaPromptManager } from './prompt/prompt-manager.js';
import { FreyaPromptRegistry } from './prompt/prompt-registry.js';
import { FreyaSessionManager } from './session/session-manager.js';
import { FreyaSkillRegistry } from './skill/skill-registry.js';
import { ConfigToolbox } from './tools/config/index.js';
import { SessionToolbox } from './tools/session/index.js';
import { FreyaMetaToolbox } from './tools/meta/index.js';
import { FreyaToolRegistry } from './tools/tool-registry.js';
import { FreyaWebContainer } from './web/web-container.js';
import { FreyaConfigApi } from './config/config-api.js';
import { FREYA_APP } from './utils/paths.js';

/**
 * Freya 核心微内核，负责协调各子系统启动与关闭
 * Freya core microkernel responsible for coordinating startup and shutdown of subsystems
 */
export class FreyaKernel {
  private context = new DefaultFreyaContext();
  private sessionManager!: FreyaSessionManager;

  private webContainer?: FreyaWebContainer;
  private wsChannel?: FreyaWsChannel;
  private cliChannel?: FreyaCliChannel;
  private pluginManager?: FreyaPluginManager;
  private billingService?: FreyaBillingService;
  private agentService?: FreyaAgentService;
  private connectionManager?: FreyaConnectionManager;
  private channelRegistry?: FreyaChannelRegistry;

  async start(): Promise<void> {
    const ctx = this.context;

    ctx.logger = new FreyaLogger();
    ctx.logger.info('Starting Freya core service...');
    ctx.eventBus = new FreyaEventBus();

    const configSchemaRegistry = new FreyaConfigSchemaRegistry();
    const toolRegistry = new FreyaToolRegistry(ctx);
    const llmRegistry = new FreyaLLMRegistry(ctx);
    const promptRegistry = new FreyaPromptRegistry(ctx);

    const commandRegistry = new FreyaCommandRegistry(ctx);
    this.channelRegistry = new FreyaChannelRegistry();
    const pluginRegistry = new FreyaPluginRegistry(toolRegistry, llmRegistry, this.channelRegistry);
    const skillRegistry = new FreyaSkillRegistry();

    const promptManager = new FreyaPromptManager(promptRegistry, ctx);
    this.pluginManager = new FreyaPluginManager(configSchemaRegistry, commandRegistry, promptRegistry);

    await this.pluginManager.loadConfiguredPlugins(pluginRegistry, ctx);

    const configManager = new FreyaConfigManager(
      ctx,
      configSchemaRegistry,
      promptManager,
      llmRegistry,
      this.pluginManager,
      skillRegistry
    );

    configManager.registerCoreSchema();

    await configManager.loadAndInit();

    await configManager.resolveAndFreeze();
    await promptRegistry.loadKernelPrompts();
    await skillRegistry.loadSkills(ctx);

    llmRegistry.setProviders(await configManager.listProviders());

    const defaultLLM = llmRegistry.getDefault();
    if (!defaultLLM) {
      ctx.logger.warn('No available LLM configuration detected. Please configure LLM provider keys and models.default in settings to enable chat functionality.');
    }

    ctx.llm = new FreyaLLMProxy(llmRegistry, ctx);
    this.billingService = new FreyaBillingService(ctx, llmRegistry);

    this.sessionManager = new FreyaSessionManager();
    await this.sessionManager.load(ctx, promptRegistry);

    this.connectionManager = new FreyaConnectionManager(ctx.eventBus, ctx.logger);

    const configToolbox = new ConfigToolbox(configManager, ctx);
    const sessionToolbox = new SessionToolbox(this.sessionManager, ctx);
    const metaToolbox = new FreyaMetaToolbox(this.sessionManager, toolRegistry, skillRegistry);
    toolRegistry.registerToolbox(configToolbox);
    toolRegistry.registerToolbox(sessionToolbox);
    toolRegistry.registerToolbox(metaToolbox);

    CommandBootstrapper.registerBuiltinCommands({
      registry: commandRegistry,
      context: ctx,
      skillRegistry,
      sessionManager: this.sessionManager
    });

    const agentExecutor = new FreyaAgentExecutor(
      ctx,
      promptRegistry,
      this.sessionManager,
      toolRegistry,
      skillRegistry
    );

    const commandExecutor = new FreyaCommandExecutor(ctx, commandRegistry);

    this.agentService = new FreyaAgentService(ctx, agentExecutor, commandExecutor, this.sessionManager, promptRegistry);

    sessionToolbox.setAgentService(this.agentService);

    const webEnabled = (ctx.config as any)?.server?.enabled !== false;
    const cliEnabled = !process.argv.includes('--no-cli') && (ctx.config as any)?.cli?.enabled !== false;

    if (webEnabled) {
      this.webContainer = new FreyaWebContainer();
      ctx.http = this.webContainer;

      const configApi = new FreyaConfigApi(configManager, ctx);
      this.webContainer.registerApi('/api/config', (req, res) => configApi.handleRequest(req, res));

      const uiDistPath = this.webContainer.getUiDistPath(FREYA_APP);
      this.webContainer.registerStatic('/', uiDistPath, { spaFallback: true, injectLanguage: true });

      await this.webContainer.start(ctx);
    }

    if (this.channelRegistry) {
      if (webEnabled && this.webContainer) {
        this.wsChannel = new FreyaWsChannel();
        this.webContainer.registerUpgrade('/ws', (req, socket, head) => {
          this.wsChannel?.handleUpgrade(req, socket, head);
        });
        this.channelRegistry.register(this.wsChannel);
        await this.wsChannel.setup(ctx);
        await this.wsChannel.start(ctx);
      }

      if (cliEnabled) {
        this.cliChannel = new FreyaCliChannel();
        this.channelRegistry.register(this.cliChannel);
        await this.cliChannel.setup(ctx);
        await this.cliChannel.start(ctx);
      }
    }

    await this.pluginManager.setupAndStartAll(ctx);

    ctx.logger.info(`Freya core service started successfully. Loaded ${this.pluginManager.getLoadedPlugins().length} plugins.`);

    ctx.eventBus.on('system:exit', async () => {
      await this.stop();
      process.exit(0);
    });
  }

  async stop(): Promise<void> {
    this.connectionManager?.stop();
    await this.pluginManager?.stopAll(this.context);
    await this.cliChannel?.stop(this.context);
    await this.wsChannel?.stop();
    await this.webContainer?.stop();
    this.context.logger.info('Freya core service stopped.');
  }
}
