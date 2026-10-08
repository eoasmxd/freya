import type { FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import type { FreyaToolRegistry } from '../tool-registry.js';
import type { FreyaSkillRegistry } from '../../skill/skill-registry.js';

/**
 * 激活工具箱元工具
 * Activate toolbox meta tool
 */
export class ActivateToolboxTool implements FreyaTool {
  constructor(
    private sessionManager: FreyaSessionManager,
    private toolRegistry?: FreyaToolRegistry
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'activate_toolbox',
      description: 'Load specific business toolboxes required for the current session. Supports passing a list of IDs for concurrent loading. Loaded toolboxes remain active until explicitly deactivated.',
      parameters: {
        type: 'object',
        properties: {
          toolboxIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of business toolbox IDs to load and activate simultaneously (e.g. ["fs", "web"])'
          }
        },
        required: ['toolboxIds']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const rawIds = Array.isArray(args.toolboxIds)
      ? args.toolboxIds
      : (typeof args.toolboxId === 'string' ? [args.toolboxId] : []);
    const ids = rawIds.filter((id: any) => typeof id === 'string' && id.trim() !== '');

    if (ids.length === 0) {
      return '❌ Parameter error: Please provide toolboxIds.';
    }

    const sessionId = args.__sessionId;
    if (!sessionId) {
      return '❌ Error: Failed to extract current session ID from execution context.';
    }

    if (this.toolRegistry) {
      const session = await this.sessionManager.getOrCreate(sessionId);
      const registeredIds = new Set(this.toolRegistry.getRegisteredToolboxIds(session));
      const invalidIds = ids.filter((id: string) => !registeredIds.has(id));
      if (invalidIds.length > 0) {
        return `❌ Error: Toolbox [${invalidIds.join(', ')}] is not installed or has been disabled. Available business toolboxes: [${Array.from(registeredIds).join(', ')}]`;
      }
    }

    await this.sessionManager.activateToolboxes(sessionId, ids);
    return `Successfully loaded toolboxes: [${ids.join(', ')}]. Corresponding tools are ready.`;
  }
}

/**
 * 停用工具箱元工具
 * Deactivate toolbox meta tool
 */
export class DeactivateToolboxTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'deactivate_toolbox',
      description: 'Unload specific business toolboxes not needed in current session. Atomic tools within will be immediately revoked to streamline context and prevent tool abuse.',
      parameters: {
        type: 'object',
        properties: {
          toolboxIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of business toolbox IDs to deactivate'
          }
        },
        required: ['toolboxIds']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const rawIds = Array.isArray(args.toolboxIds)
      ? args.toolboxIds
      : (typeof args.toolboxId === 'string' ? [args.toolboxId] : []);
    const ids = rawIds.filter((id: any) => typeof id === 'string' && id.trim() !== '');

    if (ids.length === 0) {
      return '❌ Parameter error: Please provide toolboxIds.';
    }

    const sessionId = args.__sessionId;
    if (!sessionId) {
      return '❌ Error: Failed to extract current session ID from execution context.';
    }

    await this.sessionManager.deactivateToolboxes(sessionId, ids);
    return `Successfully deactivated toolboxes: [${ids.join(', ')}].`;
  }
}

/**
 * 激活技能元工具
 * Activate skill meta tool
 */
export class ActivateSkillTool implements FreyaTool {
  constructor(
    private sessionManager: FreyaSessionManager,
    private skillRegistry?: FreyaSkillRegistry
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'activate_skill',
      description: 'Switch current session into a specified skill/persona mode. At most one skill can be active at a time; activating a new one overrides the previous. See available skills in System Prompt.',
      parameters: {
        type: 'object',
        properties: {
          skillId: {
            type: 'string',
            description: 'Skill ID to activate (match from the available skills list provided in the session prompt)'
          }
        },
        required: ['skillId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const skillId = args.skillId;
    if (!skillId) {
      return '❌ Parameter error: Please specify skillId.';
    }

    const sessionId = args.__sessionId;
    if (!sessionId) {
      return '❌ Error: Failed to extract current session ID from execution context.';
    }

    if (this.skillRegistry) {
      const skill = this.skillRegistry.get(skillId);
      if (!skill || !skill.enabled) {
        return `❌ Error: Skill [${skillId}] does not exist or has been disabled.`;
      }
    }

    await this.sessionManager.updateSession(sessionId, { activeSkillId: skillId });
    return `Successfully switched to skill mode [${skillId}].`;
  }
}

/**
 * 停用技能元工具
 * Deactivate skill meta tool
 */
export class DeactivateSkillTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'deactivate_skill',
      description: 'Deactivate current skill and unload prompt configurations, restoring to default general chat mode.',
      parameters: {
        type: 'object',
        properties: {}
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const sessionId = args.__sessionId;
    if (!sessionId) {
      return '❌ Error: Failed to extract current session ID from execution context.';
    }

    await this.sessionManager.updateSession(sessionId, { activeSkillId: undefined });
    return 'Successfully deactivated current skill, restored to default general chat mode.';
  }
}

/**
 * 创建全套内核固有元认知工具集合
 * Create complete set of intrinsic meta tools
 */
export function createMetaTools(
  sessionManager: FreyaSessionManager,
  toolRegistry?: FreyaToolRegistry,
  skillRegistry?: FreyaSkillRegistry
): FreyaTool[] {
  return [
    new ActivateToolboxTool(sessionManager, toolRegistry),
    new DeactivateToolboxTool(sessionManager),
    new ActivateSkillTool(sessionManager, skillRegistry),
    new DeactivateSkillTool(sessionManager)
  ];
}
