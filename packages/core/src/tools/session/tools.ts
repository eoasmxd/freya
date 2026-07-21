import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';

export class ListSessionsTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_sessions',
      description: '列出系统中的所有会话与子任务树。对于属于子任务的会话，将按层级关系树状渲染其运行状态、任务和耗时。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: '筛选条件：active（仅活跃）、archived（仅归档）、all（全部），默认 all',
            enum: ['active', 'archived', 'all'],
          },
        },
      },
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const filter = (args.filter || 'all') as 'active' | 'archived' | 'all';
      let allIndices = this.sessionManager.listSessions();

      if (filter === 'active') {
        allIndices = allIndices.filter(i => !i.archived);
      } else if (filter === 'archived') {
        allIndices = allIndices.filter(i => i.archived);
      }

      if (allIndices.length === 0) {
        return '📋 暂无会话记录。';
      }

      const rootSessions = allIndices.filter(s => !s.parentId);
      const childSessions = allIndices.filter(s => !!s.parentId);

      const renderTree = (sessionIdx: any, depth = 0): string[] => {
        const indent = '  '.repeat(depth);
        const prefix = depth > 0 ? '└─ 🤖 ' : '🟢 ';
        const model = sessionIdx.modelId ? `[${sessionIdx.modelId}]` : '(默认模型)';
        const summary = sessionIdx.summary
          ? sessionIdx.summary.slice(0, 50) + (sessionIdx.summary.length > 50 ? '...' : '')
          : (sessionIdx.prompt ? `子任务: "${sessionIdx.prompt.slice(0, 40)}..."` : '(无摘要)');

        let statusStr = '';
        if (sessionIdx.parentId) {
          const duration = sessionIdx.durationMs ? ` (${(sessionIdx.durationMs / 1000).toFixed(1)}s)` : '';
          const statusEmoji = sessionIdx.status === 'running' ? '⏳' : sessionIdx.status === 'completed' ? '✅' : '❌';
          statusStr = ` | 状态: ${statusEmoji} ${sessionIdx.status}${duration}`;
        }

        const currentLine = `${indent}${prefix}会话 ID: ${sessionIdx.id} · ${summary} · 模型: ${model}${statusStr} · 更新于 ${sessionIdx.updatedAt}`;
        const lines = [currentLine];

        const children = childSessions.filter(c => c.parentId === sessionIdx.id);
        for (const child of children) {
          lines.push(...renderTree(child, depth + 1));
        }
        return lines;
      };

      const sections: string[] = ['📋 系统会话树形追踪表如下：', ''];
      for (const root of rootSessions) {
        sections.push(...renderTree(root));
      }

      return sections.join('\n');
    } catch (err: any) {
      return `❌ 列出会话失败: ${err.message}`;
    }
  }
}

export class ViewSessionInfoTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'view_session_info',
      description: '查看指定会话的基本信息（模型绑定、激活技能、归档状态、父子级关系和最后更新时间等），不加载对话历史。',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: '待查看的会话 ID'
          }
        },
        required: ['sessionId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const sessionId = args.sessionId;
      const idx = this.sessionManager.findLatestIndexById(sessionId);
      if (!idx) {
        return `❌ 未找到会话: ${sessionId}`;
      }

      const model = idx.modelId || '(未绑定)';
      const skill = idx.activeSkillId || '(无激活)';
      const parent = idx.parentId ? `父会话: ${idx.parentId}` : '根会话';

      let lines = [
        `📊 会话 [${sessionId}] 基本信息：`,
        `- 层级归属: ${parent}`,
        `- 绑定模型: ${model}`,
        `- 激活技能: ${skill}`,
        `- 归档状态: ${idx.archived ? '已归档' : '活跃'}`,
        `- 更新时间: ${idx.updatedAt}`
      ];

      if (idx.parentId) {
        const duration = idx.durationMs ? `${(idx.durationMs / 1000).toFixed(1)}s` : '0s';
        lines.push(
          `- 派生任务: "${idx.prompt || '(无描述)'}"`,
          `- 运行状态: ${idx.status || 'unknown'}`,
          `- 执行耗时: ${duration}`
        );
      }

      return lines.join('\n');
    } catch (err: any) {
      return `❌ 查询会话信息失败: ${err.message}`;
    }
  }
}

export class ViewSessionContentTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'view_session_content',
      description: '查看指定会话的具体历史对话文字。请仅在需要了解对话详情或回溯历史回答时才调用它，以防止上下文超载。',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: '要查看的会话 ID（可选，默认当前会话）'
          },
          limit: {
            type: 'number',
            description: '最多获取的消息轮数（从新到旧），默认返回全部'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const sessionId = args.__sessionId || args.sessionId;
      if (!sessionId) {
        return '❌ 参数错误：请提供有效的会话 ID。';
      }
      const idx = this.sessionManager.findLatestIndexById(sessionId);
      if (!idx) {
        return `❌ 未找到会话: ${sessionId}`;
      }

      const history = await this.sessionManager.getHistory(sessionId);
      if (history.length === 0) {
        return `ℹ️ 会话 [${sessionId}] 尚无对话历史。`;
      }

      const limit = typeof args.limit === 'number' ? args.limit : history.length;
      const sliced = history.slice(-limit);

      const formatted = sliced.map((m, i) => {
        const attachCount = m.attachments?.length ? ` [携带 ${m.attachments.length} 个附件]` : '';
        const toolCount = m.toolCalls?.length ? ` [发起 ${m.toolCalls.length} 次工具调用]` : '';
        return `[#${i + 1}] **${m.role.toUpperCase()}**:${attachCount}${toolCount}\n${m.content || '(空内容)'}\n---`;
      });

      return `💬 会话 [${sessionId}] 对话历史 (最新 ${sliced.length} 条)：\n\n${formatted.join('\n\n')}`;
    } catch (err: any) {
      return `❌ 加载会话历史内容失败: ${err.message}`;
    }
  }
}

export class ViewSessionSnapshotTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'view_session_snapshot',
      description: '查看当前会话因太长而被压缩裁剪的历史快照内容。快照内容中包含此前的原始对话明细，以及更早快照的 ID 链接。',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: '会话 ID（可选，默认当前会话）'
          },
          snapshotId: {
            type: 'string',
            description: '需要调阅的目标压缩快照的 ID（可选）。若不传，则默认调阅最新产生的快照。'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const sessionId = args.__sessionId || args.sessionId;
      if (!sessionId) {
        return '❌ 参数错误：请提供有效的会话 ID。';
      }
      const idx = this.sessionManager.findLatestIndexById(sessionId);
      if (!idx) {
        return `❌ 未找到会话: ${sessionId}`;
      }

      let snapshotId = args.snapshotId;
      if (!snapshotId) {
        const session = await this.sessionManager.getOrCreate(sessionId);
        snapshotId = session.lastSnapshotId;
      }

      if (!snapshotId) {
        return `ℹ️ 会话 [${sessionId}] 暂无压缩历史快照。`;
      }

      const targetSnap = await this.sessionManager.getSnapshot(sessionId, snapshotId);
      if (!targetSnap) {
        return `❌ 未在会话 [${sessionId}] 中找到 ID 为 "${snapshotId}" 的快照文件。`;
      }

      const formatted = targetSnap.messages.map((m: any, i: number) => {
        return `[#${i + 1}] **${m.role.toUpperCase()}**:\n${m.content || '(空内容)'}\n---`;
      });

      return `📸 会话 [${sessionId}] 快照 [${snapshotId}] 的对话历史：\n\n- **创建时间**: ${targetSnap.createdAt}\n- **快照提要**: ${targetSnap.summary}\n- **压缩消息**: 共 ${targetSnap.messageCount} 条\n\n--- 原始明细消息列如下 ---\n\n${formatted.join('\n\n')}`;
    } catch (err: any) {
      return `❌ 读取快照失败：${err.message}`;
    }
  }
}

export class SpawnSubagentTool implements FreyaTool {
  private agentService?: FreyaAgentService;

  constructor(private sessionManager: FreyaSessionManager) {}

  setAgentService(agentService: FreyaAgentService): void {
    this.agentService = agentService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'spawn_subagent',
      description: '派生出一个相对隔离的子任务去执行。系统会在后台为此任务运行独立的感知-决策-行动大循环。该工具是同步阻塞的，执行完毕后会直接返回结果。',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '派发给子任务的具体描述（如："查询并整理关于大模型技术发展的最新行业分析报告"）'
          },
          providerId: {
            type: 'string',
            description: '子任务调用的模型提供商 ID（可选，请使用 list_provider 接口获取系统当前已配置的有效 ID）'
          },
          modelId: {
            type: 'string',
            description: '子任务调用的具体模型 ID（可选，请使用 list_model 接口获取已配置的有效 ID，避免盲目猜测）'
          }
        },
        required: ['prompt']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.prompt) {
      return '❌ 参数错误：必须提供具体子任务 prompt 描述。';
    }
    if (!this.agentService) {
      throw new Error('AgentService 尚未注入，无法派生子任务。');
    }

    const parentSessionId = args.__sessionId || 'unknown_parent';
    const childSessionId = `${parentSessionId}_sub_${Date.now()}`;

    ctx.logger.info(`[SubagentTool] 派生子会话任务: 父会话 "${parentSessionId}" -> 子会话 "${childSessionId}"`);
    return await this.agentService.runSubAgent(parentSessionId, childSessionId, args.prompt, args);
  }
}

export class CancelSubagentTool implements FreyaTool {
  private agentService?: FreyaAgentService;

  constructor(private sessionManager: FreyaSessionManager) {}

  setAgentService(agentService: FreyaAgentService): void {
    this.agentService = agentService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'cancel_subagent',
      description: '根据指定的子会话 ID，强行打断并中止其在后台的执行，释放系统资源。',
      parameters: {
        type: 'object',
        properties: {
          childSessionId: {
            type: 'string',
            description: '待中止的子会话 ID（例如："session_123_sub_1719999999000"）'
          }
        },
        required: ['childSessionId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.childSessionId) {
      return '❌ 参数错误：必须指定待中止的子会话 ID childSessionId。';
    }
    if (!this.agentService) {
      throw new Error('AgentService 尚未注入，无法中止子任务。');
    }

    try {
      return this.agentService.cancelSubAgent(args.childSessionId);
    } catch (err: any) {
      return `❌ 中止失败: ${err.message}`;
    }
  }
}
