import type { FreyaContext, FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import { DelegateTaskTool, AgentChatTool } from './tools.js';

/**
 * 智能体委派与推理工具箱
 * Agent delegation and direct chat toolbox
 */
export class AgentToolbox implements FreyaToolbox {
  private delegateTool: DelegateTaskTool;
  private chatTool: AgentChatTool;
  private tools: FreyaTool[] = [];

  constructor(
    private sessionManager: FreyaSessionManager,
    ctx?: FreyaContext
  ) {
    this.delegateTool = new DelegateTaskTool(this.sessionManager, ctx);
    this.chatTool = new AgentChatTool(this.sessionManager, ctx);
    this.tools = [this.delegateTool, this.chatTool];
  }

  setAgentService(agentService: FreyaAgentService): void {
    this.delegateTool.setAgentService(agentService);
  }

  getId(): string {
    return 'agent';
  }

  getInstructionPrompt(): string {
    return 'tool.prompt.agent';
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }
}

export default AgentToolbox;
