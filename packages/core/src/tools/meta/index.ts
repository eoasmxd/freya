import type { FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import type { FreyaToolRegistry } from '../tool-registry.js';
import type { FreyaSkillRegistry } from '../../skill/skill-registry.js';

export class FreyaMetaToolbox implements FreyaToolbox {
  constructor(
    private sessionManager: FreyaSessionManager,
    private toolRegistry?: FreyaToolRegistry,
    private skillRegistry?: FreyaSkillRegistry
  ) {}

  getId(): string {
    return 'meta';
  }

  getInstructionPrompt(): string {
    return 'tool.prompt.meta';
  }

  getTools(): FreyaTool[] {
    return [
      {
        getDefinition() {
          return {
            name: 'activate_toolboxes',
            // 装载当前会话所需的业务工具箱
            description: 'Load specific business toolboxes required for the current session. Supports passing a list of multiple IDs for concurrent loading. Loaded toolboxes remain active until explicitly deactivated.',
            parameters: {
              type: 'object',
              properties: {
                toolboxIds: {
                  type: 'array',
                  items: { type: 'string' },
                  // 待装载激活的业务工具箱 ID 列表
                  description: 'List of business toolbox IDs to load and activate (e.g. ["fs"] for filesystem tools, ["web"] for web tools)'
                }
              },
              required: ['toolboxIds']
            }
          };
        },
        execute: async (args: any) => {
          const ids = args.toolboxIds || [];
          const sessionId = args.__sessionId;
          if (!sessionId) {
            // 无法提取会话ID错误提示
            return '❌ Error: Failed to extract current session ID from execution context.';
          }

          if (this.toolRegistry) {
            const registeredIds = new Set(this.toolRegistry.getRegisteredToolboxIds());
            const invalidIds = ids.filter((id: string) => !registeredIds.has(id));
            if (invalidIds.length > 0) {
              // 工具箱未安装或已被禁用错误提示
              return `❌ Error: Toolbox [${invalidIds.join(', ')}] is not installed or has been disabled. Available business toolboxes: [${Array.from(registeredIds).filter(id => id !== 'meta').join(', ')}]`;
            }
          }

          await this.sessionManager.activateToolboxes(sessionId, ids);
          // 装载成功出参
          return `Successfully loaded toolboxes: [${ids.join(', ')}]. Corresponding tools are ready.`;
        }
      },
      {
        getDefinition() {
          return {
            name: 'deactivate_toolboxes',
            // 卸载当前会话不需要的业务工具箱
            description: 'Unload specific business toolboxes not needed in current session. Atomic tools within will be immediately revoked to streamline context and prevent tool abuse.',
            parameters: {
              type: 'object',
              properties: {
                toolboxIds: {
                  type: 'array',
                  items: { type: 'string' },
                  // 待卸载的业务工具箱 ID 列表
                  description: 'List of business toolbox IDs to deactivate (e.g. ["fs"])'
                }
              },
              required: ['toolboxIds']
            }
          };
        },
        execute: async (args: any) => {
          const ids = args.toolboxIds || [];
          const sessionId = args.__sessionId;
          if (!sessionId) {
            // 无法提取会话ID错误提示
            return '❌ Error: Failed to extract current session ID from execution context.';
          }
          await this.sessionManager.deactivateToolboxes(sessionId, ids);
          // 卸载成功出参
          return `Successfully deactivated toolboxes: [${ids.join(', ')}].`;
        }
      },
      {
        getDefinition() {
          return {
            name: 'activate_skill',
            // 激活切换指定特长技能模式
            description: 'Switch current session into a specified skill/persona mode. At most one skill can be active at a time; activating a new one overrides the previous. See available skills in System Prompt.',
            parameters: {
              type: 'object',
              properties: {
                skillId: {
                  type: 'string',
                  // 待激活的特长技能 ID
                  description: 'Skill ID to activate (match from the available skills list provided in the session prompt)'
                }
              },
              required: ['skillId']
            }
          };
        },
        execute: async (args: any) => {
          const skillId = args.skillId;
          const sessionId = args.__sessionId;
          if (!sessionId) {
            // 无法提取会话ID错误提示
            return '❌ Error: Failed to extract current session ID from execution context.';
          }
          if (this.skillRegistry) {
            const skill = this.skillRegistry.get(skillId);
            if (!skill || !skill.enabled) {
              // 技能不存在或已禁用错误提示
              return `❌ Error: Skill [${skillId}] does not exist or has been disabled.`;
            }
          }
          await this.sessionManager.updateSession(sessionId, { activeSkillId: skillId });
          // 切换技能成功出参
          return `Successfully switched to skill mode [${skillId}].`;
        }
      },
      {
        getDefinition() {
          return {
            name: 'deactivate_skill',
            // 停用当前已激活特长技能
            description: 'Deactivate current skill and unload prompt configurations, restoring to default general chat mode.',
            parameters: {
              type: 'object',
              properties: {}
            }
          };
        },
        execute: async (args: any) => {
          const sessionId = args.__sessionId;
          if (!sessionId) {
            // 无法提取会话ID错误提示
            return '❌ Error: Failed to extract current session ID from execution context.';
          }
          await this.sessionManager.updateSession(sessionId, { activeSkillId: undefined });
          // 停用技能成功出参
          return 'Successfully deactivated current skill, restored to default general chat mode.';
        }
      }
    ];
  }
}
