import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';

/**
 * 委派独立子智能体任务工具
 * Delegate independent subagent task tool
 */
export class AgentDelegateTaskTool implements FreyaTool {
  private agentService?: FreyaAgentService;

  constructor(
    private sessionManager: FreyaSessionManager,
    private ctx?: FreyaContext
  ) { }

  setAgentService(agentService: FreyaAgentService): void {
    this.agentService = agentService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'agent_delegate_task',
      description: 'Delegate a complex or isolated subtask to an independent subagent. The subagent runs its own sense-plan-act loop and synchronously returns the final result text upon completion.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed prompt description dispatched to the subtask (e.g. "Research and compile latest trends in LLM technologies")'
          },
          providerId: {
            type: 'string',
            description: 'Provider ID for subtask model (optional, use config_list_provider to get valid IDs)'
          },
          modelId: {
            type: 'string',
            description: 'Model ID for subtask (optional, use config_list_model to get valid IDs)'
          }
        },
        required: ['prompt']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.prompt) {
      return '❌ Parameter error: Detailed prompt description for subtask must be provided.';
    }
    if (!this.agentService) {
      throw new Error('AgentService has not been injected yet, cannot delegate task.');
    }

    const parentSessionId = args.__sessionId || 'unknown_parent';
    const childSessionId = `${parentSessionId}_sub_${Date.now()}`;

    this.ctx?.logger.info(`[AgentTool] Delegating task to subagent: parent "${parentSessionId}" -> child "${childSessionId}"`);
    return await this.agentService.runSubAgent(parentSessionId, childSessionId, args.prompt, args);
  }
}
