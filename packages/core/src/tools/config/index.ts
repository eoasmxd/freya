import type { FreyaContext, FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';
import {
  AddModelTool,
  EditModelTool,
  ListModelsTool,
  RemoveModelTool
} from './model-tools.js';
import {
  ListPluginsTool,
  TogglePluginTool
} from './plugin-tools.js';
import {
  EditPromptTool,
  ReadPromptTool,
  WritePromptTool
} from './prompt-tools.js';
import {
  AddProviderTool,
  EditProviderTool,
  ListProvidersTool,
  RemoveProviderTool
} from './provider-tools.js';
import {
  ReadConfigTool,
  UpdateConfigTool
} from './tools.js';

export class ConfigToolbox implements FreyaToolbox {
  private tools: FreyaTool[] = [];
  private pendingAuths = new Map<string, (approved: boolean) => void>();

  constructor(
    private configService: FreyaConfigManager,
    ctx: FreyaContext
  ) {
    ctx.eventBus.on('config:auth_response', (payload: { authId: string; approved: boolean }) => {
      const resolve = this.pendingAuths.get(payload.authId);
      if (resolve) {
        this.pendingAuths.delete(payload.authId);
        resolve(payload.approved);
      }
    });

    this.tools = [
      new ReadConfigTool(configService, this.pendingAuths),
      new UpdateConfigTool(configService, this.pendingAuths),
      new ReadPromptTool(configService),
      new WritePromptTool(configService),
      new EditPromptTool(configService),
      new ListPluginsTool(configService),
      new TogglePluginTool(configService),
      new ListProvidersTool(configService),
      new AddProviderTool(configService),
      new EditProviderTool(configService),
      new RemoveProviderTool(configService),
      new ListModelsTool(configService),
      new AddModelTool(configService),
      new EditModelTool(configService),
      new RemoveModelTool(configService)
    ];
  }

  getId(): string {
    return 'config';
  }

  getInstructionPrompt(): string {
    return 'tool.prompt.config';
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }
}
