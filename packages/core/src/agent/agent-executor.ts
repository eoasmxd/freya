import type { LLMMessage, FreyaContext, LLMOptions } from '@eoasmxd/freya-sdk';
import { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { FreyaSessionManager } from '../session/session-manager.js';
import type { FreyaSkillRegistry } from '../skill/skill-registry.js';
import type { FreyaToolRegistry } from '../tools/tool-registry.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

export interface FreyaAgentExecutorOptions extends LLMOptions {
  maxTurns?: number;
}

/**
 * 智能体执行引擎，编排多轮 ReAct 工具调用与自主循环
 * Agent execution engine, orchestrating multi-turn ReAct tool calls and autonomous loops
 */
export class FreyaAgentExecutor {
  private llmPlugin: any;
  private readonly i18n: I18n;

  constructor(
    private context: FreyaContext,
    private promptRegistry: FreyaPromptRegistry,
    private sessionManager: FreyaSessionManager,
    private toolRegistry: FreyaToolRegistry,
    private skillRegistry: FreyaSkillRegistry
  ) {
    this.llmPlugin = context.llm;
    this.i18n = new I18n({ zh, en }, context);
  }

  /**
   * 启动智能体针对指定会话的 ReAct 执行循环
   * Start the agent ReAct execution loop for the specified session
   */
  async run(
    sessionId: string,
    options?: FreyaAgentExecutorOptions,
  ): Promise<LLMMessage> {
    const skills = Array.from(this.skillRegistry.getSkills().values());
    const executedToolNames = new Set<string>();

    const signal = options?.signal;
    let loop = true;
    let turnCount = 0;
    let lastLlmMessage: LLMMessage | null = null;
    let systemPrompt = '';

    while (loop) {
      const session = await this.sessionManager.getOrCreate(sessionId);
      const tools = this.toolRegistry.getFilteredTools(session.activeToolboxIds || [], session);
      const toolInstructions = this.toolRegistry.getToolInstructions(this.promptRegistry, session);
      const history = await this.sessionManager.getHistory(sessionId);

      if (signal?.aborted) {
        throw new Error(this.i18n.t('agent.error.aborted', 'Chat generation was aborted by user.'));
      }

      const activeSkill = skills.find((s) => s.id === session.activeSkillId);
      systemPrompt = this.promptRegistry.composeSystemPrompt(activeSkill, toolInstructions, skills);

      const maxTurns = options?.maxTurns ?? 20;
      if (turnCount++ >= maxTurns) {
        this.context.logger.warn(`Session ${sessionId} exceeded maximum iterations (${maxTurns}), generating final summary...`);
        const finalPayload: LLMMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history,
          {
            role: 'system',
            content: this.promptRegistry.get('core.prompt.max_turns')
          }
        ];
        const finalResponse = await this.llmPlugin.chat(finalPayload, undefined, {
          ...options,
          providerId: session.providerId || options?.providerId,
          modelId: session.modelId || options?.modelId,
          billingContext: { ownerType: 'session', ownerId: sessionId },
          onModelSelected: (providerId: string, modelId: string) => {
            this.sessionManager.updateSession(sessionId, { providerId, modelId }).catch((err: any) => {
              this.context.logger.error('[FreyaAgentExecutor] Failed to update session model asynchronously:', err);
            });
          }
        });
        const msg = finalResponse.message;
        msg.timestamp = Date.now();
        lastLlmMessage = msg;
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
            this.context.logger.error('[FreyaAgentExecutor] Failed to update session model asynchronously:', err);
          });
        }
      });
      const replyMessage = response.message;
      replyMessage.timestamp = Date.now();
      lastLlmMessage = replyMessage;

      if (replyMessage.toolCalls && replyMessage.toolCalls.length > 0) {
        for (const tc of replyMessage.toolCalls) {
          executedToolNames.add(tc.name);
        }
        await this.sessionManager.appendMessage(sessionId, replyMessage);
        const toolPromises = replyMessage.toolCalls.map(async (toolCall: any) => {
          const tool = tools.get(toolCall.name);
          if (!tool) {
            this.context.logger.warn(`Unregistered tool call: ${toolCall.name}`);
            return {
              role: 'tool' as const,
              content: `Error: Tool "${toolCall.name}" not found.`,
              toolCallId: toolCall.id,
              toolName: toolCall.name
            };
          }

          let args: any;
          try {
            args = JSON.parse(toolCall.arguments);
          } catch (parseErr: any) {
            this.context.logger.error(`[FreyaAgentExecutor] Failed to parse tool arguments: ${toolCall.arguments}`, parseErr);
            this.context.eventBus.emit('tool:status', {
              sessionId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: 'failed',
              arguments: {},
              result: this.i18n.t('agent.error.jsonParseFailed', 'JSON parsing failed: {message}', {
                message: parseErr.message
              })
            });
            return {
              role: 'tool' as const,
              content: `Error during JSON parsing: ${parseErr.message}`,
              toolCallId: toolCall.id,
              toolName: toolCall.name
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
            const result = await tool.execute(args);
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
              toolCallId: toolCall.id,
              toolName: toolCall.name
            };
          } catch (err: any) {
            this.context.eventBus.emit('tool:status', {
              sessionId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: 'failed',
              arguments: args,
              result: err.message || this.i18n.t('agent.error.executionFailed', 'Execution failed')
            });
            return {
              role: 'tool' as const,
              content: `Error during execution: ${err.message}`,
              toolCallId: toolCall.id,
              toolName: toolCall.name
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
      throw new Error(this.i18n.t('agent.error.noValidResponse', 'Failed to obtain a valid model response.'));
    }

    await this.evaluateAndDeactivateIdleToolboxes(sessionId, executedToolNames);
    await this.sessionManager.appendMessage(sessionId, lastLlmMessage);
    return lastLlmMessage;
  }

  /**
   * 评估并自动卸载连续闲置超过设定阈值轮数的工具箱。
   * Evaluate and automatically deactivate toolboxes idle for more than configured threshold rounds.
   */
  private async evaluateAndDeactivateIdleToolboxes(
    sessionId: string,
    executedToolNames: Set<string>
  ): Promise<void> {
    const session = await this.sessionManager.getOrCreate(sessionId);
    const activeToolboxIds = session.activeToolboxIds || [];
    if (activeToolboxIds.length === 0) {
      return;
    }

    const config = this.context.config.contextManagement || {};
    const threshold = config.toolboxIdleTimeoutRounds ?? 10;
    const toolboxIdleRounds = session.toolboxIdleRounds || {};

    const nextActiveToolboxIds: string[] = [];
    const nextToolboxIdleRounds: Record<string, number> = {};
    const deactivatedIds: string[] = [];

    for (const id of activeToolboxIds) {
      if (!this.toolRegistry.isToolboxEnabled(id)) {
        deactivatedIds.push(id);
        this.context.logger.info(`[FreyaAgentExecutor] Toolbox [${id}] is globally disabled, automatically unmounted from session.`);
        continue;
      }
      const boxTools = this.toolRegistry.getToolsInBox(id);
      const isUsed = boxTools.some((tool) => executedToolNames.has(tool.getDefinition().name));

      if (isUsed) {
        nextToolboxIdleRounds[id] = 0;
        nextActiveToolboxIds.push(id);
      } else {
        const idleCount = (toolboxIdleRounds[id] ?? 0) + 1;
        if (idleCount >= threshold) {
          deactivatedIds.push(id);
          this.context.logger.info(`[FreyaAgentExecutor] Toolbox [${id}] idle for ${idleCount} rounds, automatically unmounted.`);
        } else {
          nextToolboxIdleRounds[id] = idleCount;
          nextActiveToolboxIds.push(id);
        }
      }
    }

    if (deactivatedIds.length > 0) {
      await this.sessionManager.updateSession(sessionId, {
        activeToolboxIds: nextActiveToolboxIds,
        toolboxIdleRounds: nextToolboxIdleRounds
      });
    } else {
      await this.sessionManager.updateSession(sessionId, {
        toolboxIdleRounds: nextToolboxIdleRounds
      });
    }
  }
}
