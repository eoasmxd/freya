import type { FreyaContext, FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { Session } from '../session/types.js';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { FreyaSessionManager } from '../session/session-manager.js';
import type { FreyaConfigManager } from '../config/config-manager.js';
import type { FreyaSkillRegistry } from '../skill/skill-registry.js';
import type { FreyaAgentService } from '../agent/agent-service.js';
import { ConfigToolbox } from './config/index.js';
import { AgentToolbox } from './agent/index.js';
import { createMetaTools } from './intrinsic/meta-tools.js';
import { ReadSnapshotTool } from './intrinsic/snapshot-tool.js';

/**
 * 内核固有工具注册条目
 * Core intrinsic tool registration entry
 */
export interface IntrinsicToolEntry {
  tool: FreyaTool;
  isVisible?: (session?: Session) => boolean;
}

/**
 * 内核工具注册表
 * Kernel tool registry
 * 统一聚合内核固有工具、内置工具箱与来自插件体系的外部工具箱
 * Aggregates core intrinsic tools, built-in toolboxes, and external plugin toolboxes
 */
export class FreyaToolRegistry {
  private toolboxes: FreyaToolbox[] = [];
  private intrinsicTools: IntrinsicToolEntry[] = [];
  private agentToolbox?: AgentToolbox;

  constructor(private context?: FreyaContext) { }

  setContext(context: FreyaContext): void {
    this.context = context;
  }

  /**
   * 初始化并装配所有内核内置工具（业务工具箱、固有常驻工具及快照工具）
   * Initialize and register all kernel built-in tools
   */
  registerBuiltinTools(params: {
    sessionManager: FreyaSessionManager;
    configManager: FreyaConfigManager;
    skillRegistry: FreyaSkillRegistry;
  }): void {
    if (this.context) {
      this.registerToolbox(new ConfigToolbox(params.configManager, this.context));
    }
    this.agentToolbox = new AgentToolbox(params.sessionManager, this.context);
    this.registerToolbox(this.agentToolbox);

    for (const tool of createMetaTools(params.sessionManager, this, params.skillRegistry)) {
      this.registerIntrinsicTool(tool);
    }

    this.registerIntrinsicTool(
      new ReadSnapshotTool(params.sessionManager),
      (session) => !!session?.lastSnapshotId
    );
  }

  /**
   * 为子智能体工具箱绑定 Agent 调度核心服务
   * Bind AgentService instance to AgentToolbox
   */
  setAgentService(agentService: FreyaAgentService): void {
    this.agentToolbox?.setAgentService(agentService);
  }

  /**
   * 注册内核固有工具（常驻或条件常驻）
   * Register core intrinsic tool (persistent or conditionally persistent)
   */
  registerIntrinsicTool(tool: FreyaTool, isVisible?: (session?: any) => boolean): void {
    const name = tool.getDefinition().name;
    const existingIndex = this.intrinsicTools.findIndex(
      (entry) => entry.tool.getDefinition().name === name
    );

    if (existingIndex > -1) {
      this.intrinsicTools[existingIndex] = { tool, isVisible };
    } else {
      this.intrinsicTools.push({ tool, isVisible });
    }
  }

  /**
   * 判断指定工具箱当前是否已注册且处于可用启用状态
   * Determine whether specified toolbox is registered and enabled
   */
  isToolboxEnabled(toolboxId: string, session?: Session): boolean {
    if (session?.parentId && toolboxId === 'agent') {
      return false;
    }

    const isRegistered = this.toolboxes.some((tb) => tb.getId() === toolboxId);
    if (!isRegistered) {
      return false;
    }

    const toolsConfig = (this.context?.config as any)?.tools?.builtin;
    if (toolsConfig && typeof toolsConfig[toolboxId]?.enabled === 'boolean') {
      return toolsConfig[toolboxId].enabled;
    }

    return true;
  }

  /**
   * 注册工具箱
   * Register toolbox
   */
  registerToolbox(toolbox: FreyaToolbox): void {
    const newId = toolbox.getId();
    const existingIndex = this.toolboxes.findIndex((tb) => tb.getId() === newId || tb === toolbox);

    if (existingIndex > -1) {
      this.toolboxes[existingIndex] = toolbox;
    } else {
      this.toolboxes.push(toolbox);
    }
  }

  /**
   * 注销工具箱
   * Unregister toolbox
   */
  unregisterToolbox(id: string): void {
    this.toolboxes = this.toolboxes.filter((tb) => tb.getId() !== id);
  }

  /**
   * 获取指定 ID 的工具箱中的所有原子工具
   * Get all atomic tools in toolbox with specified ID
   */
  getToolsInBox(id: string): FreyaTool[] {
    if (!this.isToolboxEnabled(id)) {
      return [];
    }
    const tb = this.toolboxes.find((t) => t.getId() === id);
    return tb ? tb.getTools() : [];
  }

  /**
   * 聚合所有来源的已启用工具
   * Aggregate all enabled tools from all sources
   */
  getAllTools(): Map<string, FreyaTool> {
    const tools = new Map<string, FreyaTool>();

    for (const entry of this.intrinsicTools) {
      tools.set(entry.tool.getDefinition().name, entry.tool);
    }

    for (const toolbox of this.toolboxes) {
      if (!this.isToolboxEnabled(toolbox.getId())) {
        continue;
      }
      for (const tool of toolbox.getTools()) {
        tools.set(tool.getDefinition().name, tool);
      }
    }
    return tools;
  }

  /**
   * 根据当前会话与已激活的工具箱列表，过滤获取所需的工具字典
   * Filter and retrieve required tools dictionary based on current session and active toolboxes
   */
  getFilteredTools(activeToolboxIds: string[], session?: Session): Map<string, FreyaTool> {
    const activeSet = new Set(activeToolboxIds || []);
    const tools = new Map<string, FreyaTool>();

    for (const entry of this.intrinsicTools) {
      if (!entry.isVisible || entry.isVisible(session)) {
        tools.set(entry.tool.getDefinition().name, entry.tool);
      }
    }

    for (const toolbox of this.toolboxes) {
      const toolboxId = toolbox.getId();
      if (!this.isToolboxEnabled(toolboxId, session)) {
        continue;
      }
      if (activeSet.has(toolboxId)) {
        for (const tool of toolbox.getTools()) {
          const toolName = tool.getDefinition().name;
          if (tools.has(toolName)) {
            this.context?.logger.warn(
              `[ToolRegistry] Tool name collision detected for "${toolName}" in toolbox "${toolboxId}". Overwrite prevented.`
            );
            continue;
          }
          tools.set(toolName, tool);
        }
      }
    }
    return tools;
  }

  /**
   * 聚合所有已启用的工具提示词引导说明
   * Aggregate instruction prompt guides for all enabled toolboxes
   */
  getToolInstructions(promptRegistry: FreyaPromptRegistry, session?: Session): string[] {
    const instructions: string[] = [];

    const metaPrompt = promptRegistry.get('tool.prompt.meta');
    if (metaPrompt) {
      instructions.push(`### Core Meta Capabilities\n${metaPrompt}`);
    }

    for (const toolbox of this.toolboxes) {
      const toolboxId = toolbox.getId();
      if (!this.isToolboxEnabled(toolboxId, session)) {
        continue;
      }
      const key = toolbox.getInstructionPrompt?.();
      if (!key) continue;

      const resolved = promptRegistry.get(key);
      if (resolved) {
        instructions.push(`### Toolbox Capabilities [ID: "${toolboxId}"]\n${resolved}`);
      }
    }
    return instructions;
  }

  getRegisteredToolboxIds(session?: Session): string[] {
    return this.toolboxes
      .map((tb) => tb.getId())
      .filter((id) => this.isToolboxEnabled(id, session));
  }
}
