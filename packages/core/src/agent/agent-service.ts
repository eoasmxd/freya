import type { ChannelMessage, ILLMService, LLMMessage } from '@eoasmxd/freya-sdk';
import { FreyaCommandExecutor } from '../command/command-executor.js';
import { currentConnectionStorage, type DefaultFreyaContext } from '../context.js';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import { FreyaSessionManager } from '../session/session-manager.js';
import type { FreyaAgentExecutor } from './agent-executor.js';
import { preprocessAudio, preprocessImages } from './agent-preprocessor.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

export class FreyaAgentService {
  private abortControllers = new Map<string, AbortController>();
  private messageQueues = new Map<string, ChannelMessage[]>();
  private processingSessions = new Set<string>();
  private llm: ILLMService;
  private readonly i18n: I18n;

  constructor(
    private context: DefaultFreyaContext,
    private agentExecutor: FreyaAgentExecutor,
    private commandExecutor: FreyaCommandExecutor,
    private sessionManager: FreyaSessionManager,
    private promptRegistry: FreyaPromptRegistry
  ) {
    this.llm = context.llm;
    this.i18n = new I18n({ zh, en }, context);
    this.setupListeners();
  }

  private setupListeners(): void {
    this.context.eventBus.on('session:input', (message: ChannelMessage) => {
      let queue = this.messageQueues.get(message.sessionId);
      if (!queue) {
        queue = [];
        this.messageQueues.set(message.sessionId, queue);
      }
      queue.push(message);

      this.processQueue(message.sessionId).catch((err) => {
        this.context.logger.error('AgentService message queue processing error:', err);
      });
    });

    this.context.eventBus.on('session:interrupt', (payload: { sessionId: string }) => {
      this.messageQueues.delete(payload.sessionId);

      const controller = this.abortControllers.get(payload.sessionId);
      if (controller) {
        controller.abort();
        this.context.logger.warn(`[AgentService] Interrupted generation stream for session ${payload.sessionId}.`);
        this.abortControllers.delete(payload.sessionId);
      }

      for (const [key, childCtrl] of this.abortControllers.entries()) {
        if (key.startsWith(`${payload.sessionId}_sub_`)) {
          childCtrl.abort();
          this.abortControllers.delete(key);
          const subSessionId = key.substring(`${payload.sessionId}_sub_`.length);
          this.sessionManager.updateSession(subSessionId, { status: 'failed', durationMs: 0 }).catch(() => { });
          this.context.logger.warn(`[AgentService] Cascadely interrupted subagent session ${subSessionId}.`);
        }
      }
    });
  }

  private async processQueue(sessionId: string): Promise<void> {
    if (this.processingSessions.has(sessionId)) {
      return;
    }
    this.processingSessions.add(sessionId);

    try {
      while (true) {
        const queue = this.messageQueues.get(sessionId);
        if (!queue || queue.length === 0) {
          break;
        }

        const message = queue.shift()!;
        try {
          await this.run(message);
        } catch (err) {
          this.context.logger.error(`[AgentService] Error executing session ${sessionId}:`, err);
        }
      }
    } finally {
      this.processingSessions.delete(sessionId);
      this.messageQueues.delete(sessionId);
    }
  }

  async run(message: ChannelMessage): Promise<void> {
    const connInfo = {
      connectionId: message.connectionId,
      channelType: message.channelType,
      language: message.defaultLanguage || 'en'
    };
    return currentConnectionStorage.run(connInfo, () => this.executeRun(message));
  }

  private async executeRun(message: ChannelMessage): Promise<void> {
    let partialResponse = '';

    try {
      const session = await this.sessionManager.getOrCreate(message.sessionId, {
        ephemeral: message.ephemeral,
        activeToolboxIds: message.activeToolboxIds,
        activeSkillId: message.activeSkillId
      });

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
            this.context.logger.info(`Detected ${recentMediaMessages.length} historical media messages within 10 minutes, optimizing descriptions...`);
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
        this.context.logger.warn(`Session ${message.sessionId} generation aborted by user.`);
        if (partialResponse.trim()) {
          await this.sessionManager.appendMessage(message.sessionId, {
            role: 'assistant',
            // 中断标记后缀
            content: `${partialResponse}\n\n*(interrupted)*`
          });
        }
        this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
      } else {
        this.context.logger.error('Error processing chat stream:', err);
        const errDetail = err.message || 'Unknown error';
        this.context.eventBus.emit('session:reply:error', {
          sessionId: message.sessionId,
          message: this.i18n.t(
            'agent.error.kernelError',
            '❌ [Kernel Execution Error] {message}',
            { message: errDetail }
          )
        });
        this.context.eventBus.emit('session:reply:completed', { sessionId: message.sessionId });
      }
    }
  }

  /**
   * 运行子智能体会话并等待执行结果
   * Run sub-agent session and await execution result
   */
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

  /**
   * 取消指定的子智能体会话
   * Cancel specified sub-agent session
   */
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
      // 成功中止子智能体出参
      return `ℹ️ Child agent session ${childSessionId} aborted successfully.`;
    } else {
      // 未找到活跃子智能体会话异常
      throw new Error(`Active child agent session not found for ID: ${childSessionId}, or it has already completed.`);
    }
  }
}
