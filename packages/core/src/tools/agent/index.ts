import type { FreyaContext, FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import { AgentDelegateTaskTool } from './tools.js';

/**
 * 智能体委派工具箱
 * Agent delegation toolbox
 */
export class AgentToolbox implements FreyaToolbox {
  private delegateTool: AgentDelegateTaskTool;
  private tools: FreyaTool[] = [];

  constructor(
    private sessionManager: FreyaSessionManager,
    ctx?: FreyaContext
  ) {
    this.delegateTool = new AgentDelegateTaskTool(this.sessionManager, ctx);
    this.tools = [this.delegateTool];
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
