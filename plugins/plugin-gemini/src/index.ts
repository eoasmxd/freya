import type { FreyaAttachment, FreyaContext, LLMMessage, LLMPlugin, LLMPluginOptions, LLMTokenUsage, ToolDefinition } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { I18n } from './i18n/index.js';
import zh from './i18n/locales/zh.js';
import en from './i18n/locales/en.js';

export default class GeminiPlugin implements LLMPlugin {
  type = 'llm' as const;
  providerTypes = ['gemini'];
  private context!: FreyaContext;
  private readonly i18n = new I18n({ zh, en });

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;
    this.i18n.setContext(ctx);
    this.context.logger.info('Gemini model plugin initialized.');
  }

  /**
   * 解析附件数据为 Base64 编码
   * Resolve attachment data to Base64 encoding
   */
  private async resolveAttachmentBase64(att: FreyaAttachment): Promise<string | null> {
    let base64Data = att.base64;

    if (!base64Data && !att.path && att.url) {
      try {
        const hash = crypto.createHash('md5').update(att.url).digest('hex');
        const cleanMimeType = att.mimeType.split(';')[0].trim();
        const ext = cleanMimeType.split('/')[1] || 'bin';
        const cacheRelPath = `cache/gemini/${hash}.${ext}`;
        const cacheAbsPath = path.resolve(this.context.paths.workspaceDir, cacheRelPath);

        let fileExists = false;
        try {
          await fs.access(cacheAbsPath);
          fileExists = true;
        } catch { }

        if (!fileExists) {
          this.context.logger.info(`Downloading remote attachment to physical cache [${att.url}]...`);
          const response = await fetch(att.url);
          if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          await fs.mkdir(path.dirname(cacheAbsPath), { recursive: true });
          await fs.writeFile(cacheAbsPath, buffer);
        }

        att.path = cacheRelPath;
      } catch (err: any) {
        this.context.logger.error(`Failed to cache remote attachment locally [${att.url}]:`, err.message);
      }
    }

    if (!base64Data && att.path) {
      try {
        if (path.isAbsolute(att.path)) {
          throw new Error('Security rejection: Only relative paths within workspace are allowed.');
        }
        const workspaceAbs = this.context.paths.workspaceDir;
        const targetAbs = path.resolve(workspaceAbs, att.path);
        const workspacePrefix = workspaceAbs.endsWith(path.sep) ? workspaceAbs : workspaceAbs + path.sep;

        if (targetAbs !== workspaceAbs && !targetAbs.startsWith(workspacePrefix)) {
          throw new Error(`Security rejection: Out of workspace bounds path "${att.path}".`);
        }

        const buffer = await fs.readFile(targetAbs);
        base64Data = buffer.toString('base64');
      } catch (err: any) {
        this.context.logger.error(`Failed to read local attachment [${att.path}]:`, err.message);
      }
    }

    return base64Data || null;
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
              const sig = msg.thoughtSignature;
              for (const tc of msg.toolCalls) {
                parts.push({
                  functionCall: {
                    name: tc.name,
                    args: JSON.parse(tc.arguments || '{}')
                  },
                  ...(sig ? { thoughtSignature: sig } : {})
                });
              }
            }
            return { role: 'model', parts };
          }

          if (msg.role === 'tool') {
            let toolName = msg.toolName;
            if (!toolName && msg.toolCallId) {
              const idx = messages.indexOf(msg);
              if (idx > 0) {
                for (let i = idx - 1; i >= 0; i--) {
                  const prev = messages[i];
                  if (prev.role === 'assistant' && prev.toolCalls) {
                    const match = prev.toolCalls.find((tc) => tc.id === msg.toolCallId);
                    if (match) {
                      toolName = match.name;
                      break;
                    }
                  }
                }
              }
            }
            const parts: any[] = [
              {
                functionResponse: {
                  name: toolName || 'default_tool',
                  response: { result: msg.content }
                }
              }
            ];

            const validAttachments = msg.attachments ? msg.attachments.filter((a) => a.mimeType) : [];
            for (const att of validAttachments) {
              const base64Data = await this.resolveAttachmentBase64(att);
              if (base64Data) {
                parts.push({
                  inlineData: {
                    mimeType: att.mimeType,
                    data: base64Data
                  }
                });
              } else {
                parts.push({
                  text: `[Failed to load attachment: ${att.url || att.path || 'unknown'}]`
                });
              }
            }

            return {
              role: 'user',
              parts
            };
          }

          const parts: any[] = [{ text: msg.content || '' }];
          const validAttachments = msg.attachments ? msg.attachments.filter((a) => a.mimeType) : [];
          for (const att of validAttachments) {
            const base64Data = await this.resolveAttachmentBase64(att);
            if (base64Data) {
              parts.push({
                inlineData: {
                  mimeType: att.mimeType,
                  data: base64Data
                }
              });
            } else {
              parts.push({
                text: `[Failed to load attachment: ${att.url || att.path || 'unknown'}]`
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

    const params = options?.modelParams || {};
    const generationConfig: Record<string, any> = {};

    if (typeof params.temperature === 'number') {
      generationConfig.temperature = params.temperature;
    }
    if (typeof params.maxTokens === 'number' && params.maxTokens > 0) {
      generationConfig.maxOutputTokens = params.maxTokens;
    }
    if (typeof params.topP === 'number') {
      generationConfig.topP = params.topP;
    }
    if (typeof params.topK === 'number') {
      generationConfig.topK = params.topK;
    }
    if (params.stopSequences !== undefined) {
      generationConfig.stopSequences = params.stopSequences;
    }
    if (typeof params.presencePenalty === 'number') {
      generationConfig.presencePenalty = params.presencePenalty;
    }
    if (typeof params.frequencyPenalty === 'number') {
      generationConfig.frequencyPenalty = params.frequencyPenalty;
    }
    if (params.responseFormat?.type === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
      if (params.responseFormat.jsonSchema) {
        generationConfig.responseSchema = params.responseFormat.jsonSchema;
      }
    }

    const requestBody: Record<string, any> = {
      contents: geminiContents,
      generationConfig
    };
    if (systemInstruction) requestBody.systemInstruction = systemInstruction;
    if (geminiTools) requestBody.tools = geminiTools;

    const timeoutMs = typeof params.timeout === 'number' ? params.timeout : 90000;
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
        // 连接 Gemini 模型服务超时
        throw new Error(
          this.i18n.t('error.timeout', 'Gemini service connection timeout ({timeout}s). Check network connectivity.', {
            timeout: timeoutMs / 1000
          })
        );
      }
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      // Gemini 服务端返回错误
      throw new Error(
        this.i18n.t('error.serverError', 'Gemini server returned error (HTTP {status}): {detail}', {
          status: response.status,
          detail: errText
        })
      );
    }

    if (isStream && response.body) {
      let finalContent = '';
      let usage: LLMTokenUsage | undefined;
      let streamToolCalls: any[] | undefined;
      let thoughtSignature: string | undefined;
      let buffer = '';
      let streamFinishReason: string | null = null;

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
                    // Gemini 流响应错误
                    const streamErr: any = new Error(
                      this.i18n.t('error.streamError', 'Gemini stream error: {detail}', {
                        detail: parsed.error.message || JSON.stringify(parsed.error)
                      })
                    );
                    streamErr.isStreamError = true;
                    throw streamErr;
                  }

                  const candidate = parsed.candidates?.[0];
                  if (candidate?.finishReason) {
                    streamFinishReason = candidate.finishReason;
                  }
                  const parts = candidate?.content?.parts || [];
                  for (const part of parts) {
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
                    const sig = part?.thoughtSignature;
                    if (sig) {
                      thoughtSignature = sig;
                    }
                  }
                  if (parsed.usageMetadata) {
                    usage = {
                      promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                      completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                      totalTokens: parsed.usageMetadata.totalTokenCount || 0
                    };
                  }
                } catch (parseErr: any) {
                  if (parseErr?.isStreamError) {
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
                    // Gemini 流响应错误
                    const streamErr: any = new Error(
                      this.i18n.t('error.streamError', 'Gemini stream error: {detail}', {
                        detail: parsed.error.message || JSON.stringify(parsed.error)
                      })
                    );
                    streamErr.isStreamError = true;
                    throw streamErr;
                  }

                  const candidate = parsed.candidates?.[0];
                  if (candidate?.finishReason) {
                    streamFinishReason = candidate.finishReason;
                  }
                  const parts = candidate?.content?.parts || [];
                  for (const part of parts) {
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
                    const sig = part?.thoughtSignature;
                    if (sig) {
                      thoughtSignature = sig;
                    }
                  }
                  if (parsed.usageMetadata) {
                    usage = {
                      promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                      completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                      totalTokens: parsed.usageMetadata.totalTokenCount || 0
                    };
                  }
                } catch (parseErr: any) {
                  if (parseErr?.isStreamError) {
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

      const hasStreamToolCalls = Array.isArray(streamToolCalls) && streamToolCalls.length > 0;
      if (streamFinishReason === 'MAX_TOKENS' && !finalContent.trim() && !hasStreamToolCalls) {
        throw new Error(
          this.i18n.t('error.maxTokensExceeded', 'Gemini generation reached maxTokens limit (finishReason: MAX_TOKENS) without valid output. Please increase maxTokens.')
        );
      }
      if (!finalContent.trim() && !hasStreamToolCalls) {
        throw new Error(
          this.i18n.t('error.emptyResponse', 'Gemini service returned an empty response without tool calls. Please check prompt instructions or model settings.')
        );
      }

      const message: LLMMessage = {
        role: 'assistant',
        content: finalContent,
        toolCalls: streamToolCalls
      };
      if (thoughtSignature) {
        message.thoughtSignature = thoughtSignature;
      }
      return { message, usage };
    }

    const json = await response.json() as any;
    if (json.error) {
      // Gemini API 报错
      throw new Error(
        this.i18n.t('error.apiError', 'Gemini API error: {detail}', {
          detail: json.error.message || JSON.stringify(json.error)
        })
      );
    }

    if (json.promptFeedback?.blockReason) {
      // Gemini 输入安全策略拦截
      throw new Error(
        this.i18n.t('error.promptBlocked', 'Gemini prompt blocked by safety policy (blockReason: "{reason}")', {
          reason: json.promptFeedback.blockReason
        })
      );
    }

    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let textContent = '';
    const toolCalls: any[] = [];
    let thoughtSignature: string | undefined;

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 11)}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        });
      }
      const sig = part.thoughtSignature;
      if (sig) {
        thoughtSignature = sig;
      }
    }

    const hasToolCalls = toolCalls.length > 0;
    if (candidate?.finishReason === 'MAX_TOKENS' && !textContent.trim() && !hasToolCalls) {
      throw new Error(
        this.i18n.t('error.maxTokensExceeded', 'Gemini generation reached maxTokens limit (finishReason: MAX_TOKENS) without valid output. Please increase maxTokens.')
      );
    }

    if (!textContent.trim() && !hasToolCalls) {
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(
          this.i18n.t('error.generationBlocked', 'Gemini generation blocked by safety policy or empty (finishReason: "{reason}")', {
            reason: candidate.finishReason
          })
        );
      }
      throw new Error(
        this.i18n.t('error.emptyResponse', 'Gemini service returned an empty response without tool calls. Please check prompt instructions or model settings.')
      );
    }

    const message: LLMMessage = {
      role: 'assistant',
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
    if (thoughtSignature) {
      message.thoughtSignature = thoughtSignature;
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
