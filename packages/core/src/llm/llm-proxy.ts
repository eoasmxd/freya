import type {
  LLMOptions,
  LLMMessage,
  FreyaContext,
  ILLMService,
  LLMPluginOptions,
  LLMTokenUsage,
  ToolDefinition
} from '@eoasmxd/freya-sdk';
import { FreyaLLMLogger } from './llm-logger.js';
import { FreyaLLMRegistry } from './llm-registry.js';

interface ModelCandidate {
  provider: string;
  model: string;
  name: string;
}

interface HealthState {
  type: 'healthy' | 'temporary_failed' | 'fatal_failed';
  lastFailedTime?: number;
  lastSuccessTime?: number;
  errorMessage?: string;
}

/** 大模型代理服务，提供带降级链的 LLM 调用入口 */
export class FreyaLLMProxy implements ILLMService {
  private llmLogger: FreyaLLMLogger;
  private modelHealthRegistry = new Map<string, HealthState>();

  constructor(
    private llmRegistry: FreyaLLMRegistry,
    private context: FreyaContext
  ) {
    this.llmLogger = new FreyaLLMLogger(!!this.context.config.log?.llm);
  }

  /**
   * 发起大模型对话请求，支持工具调用与多候选自动降级熔断。
   */
  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMOptions
  ): Promise<{ message: LLMMessage; usage?: LLMTokenUsage }> {
    const modelChain = this.buildModelChain(options);
    let lastError: any = null;

    for (const candidate of modelChain) {
      const currentProviderId = candidate.provider;
      const currentModelId = candidate.model;

      try {
        const result = await this.executeChat(messages, tools, {
          ...options,
          providerId: currentProviderId || undefined,
          modelId: currentModelId || undefined
        });

        this.modelHealthRegistry.set(`${currentProviderId}:${currentModelId}`, {
          type: 'healthy',
          lastSuccessTime: Date.now()
        });

        if (options?.onModelSelected && currentModelId) {
          options.onModelSelected(currentProviderId, currentModelId);
        }
        return result;
      } catch (err: any) {
        lastError = err;
        const errorType = this.classifyError(err);
        if (errorType === 'fatal') {
          this.modelHealthRegistry.set(`${currentProviderId}:${currentModelId}`, {
            type: 'fatal_failed',
            errorMessage: err.message || String(err)
          });
        } else {
          this.modelHealthRegistry.set(`${currentProviderId}:${currentModelId}`, {
            type: 'temporary_failed',
            lastFailedTime: Date.now(),
            errorMessage: err.message || String(err)
          });
        }
        this.context.logger.warn(
          `[FreyaLLMProxy] 模型 [${candidate.name}] 调用遭遇 [${errorType}] 级异常，已熔断避让: ${err.message}`
        );
      }
    }

    throw lastError || new Error('所有候选模型均调用失败，无可用备选。');
  }

  private async executeChat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMOptions
  ): Promise<{ message: LLMMessage; usage?: LLMTokenUsage }> {
    const providers = this.llmRegistry.providers;

    const providerConfig = providers.find((p) => {
      if (options?.providerId) return p.id === options.providerId;
      if (options?.modelId) return p.models.some((m: any) => m.id === options.modelId);
      return p.apiKey && p.apiKey.trim() !== '';
    });

    if (!providerConfig || !providerConfig.apiKey || providerConfig.apiKey.trim() === '') {
      throw new Error(
        '未检测到可用的大模型配置或对应的大模型授权密钥已失效，调用失败。'
      );
    }

    const providerId = options?.providerId || providerConfig.id;
    const targetPlugin = this.llmRegistry.getPluginForProvider(providerId);
    if (!targetPlugin) {
      throw new Error(
        `未找到能处理提供商 "${providerId}" 的 LLM 插件实例。`
      );
    }

    const providerName = providerConfig.name || providerConfig.id;
    const modelId = options?.modelId || providerConfig.models?.[0]?.id || 'unknown';
    const modelConfig = providerConfig.models?.find((m: any) => m.id === modelId) || {};
    const isStream = !!options?.onChunk && (!tools || tools.length === 0);

    const startTime = Date.now();
    this.llmLogger.enabled = !!this.context.config.log?.llm;
    this.llmLogger.logRequest({
      provider: providerName,
      model: modelId,
      stream: isStream,
      messages,
      tools
    });

    const {
      id: _id,
      name: _name,
      inputPrice: _ip,
      outputPrice: _op,
      cachedInputPrice: _cip,
      contextWindow: _cw,
      contextTokens: _ct,
      capabilities: _cap,
      ...cleanModelConfig
    } = modelConfig as any;

    const enrichedOptions: LLMPluginOptions = {
      ...options,
      modelId,
      providerConfig: {
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL
      },
      modelParams: {
        ...cleanModelConfig,
        ...options?.modelParams
      }
    };

    try {
      const result = await targetPlugin.chat(messages, tools, enrichedOptions);
      const durationMs = Date.now() - startTime;

      this.llmLogger.logResponse({
        provider: providerName,
        model: modelId,
        status: 200,
        usage: result.usage,
        durationMs,
        contentPreview: result.message.content || ''
      });

      if (result.usage) {
        const ownerType = options?.billingContext?.ownerType || 'system';
        const ownerId = options?.billingContext?.ownerId || 'kernel';
        this.context.eventBus.emit('token:consumed', {
          ownerType,
          ownerId,
          providerId,
          modelId,
          usage: result.usage
        });
      }

      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      let errorMsg = err.message || String(err);
      if (err.cause) {
        const causeMsg = err.cause.message || String(err.cause);
        errorMsg += ` (Cause: ${causeMsg})`;
      }

      this.llmLogger.logError({
        provider: providerName,
        model: modelId,
        error: errorMsg,
        durationMs
      });

      throw err;
    }
  }

  private classifyError(err: any): 'fatal' | 'temporary' {
    const msg = String(err.message || err).toLowerCase();
    const status = Number(err.status || err.statusCode || err.code);

    if (
      status === 401 ||
      status === 403 ||
      msg.includes('api key') ||
      msg.includes('apikey') ||
      msg.includes('invalid key') ||
      msg.includes('unauthorized') ||
      msg.includes('forbidden') ||
      msg.includes('quota') ||
      msg.includes('billing') ||
      msg.includes('insufficient')
    ) {
      return 'fatal';
    }
    return 'temporary';
  }

  private buildModelChain(options?: LLMOptions): ModelCandidate[] {
    const preferredProviderId = options?.providerId;
    const preferredModelId = options?.modelId;

    const modelType = options?.modelType || 'default';
    const configModels = this.context.config.models?.[modelType] || this.context.config.models?.default || [];

    const candidates: ModelCandidate[] = configModels.map(
      (m: any) => ({
        provider: m.provider || this.getProviderForModel(m.model || m.id),
        model: m.model || m.id,
        name: m.name || m.model || m.id
      })
    );

    const getModelScore = (candidate: ModelCandidate): number => {
      const key = `${candidate.provider}:${candidate.model}`;
      const state = this.modelHealthRegistry.get(key);
      if (!state) {
        return 1;
      }
      if (state.type === 'fatal_failed') {
        return -99999999;
      }
      if (state.type === 'temporary_failed') {
        const lastFailed = state.lastFailedTime || 0;
        const passedTime = Date.now() - lastFailed;
        const COOLDOWN_MS = 5 * 60 * 1000;
        if (passedTime < COOLDOWN_MS) {
          return -100;
        }
        return 0;
      }
      return state.lastSuccessTime || 1;
    };

    candidates.sort((a, b) => getModelScore(b) - getModelScore(a));

    if (preferredModelId) {
      const provider = preferredProviderId || this.getProviderForModel(preferredModelId);
      const preferred: ModelCandidate = {
        provider,
        model: preferredModelId,
        name: preferredProviderId ? `${preferredProviderId}/${preferredModelId}` : preferredModelId
      };
      const filtered = candidates.filter((m) => {
        if (preferredProviderId) {
          return !(m.model === preferredModelId && m.provider === provider);
        }
        return m.model !== preferredModelId;
      });
      return [preferred, ...filtered];
    }

    if (candidates.length === 0) {
      return [{ provider: '', model: '', name: '默认' }];
    }
    return candidates;
  }

  private getProviderForModel(modelId: string): string {
    const providers = this.llmRegistry.providers;
    for (const p of providers) {
      if (Array.isArray(p.models) && p.models.some((m: any) => m.id === modelId)) {
        return p.id;
      }
    }
    return '';
  }

  /**
   * 获取指定模型的最大上下文 Token 额度。
   */
  getContextWindow(modelId?: string): number {
    const providers = this.llmRegistry.providers;
    const effectiveModelId = modelId || 'default-model';
    for (const p of providers) {
      if (p.models) {
        const model = p.models.find((m: any) => m.id === effectiveModelId);
        if (model) return model.contextTokens ?? model.contextWindow ?? 16000;
      }
    }
    return 16000;
  }
}
