import type { FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import {
  CancelSubagentTool,
  ListSessionsTool,
  SpawnSubagentTool,
  ViewSessionContentTool,
  ViewSessionInfoTool,
  ViewSessionSnapshotTool
} from './tools.js';

export class SessionToolbox implements FreyaToolbox {
  private tools: FreyaTool[] = [];
  private spawnTool: SpawnSubagentTool;
  private cancelTool: CancelSubagentTool;

  constructor(private sessionManager: FreyaSessionManager) {
    this.spawnTool = new SpawnSubagentTool(this.sessionManager);
    this.cancelTool = new CancelSubagentTool(this.sessionManager);
    this.tools = [
      new ListSessionsTool(this.sessionManager),
      new ViewSessionInfoTool(this.sessionManager),
      new ViewSessionContentTool(this.sessionManager),
      new ViewSessionSnapshotTool(this.sessionManager),
      this.spawnTool,
      this.cancelTool
    ];
  }

  setAgentService(agentService: FreyaAgentService): void {
    this.spawnTool.setAgentService(agentService);
    this.cancelTool.setAgentService(agentService);
  }

  getId(): string {
    return 'session';
  }

  getInstructionPrompt(): string {
    return 'tool.prompt.session';
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }
}

export default SessionToolbox;
