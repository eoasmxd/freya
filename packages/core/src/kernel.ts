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

/** Freya 核心微内核，负责协调各子系统启动与关闭 */
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
    ctx.logger.info('Freya 核心服务正在启动...');
    ctx.eventBus = new FreyaEventBus();

    const configSchemaRegistry = new FreyaConfigSchemaRegistry();
    const toolRegistry = new FreyaToolRegistry();
    const llmRegistry = new FreyaLLMRegistry();
    const promptRegistry = new FreyaPromptRegistry();

    const commandRegistry = new FreyaCommandRegistry();
    this.channelRegistry = new FreyaChannelRegistry();
    const pluginRegistry = new FreyaPluginRegistry(toolRegistry, llmRegistry, this.channelRegistry);
    const skillRegistry = new FreyaSkillRegistry();

    const promptManager = new FreyaPromptManager(promptRegistry, ctx.logger);
    this.pluginManager = new FreyaPluginManager(configSchemaRegistry, commandRegistry, promptRegistry);

    await this.pluginManager.loadConfiguredPlugins(pluginRegistry, ctx);

    const configManager = new FreyaConfigManager(
      ctx,
      configSchemaRegistry,
      promptManager,
      llmRegistry,
      this.pluginManager
    );

    configManager.registerCoreSchema();

    const { port } = await configManager.loadAndInit();

    await configManager.resolveAndFreeze();
    await promptRegistry.loadKernelPrompts();
    await skillRegistry.loadSkills(ctx);

    llmRegistry.setProviders(await configManager.listProviders());

    const defaultLLM = llmRegistry.getDefault();
    if (!defaultLLM) {
      ctx.logger.warn('未检测到可用的大模型配置。请在核心服务启动后，通过 Web 设置页面或物理配置文件配置大模型密钥与 models.default，以恢复对话功能。');
    }

    ctx.llm = new FreyaLLMProxy(llmRegistry, ctx);
    this.billingService = new FreyaBillingService(ctx, llmRegistry);

    this.sessionManager = new FreyaSessionManager();
    await this.sessionManager.load(ctx, promptRegistry);

    this.connectionManager = new FreyaConnectionManager(ctx.eventBus, ctx.logger);

    const configToolbox = new ConfigToolbox(configManager, ctx);
    const sessionToolbox = new SessionToolbox(this.sessionManager);
    const metaToolbox = new FreyaMetaToolbox(this.sessionManager, toolRegistry);
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

    this.webContainer = new FreyaWebContainer();
    await this.webContainer.start(ctx, port, configManager);

    if (this.channelRegistry) {
      this.wsChannel = new FreyaWsChannel(this.webContainer.getServer());
      this.channelRegistry.register(this.wsChannel);
      await this.wsChannel.setup(ctx);
      await this.wsChannel.start(ctx);

      this.cliChannel = new FreyaCliChannel();
      this.channelRegistry.register(this.cliChannel);
      await this.cliChannel.setup(ctx);
      await this.cliChannel.start(ctx);
    }

    await this.pluginManager.setupAndStartAll(ctx);

    ctx.logger.info(`Freya 核心服务启动成功。共加载了 ${this.pluginManager.getLoadedPlugins().length} 个物理插件。`);

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
    this.context.logger.info('Freya 核心服务已停止。');
  }
}
