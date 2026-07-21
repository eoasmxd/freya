import type { LLMMessage, FreyaContext, LLMOptions } from '@eoasmxd/freya-sdk';
import { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { FreyaSessionManager } from '../session/session-manager.js';
import type { FreyaSkillRegistry } from '../skill/skill-registry.js';
import type { FreyaToolRegistry } from '../tools/tool-registry.js';

export interface FreyaAgentExecutorOptions extends LLMOptions {
  maxTurns?: number;
}

export class FreyaAgentExecutor {
  private llmPlugin: any;

  constructor(
    private context: FreyaContext,
    private promptRegistry: FreyaPromptRegistry,
    private sessionManager: FreyaSessionManager,
    private toolRegistry: FreyaToolRegistry,
    private skillRegistry: FreyaSkillRegistry
  ) {
    this.llmPlugin = context.llm;
  }

  async run(
    sessionId: string,
    options?: FreyaAgentExecutorOptions,
  ): Promise<LLMMessage> {
    const toolInstructions = this.toolRegistry.getToolInstructions(this.promptRegistry);
    const skills = Array.from(this.skillRegistry.getSkills().values());

    const signal = options?.signal;
    let loop = true;
    let turnCount = 0;
    let lastLlmMessage: LLMMessage | null = null;
    let systemPrompt = '';

    while (loop) {
      const session = await this.sessionManager.getOrCreate(sessionId);
      const tools = this.toolRegistry.getFilteredTools(session.activeToolboxIds || []);
      const history = await this.sessionManager.getHistory(sessionId);

      if (signal?.aborted) {
        throw new Error('对话运行已被用户主动中断。');
      }

      const activeSkill = skills.find((s) => s.id === session.activeSkillId);
      systemPrompt = this.promptRegistry.composeSystemPrompt(activeSkill, toolInstructions, skills);

      const maxTurns = options?.maxTurns ?? 20;
      if (turnCount++ >= maxTurns) {
        this.context.logger.warn(`会话 ${sessionId} 超出最大迭代决策轮数 (${maxTurns})，正在生成最终总结...`);
        const finalPayload: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history,
          {
            role: 'system',
            content: this.promptRegistry.get('core.prompt.max_turns') || '已达到最大决策轮数上限，请基于已完成的工作向用户总结当前进展。'
          }
        ];
        const finalResponse = await this.llmPlugin.chat(finalPayload, undefined, {
          ...options,
          providerId: session.providerId || options?.providerId,
          modelId: session.modelId || options?.modelId,
          billingContext: { ownerType: 'session', ownerId: sessionId },
          onModelSelected: (providerId: string, modelId: string) => {
            this.sessionManager.updateSession(sessionId, { providerId, modelId }).catch((err: any) => {
              this.context.logger.error(`[FreyaAgentExecutor] 异步更新会话模型失败:`, err);
            });
          }
        });
        lastLlmMessage = finalResponse.message;
        break;
      }

      const activePayload: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history
      ];

      const toolDefinitions = Array.from(tools.values()).map((t) => t.getDefinition());

      const response = await this.llmPlugin.chat(activePayload, toolDefinitions, {
        ...options,
        providerId: session.providerId || options?.providerId,
        modelId: session.modelId || options?.modelId,
        billingContext: { ownerType: 'session', ownerId: sessionId },
        onModelSelected: (providerId: string, modelId: string) => {
          this.sessionManager.updateSession(sessionId, { providerId, modelId }).catch((err: any) => {
            this.context.logger.error(`[FreyaAgentExecutor] 异步更新会话模型失败:`, err);
          });
        }
      });
      const replyMessage = response.message;
      lastLlmMessage = replyMessage;

      if (replyMessage.toolCalls && replyMessage.toolCalls.length > 0) {
        await this.sessionManager.appendMessage(sessionId, replyMessage);
        const toolPromises = replyMessage.toolCalls.map(async (toolCall: any) => {
          const tool = tools.get(toolCall.name);
          if (!tool) {
            this.context.logger.warn(`未注册的工具指令: ${toolCall.name}`);
            return {
              role: 'tool' as const,
              content: `Error: Tool "${toolCall.name}" not found.`,
              toolCallId: toolCall.id
            };
          }

          let args: any;
          try {
            args = JSON.parse(toolCall.arguments);
          } catch (parseErr: any) {
            this.context.logger.error(`[FreyaAgentExecutor] 解析工具参数失败: ${toolCall.arguments}`, parseErr);
            this.context.eventBus.emit('tool:status', {
              sessionId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: 'failed',
              arguments: {},
              result: `JSON 解析失败: ${parseErr.message}`
            });
            return {
              role: 'tool' as const,
              content: `Error during JSON parsing: ${parseErr.message}`,
              toolCallId: toolCall.id
            };
          }

          args.__sessionId = sessionId;
          this.context.eventBus.emit('tool:status', {
            sessionId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            status: 'running',
            arguments: args
          });

          try {
            const result = await tool.execute(args, this.context);
            this.context.eventBus.emit('tool:status', {
              sessionId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: 'completed',
              arguments: args,
              result
            });
            return {
              role: 'tool' as const,
              content: result,
              toolCallId: toolCall.id
            };
          } catch (err: any) {
            this.context.eventBus.emit('tool:status', {
              sessionId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: 'failed',
              arguments: args,
              result: err.message || '运行失败'
            });
            return {
              role: 'tool' as const,
              content: `Error during execution: ${err.message}`,
              toolCallId: toolCall.id
            };
          }
        });

        const toolResults = await Promise.all(toolPromises);
        await this.sessionManager.appendMessages(sessionId, toolResults);
      } else {
        loop = false;
      }
    }

    if (!lastLlmMessage) {
      throw new Error('无法获得合法的模型响应结果。');
    }

    await this.sessionManager.appendMessage(sessionId, lastLlmMessage);
    return lastLlmMessage;
  }
}
