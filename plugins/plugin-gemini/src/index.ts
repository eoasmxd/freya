import type { FreyaContext, LLMMessage, LLMPlugin, LLMPluginOptions, LLMTokenUsage, ToolDefinition } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

export default class GeminiPlugin implements LLMPlugin {
  type = 'llm' as const;
  providerTypes = ['gemini'];
  private context!: FreyaContext;

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;
    this.context.logger.info('Gemini 模型插件初始化就绪。');
  }

  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: LLMPluginOptions
  ): Promise<{ message: LLMMessage; usage?: LLMTokenUsage }> {
    const { apiKey, baseURL } = options?.providerConfig || {};
    const finalBaseURL = (baseURL && baseURL.trim() !== '')
      ? baseURL.trim()
      : 'https://generativelanguage.googleapis.com';
    const modelId = options?.modelId;

    if (!apiKey || apiKey.trim() === '') {
      throw new Error('未配置有效的大模型授权密钥，请在配置中检查。');
    }
    if (!modelId || modelId.trim() === '') {
      throw new Error('未配置有效的模型 ID (modelId)，请在配置中检查。');
    }

    const systemMessage = messages.find((m) => m.role === 'system');
    const systemInstruction = systemMessage?.content
      ? { parts: [{ text: systemMessage.content }] }
      : undefined;

    const geminiContents = await Promise.all(
      messages
        .filter((m) => m.role !== 'system')
        .map(async (msg) => {
          if (msg.role === 'assistant') {
            const parts: any[] = [];
            if (msg.content) {
              parts.push({ text: msg.content });
            }
            if (msg.toolCalls && msg.toolCalls.length > 0) {
              for (const tc of msg.toolCalls) {
                parts.push({
                  functionCall: {
                    name: tc.name,
                    args: JSON.parse(tc.arguments || '{}')
                  }
                });
              }
            }
            return { role: 'model', parts };
          }

          if (msg.role === 'tool') {
            return {
              role: 'tool',
              parts: [
                {
                  functionResponse: {
                    name: msg.toolCallId || 'default_tool',
                    response: { result: msg.content }
                  }
                }
              ]
            };
          }

          const parts: any[] = [{ text: msg.content || '' }];
          const imageAttachments = msg.attachments ? msg.attachments.filter((a) => a.mimeType.startsWith('image/')) : [];
          for (const img of imageAttachments) {
            let base64Data = img.base64;
            if (!base64Data && img.path) {
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
                base64Data = buffer.toString('base64');
              } catch (err: any) {
                this.context.logger.error(`读取本地图像附件失败 [${img.path}]:`, err.message);
              }
            }
            if (base64Data) {
              parts.push({
                inlineData: {
                  mimeType: img.mimeType,
                  data: base64Data
                }
              });
            }
          }
          return { role: 'user', parts };
        })
    );

    const geminiTools = tools && tools.length > 0
      ? [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }]
      : undefined;

    const { temperature, maxTokens, max_tokens, topP, top_p, timeout, ...extraParams } = options?.modelParams || {};
    const generationConfig: Record<string, any> = { ...extraParams };
    if (typeof temperature === 'number') generationConfig.temperature = temperature;
    const finalMaxTokens = maxTokens ?? max_tokens;
    if (typeof finalMaxTokens === 'number' && finalMaxTokens > 0) generationConfig.maxOutputTokens = finalMaxTokens;
    const finalTopP = topP ?? top_p;
    if (typeof finalTopP === 'number') generationConfig.topP = finalTopP;

    const requestBody: Record<string, any> = {
      contents: geminiContents,
      generationConfig
    };
    if (systemInstruction) requestBody.systemInstruction = systemInstruction;
    if (geminiTools) requestBody.tools = geminiTools;

    const timeoutMs = typeof timeout === 'number' ? timeout : 90000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const isStream = !!options?.onChunk && (!tools || tools.length === 0);
    const urlSuffix = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const hasQuery = urlSuffix.includes('?');
    const requestUrl = `${finalBaseURL.replace(/\/+$/, '')}/v1beta/models/${modelId}:${urlSuffix}${hasQuery ? '&' : '?'}key=${apiKey}`;

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: combinedSignal
      });
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout') || err.message?.includes('aborted')) {
        if (options?.signal?.aborted) throw err;
        throw new Error(`连接 Gemini 模型服务超时 (${timeoutMs / 1000}s)，请检查网络连通性。`);
      }
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini 服务端返回错误 (HTTP ${response.status}): ${errText}`);
    }

    if (isStream && response.body) {
      let finalContent = '';
      let usage: LLMTokenUsage | undefined;
      let streamToolCalls: any[] | undefined;
      let buffer = '';

      try {
        const stream = response.body;
        if (typeof (stream as any)[Symbol.asyncIterator] === 'function') {
          for await (const chunk of stream as any) {
            if (combinedSignal.aborted) {
              throw new DOMException('The user aborted the request.', 'AbortError');
            }
            const decoder = new TextDecoder();
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              let rawJson = trimmed;
              if (trimmed.startsWith('data: ')) {
                rawJson = trimmed.slice(6);
              }

              if (rawJson.startsWith('{') && rawJson.endsWith('}')) {
                try {
                  const parsed = JSON.parse(rawJson);
                  if (parsed.error) {
                    throw new Error(`Gemini 流错误: ${parsed.error.message || JSON.stringify(parsed.error)}`);
                  }

                  const candidate = parsed.candidates?.[0];
                  const part = candidate?.content?.parts?.[0];
                  if (part?.text) {
                    const text = part.text;
                    finalContent += text;
                    options?.onChunk?.(text);
                  }
                  if (part?.functionCall) {
                    if (!streamToolCalls) streamToolCalls = [];
                    streamToolCalls.push({
                      id: `call_${Math.random().toString(36).substring(2, 11)}`,
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {})
                    });
                  }
                  if (parsed.usageMetadata) {
                    usage = {
                      promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                      completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                      totalTokens: parsed.usageMetadata.totalTokenCount || 0
                    };
                  }
                } catch (parseErr) {
                  if (parseErr instanceof Error && parseErr.message.startsWith('Gemini 流错误')) {
                    throw parseErr;
                  }
                }
              }
            }
          }
        } else {
          const reader = (stream as any).getReader();
          const decoder = new TextDecoder();
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

              let rawJson = trimmed;
              if (trimmed.startsWith('data: ')) {
                rawJson = trimmed.slice(6);
              }

              if (rawJson.startsWith('{') && rawJson.endsWith('}')) {
                try {
                  const parsed = JSON.parse(rawJson);
                  if (parsed.error) {
                    throw new Error(`Gemini 流错误: ${parsed.error.message || JSON.stringify(parsed.error)}`);
                  }

                  const candidate = parsed.candidates?.[0];
                  const part = candidate?.content?.parts?.[0];
                  if (part?.text) {
                    const text = part.text;
                    finalContent += text;
                    options?.onChunk?.(text);
                  }
                  if (part?.functionCall) {
                    if (!streamToolCalls) streamToolCalls = [];
                    streamToolCalls.push({
                      id: `call_${Math.random().toString(36).substring(2, 11)}`,
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args || {})
                    });
                  }
                  if (parsed.usageMetadata) {
                    usage = {
                      promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                      completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                      totalTokens: parsed.usageMetadata.totalTokenCount || 0
                    };
                  }
                } catch (parseErr) {
                  if (parseErr instanceof Error && parseErr.message.startsWith('Gemini 流错误')) {
                    throw parseErr;
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          this.context.logger.warn('Gemini HTTP stream connection aborted.');
        }
        throw err;
      }

      return {
        message: {
          role: 'assistant',
          content: finalContent,
          toolCalls: streamToolCalls
        },
        usage
      };
    }

    const json = await response.json() as any;
    if (json.error) {
      throw new Error(`Gemini API 错误: ${json.error.message || JSON.stringify(json.error)}`);
    }

    if (json.promptFeedback?.blockReason) {
      throw new Error(`Gemini 输入安全策略拦截 (blockReason: "${json.promptFeedback.blockReason}")`);
    }

    const candidate = json.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (!part?.text && !part?.functionCall && candidate?.finishReason && candidate.finishReason !== 'STOP') {
      throw new Error(`Gemini 输出安全策略拦截/未生成 (finishReason: "${candidate.finishReason}")`);
    }

    const message: LLMMessage = {
      role: 'assistant',
      content: part?.text || ''
    };

    if (part?.functionCall) {
      message.toolCalls = [{
        id: `call_${Math.random().toString(36).substring(2, 11)}`,
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args || {})
      }];
    }

    const usage = json.usageMetadata
      ? {
        promptTokens: json.usageMetadata.promptTokenCount || 0,
        completionTokens: json.usageMetadata.candidatesTokenCount || 0,
        totalTokens: json.usageMetadata.totalTokenCount || 0
      }
      : undefined;

    return { message, usage };
  }
}

export const Plugin = GeminiPlugin;
