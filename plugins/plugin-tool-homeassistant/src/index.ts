import type { FreyaContext, FreyaTool, ToolPlugin } from '@eoasmxd/freya-sdk';
import { HomeAssistantClient } from './client.js';
import { HomeAssistantSecurityGateway } from './security.js';
import { HomeAssistantIntegrationDeployer } from './deployer.js';
import { I18n } from './i18n/index.js';
import en from './i18n/locales/en.js';
import zh from './i18n/locales/zh.js';
import {
  HomeAssistantCallServiceTool,
  HomeAssistantListEntityTool,
  HomeAssistantListServiceTool,
  HomeAssistantReadHistoryTool,
  HomeAssistantReadStateTool
} from './tools.js';

/**
 * Home Assistant 智能家居交互工具箱插件
 * Home Assistant smart home interaction toolbox plugin
 */
export default class HomeAssistantPlugin implements ToolPlugin {
  type = 'tool' as const;

  private readonly i18n = new I18n({ en, zh });
  private readonly client = new HomeAssistantClient();
  private readonly security = new HomeAssistantSecurityGateway();
  private readonly deployer = new HomeAssistantIntegrationDeployer(this.client, this.i18n);
  private readonly listTool = new HomeAssistantListEntityTool(this.client, this.security);
  private readonly getStateTool = new HomeAssistantReadStateTool(this.client, this.security);
  private readonly getHistoryTool = new HomeAssistantReadHistoryTool(this.client, this.security);
  private readonly listServicesTool = new HomeAssistantListServiceTool(this.client, this.security);
  private readonly callServiceTool = new HomeAssistantCallServiceTool(this.client, this.security);

  async setup(ctx: FreyaContext): Promise<void> {
    this.i18n.setContext(ctx);
    this.security.setContext(ctx);
    this.client.startBackgroundSync(60_000);
    this.deployer.deployIfNeeded(ctx).catch((err) => {
      ctx.logger.warn(`[HomeAssistantPlugin] Integration deployment encountered an error: ${err}`);
    });
  }

  async stop(ctx: FreyaContext): Promise<void> {
    this.client.stopBackgroundSync();
  }

  getId(): string {
    return 'homeassistant';
  }

  getInstructionPrompt(): string {
    return 'plugin.prompt.homeassistant';
  }

  getTools(): FreyaTool[] {
    const tools: FreyaTool[] = [
      this.listTool,
      this.getStateTool,
      this.getHistoryTool
    ];

    if (this.security.isControlAllowed()) {
      tools.push(this.listServicesTool);
      tools.push(this.callServiceTool);
    }

    return tools;
  }
}

export const Plugin = HomeAssistantPlugin;
