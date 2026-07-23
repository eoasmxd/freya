import type { ChannelMessage, ILLMService, LLMMessage } from '@eoasmxd/freya-sdk';
import type { FreyaAgentExecutor } from './agent-executor.js';
import { FreyaCommandExecutor } from '../command/command-executor.js';
import type { DefaultFreyaContext } from '../context.js';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import { FreyaSessionManager } from '../session/session-manager.js';
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
          this.sessionManager.updateSession(subSessionId, { status: 'failed', durationMs: 0 }).catch(() => {});
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

      let audioAppend = '';
      let imageResult = { text: '', multimodalAttachments: imageAttachments };

      let prevUserText = '';
      if (session.history && session.history.length > 0) {
        for (let i = session.history.length - 1; i >= 0; i--) {
          if (session.history[i].role === 'user') {
            prevUserText = session.history[i].content || '';
            break;
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
          preprocessAudio(attachments, '', this.context, this.promptRegistry, preprocessContext).then((txt) => {
            audioAppend = txt;
          })
        );
      }
      if (!hasImageCapability && imageAttachments.length > 0) {
        preprocessors.push(
          preprocessImages(attachments, '', this.context, this.promptRegistry, preprocessContext).then((res) => {
            imageResult = res;
          })
        );
      }

      await Promise.all(preprocessors);

      if (audioAppend) {
        userText = `${userText}\n${audioAppend}`.trim();
      }
      if (imageResult.text) {
        userText = `${userText}\n${imageResult.text}`.trim();
      }

      const controller = new AbortController();
      this.abortControllers.set(message.sessionId, controller);

      const userMsg: LLMMessage = { role: 'user', content: userText };
      if (imageResult.multimodalAttachments.length > 0) {
        userMsg.attachments = imageResult.multimodalAttachments;
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
      this.sessionManager.updateSession(childSessionId, { status: 'failed', durationMs: 0 }).catch(() => {});
      return `ℹ️ 子智能体会话 ${childSessionId} 中止成功。`;
    } else {
      throw new Error(`未找到活跃的子智能体会话 ID: ${childSessionId}，或它已执行结束。`);
    }
  }
}
