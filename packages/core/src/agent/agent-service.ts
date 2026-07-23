import type { ChannelMessage, ILLMService, LLMMessage } from '@eoasmxd/freya-sdk';
import { FreyaCommandExecutor } from '../command/command-executor.js';
import type { DefaultFreyaContext } from '../context.js';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import { FreyaSessionManager } from '../session/session-manager.js';
import type { FreyaAgentExecutor } from './agent-executor.js';
import { preprocessAudio, preprocessImages } from './agent-preprocessor.js';

export class FreyaAgentService {
  private abortControllers = new Map<string, AbortController>();
  private llm: ILLMService;

  constructor(
    private context: DefaultFreyaContext,
    private agentExecutor: FreyaAgentExecutor,
    private commandExecutor: FreyaCommandExecutor,
    private sessionManager: FreyaSessionManager,
    private promptRegistry: FreyaPromptRegistry
  ) {
    this.llm = context.llm;
    this.setupListeners();
  }

  private setupListeners(): void {
    this.context.eventBus.on('session:input', async (message: ChannelMessage) => {
      this.run(message).catch((err) => {
        this.context.logger.error('AgentService 发生未捕获异常:', err);
      });
    });

    this.context.eventBus.on('session:interrupt', (payload: { sessionId: string }) => {
      const controller = this.abortControllers.get(payload.sessionId);
      if (controller) {
        controller.abort();
        this.context.logger.warn(`[AgentService] 已打断会话 ${payload.sessionId} 的生成流。`);
        this.abortControllers.delete(payload.sessionId);
      }

      for (const [key, childCtrl] of this.abortControllers.entries()) {
        if (key.startsWith(`${payload.sessionId}_sub_`)) {
          childCtrl.abort();
          this.abortControllers.delete(key);
          const subSessionId = key.substring(`${payload.sessionId}_sub_`.length);
          this.sessionManager.updateSession(subSessionId, { status: 'failed', durationMs: 0 }).catch(() => { });
          this.context.logger.warn(`[AgentService] 已级联打断子智能体会话 ${subSessionId}`);
        }
      }
    });
  }

  async run(message: ChannelMessage): Promise<void> {
    if (this.abortControllers.has(message.sessionId)) {
      this.context.logger.warn(`[AgentService] 拒绝并发请求：会话 ${message.sessionId} 正在生成中。`);
      this.context.eventBus.emit('session:reply:error', {
        sessionId: message.sessionId,
        message: '⚠️ 【会话繁忙】智能体正在思考或回复中，请稍后再试。'
      });
      this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
      return;
    }

    let partialResponse = '';

    try {
      const session = await this.sessionManager.getOrCreate(message.sessionId);

      const isCommandIntercepted = await this.commandExecutor.executeLine(
        message.content,
        message.sessionId,
        message.connectionId
      );
      if (isCommandIntercepted) {
        this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
        return;
      }

      let userText = message.content;
      const attachments = message.attachments || [];

      const capabilities = (session.modelId && typeof this.llm.getModelCapabilities === 'function')
        ? this.llm.getModelCapabilities(session.modelId, session.providerId)
        : [];
      const hasImageCapability = capabilities.includes('image');
      const hasAudioCapability = capabilities.includes('audio');

      const imageAttachments = attachments.filter((a) => a.mimeType.startsWith('image/') || a.type === 'image');
      const audioAttachments = attachments.filter(
        (a) =>
          a.mimeType.startsWith('audio/') ||
          (a.type === 'file' &&
            (a.mimeType.includes('wav') || a.mimeType.includes('mp3') || a.mimeType.includes('m4a')))
      );

      const now = Date.now();
      const TEN_MINUTES_MS = 10 * 60 * 1000;
      const hasNewMedia = imageAttachments.length > 0 || audioAttachments.length > 0;
      let prevUserText = '';

      if (hasNewMedia) {
        if (session.history && session.history.length > 0) {
          for (let i = session.history.length - 1; i >= 0; i--) {
            const histMsg = session.history[i];
            if (histMsg.timestamp === undefined || (now - histMsg.timestamp >= TEN_MINUTES_MS)) {
              break;
            }
            if (histMsg.role === 'user' && histMsg.content && histMsg.content.trim() !== '') {
              prevUserText = histMsg.content;
              break;
            }
          }
        }
      } else {
        const currentText = message.content;
        if (currentText && currentText.trim() !== '') {
          const recentMediaMessages: LLMMessage[] = [];
          let prevText = '';
          if (session.history && session.history.length > 0) {
            for (let i = session.history.length - 1; i >= 0; i--) {
              const histMsg = session.history[i];
              if (histMsg.timestamp === undefined || (now - histMsg.timestamp >= TEN_MINUTES_MS)) {
                break;
              }

              const isUser = histMsg.role === 'user';
              const hasImage = histMsg.attachments?.some((a) => a.mimeType.startsWith('image/'));
              const hasAudio = histMsg.attachments?.some(
                (a) =>
                  a.mimeType.startsWith('audio/') ||
                  (a.type === 'file' &&
                    (a.mimeType.includes('wav') || a.mimeType.includes('mp3') || a.mimeType.includes('m4a')))
              );
              const hasMedia = hasImage || hasAudio;
              const hasText = histMsg.content && histMsg.content.trim() !== '';

              if (isUser && hasText) {
                prevText = histMsg.content;
                break;
              }

              if (isUser && hasMedia) {
                recentMediaMessages.push(histMsg);
              }
            }
          }

          if (recentMediaMessages.length > 0) {
            this.context.logger.info(`检测到 10 分钟内存在 ${recentMediaMessages.length} 条历史媒体消息，触发二次归纳优化描述...`);
            const secondaryContext = {
              prevUserText: prevText,
              currentUserText: currentText
            };
            for (const msg of recentMediaMessages) {
              if (msg.attachments) {
                const msgImages = msg.attachments.filter((a) => a.mimeType.startsWith('image/'));
                const msgAudios = msg.attachments.filter(
                  (a) =>
                    a.mimeType.startsWith('audio/') ||
                    (a.type === 'file' &&
                      (a.mimeType.includes('wav') || a.mimeType.includes('mp3') || a.mimeType.includes('m4a')))
                );

                if (msgImages.length > 0) {
                  await preprocessImages(msg.attachments, '', this.context, this.promptRegistry, secondaryContext);
                }
                if (msgAudios.length > 0) {
                  await preprocessAudio(msg.attachments, '', this.context, this.promptRegistry, secondaryContext);
                }
              }
            }
            await this.sessionManager.updateSession(message.sessionId, {});
          }
        }
      }

      const preprocessContext = {
        prevUserText,
        currentUserText: message.content
      };

      const preprocessors: Promise<any>[] = [];
      if (!hasAudioCapability && audioAttachments.length > 0) {
        preprocessors.push(
          preprocessAudio(attachments, '', this.context, this.promptRegistry, preprocessContext)
        );
      }
      if (!hasImageCapability && imageAttachments.length > 0) {
        preprocessors.push(
          preprocessImages(attachments, '', this.context, this.promptRegistry, preprocessContext)
        );
      }

      await Promise.all(preprocessors);

      const controller = new AbortController();
      this.abortControllers.set(message.sessionId, controller);

      const userMsg: LLMMessage = { role: 'user', content: userText, timestamp: Date.now() };
      if (attachments.length > 0) {
        userMsg.attachments = attachments;
      }
      await this.sessionManager.appendMessage(message.sessionId, userMsg);

      const response = await this.agentExecutor.run(
        message.sessionId,
        {
          signal: controller.signal,
          onChunk: (deltaText) => {
            partialResponse += deltaText;
            this.context.eventBus.emit('session:reply:delta', { sessionId: message.sessionId, text: deltaText });
          }
        },
      );

      this.abortControllers.delete(message.sessionId);

      this.context.eventBus.emit('session:reply:text', { sessionId: message.sessionId, content: response.content });
      this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
    } catch (err: any) {
      this.abortControllers.delete(message.sessionId);
      if (err.name === 'AbortError') {
        this.context.logger.warn(`会话 ${message.sessionId} 因用户取消已中止生成流。`);
        if (partialResponse.trim()) {
          await this.sessionManager.appendMessage(message.sessionId, {
            role: 'assistant',
            content: `${partialResponse}\n\n*(已中止)*`
          });
        }
        this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
      } else {
        this.context.logger.error('执行对话流处理出错:', err);
        this.context.eventBus.emit('session:reply:error', { sessionId: message.sessionId, message: `❌ 【内核执行出错】${err.message || '未知故障'}` });
        this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
      }
    }
  }

  async runSubAgent(
    parentSessionId: string,
    childSessionId: string,
    prompt: string,
    options?: { providerId?: string; modelId?: string }
  ): Promise<string> {
    const ctrl = new AbortController();
    const key = `${parentSessionId}_sub_${childSessionId}`;
    this.abortControllers.set(key, ctrl);

    const startTime = Date.now();
    try {
      await this.sessionManager.createSession(childSessionId, { parentId: parentSessionId, prompt });
      await this.sessionManager.appendMessage(childSessionId, { role: 'user', content: prompt });

      const replyMessage = await this.agentExecutor.run(childSessionId, {
        signal: ctrl.signal,
        providerId: options?.providerId,
        modelId: options?.modelId
      });

      const durationMs = Date.now() - startTime;
      await this.sessionManager.updateSession(childSessionId, { status: 'completed', durationMs });
      return replyMessage.content;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await this.sessionManager.updateSession(childSessionId, { status: 'failed', durationMs });
      throw err;
    } finally {
      this.abortControllers.delete(key);
    }
  }

  cancelSubAgent(childSessionId: string): string {
    let targetKey: string | null = null;
    let controller: AbortController | null = null;

    for (const [key, ctrl] of this.abortControllers.entries()) {
      if (key === childSessionId || key.endsWith(`_sub_${childSessionId}`)) {
        targetKey = key;
        controller = ctrl;
        break;
      }
    }

    if (controller && targetKey) {
      controller.abort();
      this.abortControllers.delete(targetKey);
      this.sessionManager.updateSession(childSessionId, { status: 'failed', durationMs: 0 }).catch(() => { });
      return `ℹ️ 子智能体会话 ${childSessionId} 中止成功。`;
    } else {
      throw new Error(`未找到活跃的子智能体会话 ID: ${childSessionId}，或它已执行结束。`);
    }
  }
}
