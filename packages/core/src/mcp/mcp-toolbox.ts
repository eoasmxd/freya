import type { FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { Session } from '../session/types.js';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { McpBridgedTool } from './mcp-tool.js';
import { McpNaming } from './mcp-naming.js';

const MAX_ACTIVE_INSTRUCTIONS_LENGTH = 2000;

/**
 * MCP 远程服务桥接工具箱
 * Bridged toolbox representing a remote MCP service
 */
export class McpToolbox implements FreyaToolbox {
  readonly __isMcpToolbox = true;
  private tools: McpBridgedTool[] = [];
  private description?: string;
  private instructions?: string;

  constructor(
    private readonly serverId: string,
    private readonly toolboxId: string
  ) {}

  getId(): string {
    return this.toolboxId;
  }

  getServerId(): string {
    return this.serverId;
  }

  setTools(tools: McpBridgedTool[]): void {
    this.tools = tools;
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }

  setDescription(desc?: string): void {
    this.description = desc;
  }

  setInstructions(instructions?: string): void {
    this.instructions = instructions;
  }

  /**
   * 生成动态工具箱提示词
   * Generate dynamic toolbox instruction prompt
   */
  getInstructionText(session?: Session, promptRegistry?: FreyaPromptRegistry): string {
    const isActive = session?.activeToolboxIds?.includes(this.toolboxId);
    const prefix = McpNaming.getToolPrefix(this.serverId);
    const desc = this.description || '';

    let instructionsBlock = '';
    if (isActive && this.instructions) {
      const truncated = this.instructions.length > MAX_ACTIVE_INSTRUCTIONS_LENGTH
        ? `${this.instructions.slice(0, MAX_ACTIVE_INSTRUCTIONS_LENGTH)}\n...[Instructions truncated]`
        : this.instructions;
      instructionsBlock = `\n#### Remote Instructions\n${truncated}\n`;
    }

    const template = promptRegistry?.get('core.prompt.mcp_toolbox') || '';

    return template
      .replace('{serverId}', () => this.serverId)
      .replace(/{prefix}/g, () => prefix)
      .replace('{description}', () => desc)
      .replace('{instructionsBlock}', () => instructionsBlock)
      .trim();
  }
}
