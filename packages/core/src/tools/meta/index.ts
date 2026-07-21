import type { FreyaTool, FreyaToolbox } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import type { FreyaToolRegistry } from '../tool-registry.js';

export class FreyaMetaToolbox implements FreyaToolbox {
  constructor(
    private sessionManager: FreyaSessionManager,
    private toolRegistry?: FreyaToolRegistry
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
            description: '装载当前会话所需的具体业务工具箱。支持传入包含多个 ID 的列表进行一次性并发装载。工具箱一旦装载将长期保留生效，直到被显式卸载。',
            parameters: {
              type: 'object',
              properties: {
                toolboxIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '待装载激活的业务工具箱 ID 列表（如：["fs"] 表示装载本地文件读写工具，["web"] 表示装载网络交互工具）'
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
            return '❌ 错误：无法从执行上下文中提取当前会话ID。';
          }

          if (this.toolRegistry) {
            const registeredIds = new Set(this.toolRegistry.getRegisteredToolboxIds());
            const invalidIds = ids.filter((id: string) => !registeredIds.has(id));
            if (invalidIds.length > 0) {
              return `❌ 错误：工具箱 [${invalidIds.join(', ')}] 当前在系统中未安装或已被系统管理员禁用，无法激活。可用的业务工具箱包括: [${Array.from(registeredIds).filter(id => id !== 'meta').join(', ')}]`;
            }
          }

          await this.sessionManager.activateToolboxes(sessionId, ids);
          return `成功装载工具箱: [${ids.join(', ')}]，对应工具已就绪。`;
        }
      },
      {
        getDefinition() {
          return {
            name: 'deactivate_toolboxes',
            description: '卸载当前会话中不需要的具体业务工具箱，卸载后该工具箱内的所有具体原子工具将立即从可用列表中撤销，用以精简大模型上下文和防止工具滥用。',
            parameters: {
              type: 'object',
              properties: {
                toolboxIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '待卸载的业务工具箱 ID 列表（如：["fs"]）'
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
            return '❌ 错误：无法从执行上下文中提取当前会话ID。';
          }
          await this.sessionManager.deactivateToolboxes(sessionId, ids);
          return `已成功卸载工具箱: [${ids.join(', ')}]。`;
        }
      },
      {
        getDefinition() {
          return {
            name: 'activate_skill',
            description: '使当前会话切入指定的角色或技能特长工作模式。注意：同一时间最多只能激活一个特定技能，切入新技能将自动覆盖并停用此前的旧技能。可选的技能 ID 详见 System Prompt 中投喂的可用技能列表。',
            parameters: {
              type: 'object',
              properties: {
                skillId: {
                  type: 'string',
                  description: '需要激活切入的特长技能 ID 标识（可选的 ID 请参照当前会话所提供和投喂的可用技能卡列表进行匹配传入）'
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
            return '❌ 错误：无法从执行上下文中提取当前会话ID。';
          }
          await this.sessionManager.updateSession(sessionId, { activeSkillId: skillId });
          return `已成功切入 [${skillId}] 技能特长工作模式。`;
        }
      },
      {
        getDefinition() {
          return {
            name: 'deactivate_skill',
            description: '停用当前已激活的特长技能，卸载对应的提示词设定，恢复为默认的通用对话模式。',
            parameters: {
              type: 'object',
              properties: {}
            }
          };
        },
        execute: async (args: any) => {
          const sessionId = args.__sessionId;
          if (!sessionId) {
            return '❌ 错误：无法从执行上下文中提取当前会话ID。';
          }
          await this.sessionManager.updateSession(sessionId, { activeSkillId: undefined });
          return '已成功停用当前技能特长，已恢复为默认的通用对话状态。';
        }
      }
    ];
  }
}
