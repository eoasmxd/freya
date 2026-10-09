import type { FreyaAttachment } from './attachment.js';
import type { FreyaContext } from './context.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;
}

export interface FreyaToolResult {
  content: string;
  attachments?: FreyaAttachment[];
}

export interface FreyaTool {
  getDefinition(): ToolDefinition;
  execute(args: Record<string, any>): Promise<string | FreyaToolResult>;
  isVisible?(session?: any): boolean;
}

export interface FreyaToolbox {
  getId(): string;
  getTools(): FreyaTool[];
  getInstructionPrompt?(): string;
}
