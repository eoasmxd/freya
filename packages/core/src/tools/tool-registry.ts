import type { FreyaContext, FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';

/**
 * 内核工具注册表。
 * 统一聚合内置工具箱与来自插件体系的外部工具箱。
 */
export class FreyaToolRegistry {
  private toolboxes: FreyaToolbox[] = [];

  constructor(private context?: FreyaContext) {}

  setContext(context: FreyaContext): void {
    this.context = context;
  }

  /** 判断指定工具箱当前是否已注册且处于可用启用状态 */
  isToolboxEnabled(toolboxId: string): boolean {
    if (toolboxId === 'meta') {
      return true;
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

  /** 注册工具箱 */
  registerToolbox(toolbox: FreyaToolbox): void {
    const newId = toolbox.getId();
    const existingIndex = this.toolboxes.findIndex((tb) => tb.getId() === newId || tb === toolbox);

    if (existingIndex > -1) {
      this.toolboxes[existingIndex] = toolbox;
    } else {
      this.toolboxes.push(toolbox);
    }
  }

  /** 注销工具箱 */
  unregisterToolbox(id: string): void {
    this.toolboxes = this.toolboxes.filter((tb) => tb.getId() !== id);
  }

  /** 获取指定 ID 的工具箱中的所有原子工具 */
  getToolsInBox(id: string): FreyaTool[] {
    if (!this.isToolboxEnabled(id)) {
      return [];
    }
    const tb = this.toolboxes.find((t) => t.getId() === id);
    return tb ? tb.getTools() : [];
  }

  /** 聚合所有来源的已启用工具 */
  getAllTools(): Map<string, FreyaTool> {
    const tools = new Map<string, FreyaTool>();
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

  /** 根据当前会话已激活的工具箱列表，过滤获取所需的工具字典 */
  getFilteredTools(activeToolboxIds: string[]): Map<string, FreyaTool> {
    const activeSet = new Set(activeToolboxIds || []);
    const tools = new Map<string, FreyaTool>();

    for (const toolbox of this.toolboxes) {
      const toolboxId = toolbox.getId();
      if (!this.isToolboxEnabled(toolboxId)) {
        continue;
      }
      if (toolboxId === 'meta' || activeSet.has(toolboxId)) {
        for (const tool of toolbox.getTools()) {
          tools.set(tool.getDefinition().name, tool);
        }
      }
    }
    return tools;
  }

  /** 聚合所有已启用的工具箱提示词引导说明 */
  getToolInstructions(promptRegistry: FreyaPromptRegistry): string[] {
    const instructions: string[] = [];
    for (const toolbox of this.toolboxes) {
      const toolboxId = toolbox.getId();
      if (!this.isToolboxEnabled(toolboxId)) {
        continue;
      }
      const key = toolbox.getInstructionPrompt?.();
      if (!key) continue;

      const resolved = promptRegistry.get(key);
      if (resolved) {
        instructions.push(`### 工具箱能力说明 [激活ID: "${toolboxId}"]\n${resolved}`);
      }
    }
    return instructions;
  }

  getRegisteredToolboxIds(): string[] {
    return this.toolboxes
      .map((tb) => tb.getId())
      .filter((id) => this.isToolboxEnabled(id));
  }
}

