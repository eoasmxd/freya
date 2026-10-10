import type { FreyaAttachment, FreyaContext, LLMMessage, LLMPlugin, LLMPluginOptions, LLMTokenUsage, ToolDefinition } from '@eoasmxd/freya-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';
import { I18n } from './i18n/index.js';
import zh from './i18n/locales/zh.js';
import en from './i18n/locales/en.js';

/**
 * OpenAI 兼容模型插件，支持流式传输与 Abort 中断
 * OpenAI compatible model plugin supporting streaming and Abort interruption
 */
export default class OpenAICompatiblePlugin implements LLMPlugin {
  type = 'llm' as const;
  providerTypes = ['openai'];
  private context!: FreyaContext;
  private readonly i18n = new I18n({ zh, en });

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;
    this.i18n.setContext(ctx);
    ctx.logger.info('OpenAI-compatible model plugin initialized.');
  }

  /**
   * 解析图片附件为合法的 image_url (data URL 或公网 URL)
   * Resolve image attachment to valid image_url (data URL or public URL)
   */
  private async resolveImageUrl(img: FreyaAttachment): Promise<string | null> {
    if (img.url) {
      return img.url;
    }
    if (img.base64) {
      return `data:${img.mimeType};base64,${img.base64}`;
    }
    if (img.path) {
      try {
        if (path.isAbsolute(img.path)) {
          throw new Error('Security rejection: Only relative paths within workspace are allowed.');
        }
        const workspaceAbs = this.context.paths.workspaceDir;
        const targetAbs = path.resolve(workspaceAbs, img.path);
        const workspacePrefix = workspaceAbs.endsWith(path.sep) ? workspaceAbs : workspaceAbs + path.sep;

        if (targetAbs !== workspaceAbs && !targetAbs.startsWith(workspacePrefix)) {
          throw new Error(`Security rejection: Out of workspace bounds path "${img.path}".`);
        }

        const buffer = await fs.readFile(targetAbs);
        return `data:${img.mimeType};base64,${buffer.toString('base64')}`;
      } catch (err: any) {
        this.context.logger.error(`Failed to read local image attachment [${img.path}]:`, err.message);
      }
    }
    return null;
  }

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMPluginOptions
  ): Promise<{ message: LLMMessage; usage?: LLMTokenUsage }> {
    const { apiKey, baseURL } = options?.providerConfig || {};
    const modelId = options?.modelId;

    if (!apiKey || apiKey.trim() === '') {
      // 未配置有效的 API 密钥
      throw new Error(
        this.i18n.t('error.missingApiKey', 'API key is not configured or empty. Please check provider settings.')
      );
    }

    if (!modelId || modelId.trim() === '') {
      // 未配置有效的模型 ID
      throw new Error(
        this.i18n.t('error.missingModelId', 'Model ID (modelId) is not configured. Please check provider settings.')
      );
    }

    const openAiMessages = await Promise.all(messages.map(async (msg, idx) => {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }))
        };
      }

      if (msg.role === 'tool') {
        let matchedId = msg.toolCallId;
        if (!matchedId) {
          for (let i = idx - 1; i >= 0; i--) {
            const prevMsg = messages[i];
            if (prevMsg.role === 'assistant' && prevMsg.toolCalls) {
              matchedId = prevMsg.toolCalls[0]?.id;
              break;
            }
          }
        }

        const imageAttachments = msg.attachments ? msg.attachments.filter((a) => a.mimeType.startsWith('image/')) : [];
        if (imageAttachments.length > 0) {
          const contentArray: any[] = [{ type: 'text', text: msg.content || '' }];
          for (const img of imageAttachments) {
            const url = await this.resolveImageUrl(img);
            if (url) {
              contentArray.push({
                type: 'image_url',
                image_url: { url }
              });
            } else {
              contentArray.push({
                type: 'text',
                text: `[Failed to load image attachment: ${img.url || img.path || 'unknown'}]`
              });
            }
          }
          return {
            role: 'tool',
            content: contentArray,
            tool_call_id: matchedId || 'call_default'
          };
        }

        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: matchedId || 'call_default'
        };
      }

      const imageAttachments = msg.attachments ? msg.attachments.filter((a) => a.mimeType.startsWith('image/')) : [];
      if (msg.role === 'user' && imageAttachments.length > 0) {
        const contentArray: any[] = [{ type: 'text', text: msg.content || '' }];
        for (const img of imageAttachments) {
          const url = await this.resolveImageUrl(img);
          if (url) {
            contentArray.push({
              type: 'image_url',
              image_url: { url }
            });
          } else {
            contentArray.push({
              type: 'text',
              text: `[Failed to load image attachment: ${img.url || img.path || 'unknown'}]`
            });
          }
        }

        return {
          role: 'user',
          content: contentArray
        };
      }

      return {
        role: msg.role,
        content: msg.content
      };
    }));

    const openAiTools = tools && tools.length > 0
      ? tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }))
      : undefined;

    const params = options?.modelParams || {};
    const requestBody: Record<string, any> = {
      model: modelId,
      messages: openAiMessages,
      tools: openAiTools
    };

    if (typeof params.temperature === 'number') {
      requestBody.temperature = params.temperature;
    }
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) {
      requestBody.max_tokens = params.maxTokens;
    }
    if (typeof params.topP === 'number') {
      requestBody.top_p = params.topP;
    }
    if (typeof params.presencePenalty === 'number') {
      requestBody.presence_penalty = params.presencePenalty;
    }
    if (typeof params.frequencyPenalty === 'number') {
      requestBody.frequency_penalty = params.frequencyPenalty;
    }
    if (params.stopSequences !== undefined) {
      requestBody.stop = params.stopSequences;
    }
    if (params.responseFormat !== undefined) {
      requestBody.response_format = params.responseFormat;
    }
    if (typeof params.seed === 'number') {
      requestBody.seed = params.seed;
    }

    const isStream = !!options?.onChunk && (!tools || tools.length === 0);
    if (isStream) {
      requestBody.stream = true;
      requestBody.stream_options = { include_usage: true };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };

    const timeoutMs = typeof params.timeout === 'number' ? params.timeout : 90000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: combinedSignal
      });
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('aborted')) {
        if (options?.signal?.aborted) {
          throw err;
        }
        // 连接大模型服务超时
        throw new Error(
          this.i18n.t('error.timeout', 'LLM service connection timeout ({timeout}s). Check API connectivity or baseURL: {baseURL}', {
            timeout: timeoutMs / 1000,
            baseURL: baseURL || ''
          })
        );
      }
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      // 模型服务端返回错误
      throw new Error(
        this.i18n.t('error.serverError', 'LLM server returned error (HTTP {status}): {detail}', {
          status: response.status,
          detail: errText
        })
      );
    }

    if (isStream && response.body) {
      let finalContent = '';
      let usage: LLMTokenUsage | undefined;
      let finishReason: string | null = null;
      const streamToolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          if (combinedSignal.aborted) {
            throw new DOMException('The user aborted the request.', 'AbortError');
          }
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const choice = parsed.choices?.[0];
                if (choice?.finish_reason) {
                  finishReason = choice.finish_reason;
                }
                if (choice?.delta?.content) {
                  const text = choice.delta.content;
                  finalContent += text;
                  options?.onChunk?.(text);
                }
                if (Array.isArray(choice?.delta?.tool_calls)) {
                  for (const tc of choice.delta.tool_calls) {
                    const idx = typeof tc.index === 'number' ? tc.index : streamToolCallsMap.size;
                    let call = streamToolCallsMap.get(idx);
                    if (!call) {
                      call = { id: '', name: '', arguments: '' };
                      streamToolCallsMap.set(idx, call);
                    }
                    if (tc.id) call.id = tc.id;
                    if (tc.function?.name) call.name += tc.function.name;
                    if (tc.function?.arguments) call.arguments += tc.function.arguments;
                  }
                }
                if (parsed.usage) {
                  usage = {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                    cachedPromptTokens: parsed.usage.prompt_tokens_details?.cached_tokens || 0
                  };
                }
              } catch { }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          this.context.logger.warn('HTTP stream connection aborted.');
        }
        throw err;
      }

      const streamToolCalls = Array.from(streamToolCallsMap.values())
        .filter((tc) => tc.name)
        .map((tc, idx) => ({
          id: tc.id || `call_${Math.random().toString(36).substring(2, 11)}_${idx}`,
          name: tc.name,
          arguments: tc.arguments
        }));
      const hasStreamToolCalls = streamToolCalls.length > 0;

      if (finishReason === 'length' && !finalContent.trim() && !hasStreamToolCalls) {
        throw new Error(
          this.i18n.t('error.lengthLimitReached', 'Generation terminated due to token limit (finish_reason: length) without valid output. Please increase maxTokens.')
        );
      }
      if (!finalContent.trim() && !hasStreamToolCalls) {
        throw new Error(
          this.i18n.t('error.emptyResponse', 'LLM service returned an empty response without tool calls. Please check prompt instructions or model settings.')
        );
      }

      const message: LLMMessage = {
        role: 'assistant',
        content: finalContent
      };

      if (hasStreamToolCalls) {
        message.toolCalls = streamToolCalls;
      }

      return {
        message,
        usage
      };
    }

    const json = await response.json() as any;
    const choice = json.choices?.[0];
    if (!choice) {
      // 模型服务未响应有效选项
      throw new Error(
        this.i18n.t('error.noChoices', 'LLM service responded without valid choices.')
      );
    }

    const finishReason = choice.finish_reason;
    const rawContent = choice.message?.content;
    const hasToolCalls = Array.isArray(choice.message?.tool_calls) && choice.message.tool_calls.length > 0;
    const contentText = typeof rawContent === 'string' ? rawContent : '';

    if (finishReason === 'length' && !contentText.trim() && !hasToolCalls) {
      throw new Error(
        this.i18n.t('error.lengthLimitReached', 'Generation terminated due to token limit (finish_reason: length) without valid output. Please increase maxTokens.')
      );
    }
    if (!contentText.trim() && !hasToolCalls) {
      throw new Error(
        this.i18n.t('error.emptyResponse', 'LLM service returned an empty response without tool calls. Please check prompt instructions or model settings.')
      );
    }

    const message: LLMMessage = {
      role: 'assistant',
      content: contentText
    };

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      message.toolCalls = choice.message.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments
      }));
    }

    const usage = json.usage
      ? {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens,
        totalTokens: json.usage.total_tokens,
        cachedPromptTokens: json.usage.prompt_tokens_details?.cached_tokens || 0
      }
      : undefined;

    return {
      message,
      usage
    };
  }
}

export const Plugin = OpenAICompatiblePlugin;
