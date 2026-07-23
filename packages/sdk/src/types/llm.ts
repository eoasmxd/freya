import type { FreyaAttachment } from './attachment.js';
import type { ToolDefinition } from './tool.js';

export interface LLMConsumptionContext {
  ownerType: string;
  ownerId: string;
}

export interface LLMOptions {
  modelId?: string;
  providerId?: string;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  attachments?: FreyaAttachment[];
  modelParams?: Record<string, any>;
  modelType?: 'default' | 'router' | 'image' | 'audio';
  onModelSelected?: (providerId: string, modelId: string) => void;
  billingContext?: LLMConsumptionContext;
}

export interface LLMPluginOptions extends LLMOptions {
  modelId: string;
  providerConfig: {
    apiKey: string;
    baseURL?: string;
  };
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: LLMToolCall[];
  attachments?: FreyaAttachment[];
  toolCallId?: string;
  thoughtSignature?: string;
  toolName?: string;
  timestamp?: number;
}

export interface LLMTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

export interface ILLMService {
  chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMOptions
  ): Promise<{
    message: LLMMessage;
    usage?: LLMTokenUsage;
  }>;
  getContextWindow(modelId?: string): number;
  getModelCapabilities?(modelId?: string, providerId?: string): string[];
}
