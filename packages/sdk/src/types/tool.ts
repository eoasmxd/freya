import type { FreyaContext } from './context.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
}

export interface FreyaTool {
  getDefinition(): ToolDefinition;
  execute(args: Record<string, any>, ctx: FreyaContext): Promise<string>;
}

export interface FreyaToolbox {
  getId(): string;
  getTools(): FreyaTool[];
  getInstructionPrompt?(): string;
}
