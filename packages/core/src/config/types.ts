export interface ModelConfig {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
  cachedInputPrice: number;
  contextWindow: number;
  contextTokens?: number;
  maxTokens?: number;
  capabilities: ('text' | 'image' | string)[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | string;
  baseURL?: string;
  apiKey?: string;
  models: ModelConfig[];
}
