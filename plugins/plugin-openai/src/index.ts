import type { FreyaContext, LLMMessage, LLMPlugin, LLMPluginOptions, LLMTokenUsage, ToolDefinition } from '@eoasmxd/freya-sdk';
import path from 'node:path';
import fs from 'node:fs/promises';

/** OpenAI 兼容模型插件，支持流式传输与 Abort 中断 */
export default class OpenAICompatiblePlugin implements LLMPlugin {
  type = 'llm' as const;
  providerTypes = ['openai'];
  private context!: FreyaContext;

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;
    ctx.logger.info('OpenAI 兼容模型插件初始化就绪。');
  }

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMPluginOptions
  ): Promise<{ message: LLMMessage; usage?: LLMTokenUsage }> {
    const { apiKey, baseURL } = options?.providerConfig || {};
    const modelId = options?.modelId;

    if (!apiKey || apiKey.trim() === '') {
      throw new Error('未配置有效的大模型授权密钥，请在配置中检查。');
    }

    if (!modelId || modelId.trim() === '') {
      throw new Error('未配置有效的模型 ID (modelId)，请在配置中检查。');
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
          let url = img.url;
          if (!url && img.base64) {
            url = `data:${img.mimeType};base64,${img.base64}`;
          } else if (!url && img.path) {
            try {
              if (path.isAbsolute(img.path)) {
                throw new Error('安全拒绝：只能访问工作区以内的相对路径。');
              }
              const workspaceAbs = this.context.paths.workspaceDir;
              const targetAbs = path.resolve(workspaceAbs, img.path);
              const workspacePrefix = workspaceAbs.endsWith(path.sep) ? workspaceAbs : workspaceAbs + path.sep;

              if (targetAbs !== workspaceAbs && !targetAbs.startsWith(workspacePrefix)) {
                throw new Error(`安全越界拒绝：无法访问工作区以外的相对路径 "${img.path}"。`);
              }

              const buffer = await fs.readFile(targetAbs);
              url = `data:${img.mimeType};base64,${buffer.toString('base64')}`;
            } catch (err: any) {
              this.context.logger.error(`读取本地图像附件失败 [${img.path}]:`, err.message);
            }
          }
          if (url) {
            contentArray.push({
              type: 'image_url',
              image_url: { url }
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
        throw new Error(`连接大模型服务超时 (${timeoutMs / 1000}s)，请检查 API 网络连通性或 baseURL: ${baseURL}`);
      }
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`模型服务端返回错误 (HTTP ${response.status}): ${errText}`);
    }

    if (isStream && response.body) {
      let finalContent = '';
      let usage: LLMTokenUsage | undefined;
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
                if (choice?.delta?.content) {
                  const text = choice.delta.content;
                  finalContent += text;
                  options?.onChunk?.(text);
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

      return {
        message: { role: 'assistant', content: finalContent },
        usage
      };
    }

    const json = await response.json() as any;
    const choice = json.choices?.[0];
    if (!choice) {
      throw new Error('模型服务未响应有效选项选择。');
    }

    const message: LLMMessage = {
      role: 'assistant',
      content: choice.message.content || ''
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
