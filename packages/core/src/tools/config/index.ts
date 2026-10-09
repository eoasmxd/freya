import type { FreyaContext, FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';
import {
  CreateModelTool,
  DeleteModelTool,
  ListModelTool,
  UpdateModelTool
} from './model-tools.js';
import {
  DisablePluginTool,
  EnablePluginTool,
  ListPluginTool
} from './plugin-tools.js';
import {
  EditPromptTool,
  ReadPromptTool,
  WritePromptTool
} from './prompt-tools.js';
import {
  CreateProviderTool,
  DeleteProviderTool,
  ListProviderTool,
  UpdateProviderTool
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
      new ReadConfigTool(configService, this.pendingAuths, ctx),
      new UpdateConfigTool(configService, this.pendingAuths, ctx),
      new ReadPromptTool(configService),
      new WritePromptTool(configService),
      new EditPromptTool(configService),
      new ListPluginTool(configService, ctx),
      new EnablePluginTool(configService, ctx),
      new DisablePluginTool(configService, ctx),
      new ListProviderTool(configService),
      new CreateProviderTool(configService),
      new UpdateProviderTool(configService),
      new DeleteProviderTool(configService),
      new ListModelTool(configService),
      new CreateModelTool(configService),
      new UpdateModelTool(configService),
      new DeleteModelTool(configService)
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
