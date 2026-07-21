import type { ConfigFieldSchema } from './config.js';
import type { FreyaContext } from './context.js';
import type { FreyaCommand } from './command.js';
import type { FreyaToolbox } from './tool.js';
import type { LLMMessage, LLMPluginOptions, LLMTokenUsage } from './llm.js';
import type { ToolDefinition } from './tool.js';

export type PluginType = 'llm' | 'tool' | 'channel';

export interface FreyaPlugin {
  type: PluginType;
  id?: string;
  name?: string;
  version?: string;
  commands?: FreyaCommand[];

  setup(ctx: FreyaContext): Promise<void>;
  start?(ctx: FreyaContext): Promise<void>;
  stop?(ctx: FreyaContext): Promise<void>;
}

export interface ChannelPlugin extends FreyaPlugin {}

export interface ToolPlugin extends FreyaPlugin, FreyaToolbox {
  type: 'tool';
}

export interface LLMPlugin extends FreyaPlugin {
  providerTypes?: string[];
  chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMPluginOptions
  ): Promise<{
    message: LLMMessage;
    usage?: LLMTokenUsage;
  }>;
}
