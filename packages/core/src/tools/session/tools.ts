import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';

export class ListSessionsTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_sessions',
      // 列出系统会话与子任务树
      description: 'List all sessions and subagent task trees in the system. Hierarchically displays status, prompt, and duration for subagent sessions.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            // 会话筛选条件
            description: 'Filter condition: active (active only), archived (archived only), all (default all)',
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
        // 无会话记录提示
        return '📋 No session records found.';
      }

      const rootSessions = allIndices.filter(s => !s.parentId);
      const childSessions = allIndices.filter(s => !!s.parentId);

      const renderTree = (sessionIdx: any, depth = 0): string[] => {
        const indent = '  '.repeat(depth);
        const prefix = depth > 0 ? '└─ 🤖 ' : '🟢 ';
        const model = sessionIdx.modelId ? `[${sessionIdx.modelId}]` : '(Default Model)';
        const summary = sessionIdx.summary
          ? sessionIdx.summary.slice(0, 50) + (sessionIdx.summary.length > 50 ? '...' : '')
          : (sessionIdx.prompt ? `Subtask: "${sessionIdx.prompt.slice(0, 40)}..."` : '(No summary)');

        let statusStr = '';
        if (sessionIdx.parentId) {
          const duration = sessionIdx.durationMs ? ` (${(sessionIdx.durationMs / 1000).toFixed(1)}s)` : '';
          const statusEmoji = sessionIdx.status === 'running' ? '⏳' : sessionIdx.status === 'completed' ? '✅' : '❌';
          statusStr = ` | Status: ${statusEmoji} ${sessionIdx.status}${duration}`;
        }

        const currentLine = `${indent}${prefix}Session ID: ${sessionIdx.id} · ${summary} · Model: ${model}${statusStr} · Updated at ${sessionIdx.updatedAt}`;
        const lines = [currentLine];

        const children = childSessions.filter(c => c.parentId === sessionIdx.id);
        for (const child of children) {
          lines.push(...renderTree(child, depth + 1));
        }
        return lines;
      };

      // 系统会话追踪树输出
      const sections: string[] = ['📋 System session tracking tree:', ''];
      for (const root of rootSessions) {
        sections.push(...renderTree(root));
      }

      return sections.join('\n');
    } catch (err: any) {
      // 列出会话失败错误提示
      return `❌ Failed to list sessions: ${err.message}`;
    }
  }
}

export class ViewSessionInfoTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'view_session_info',
      // 查看会话基本信息
      description: 'View basic metadata of a specified session (model, active skill, archive status, parent/child relation, updated time) without loading chat history.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            // 待查看的会话 ID
            description: 'Target session ID to inspect'
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
        // 未找到会话错误提示
        return `❌ Session not found: ${sessionId}`;
      }

      const model = idx.modelId || '(Not bound)';
      const skill = idx.activeSkillId || '(None active)';
      const parent = idx.parentId ? `Parent Session: ${idx.parentId}` : 'Root Session';

      let lines = [
        `📊 Session [${sessionId}] Basic Information:`,
        `- Hierarchy: ${parent}`,
        `- Bound Model: ${model}`,
        `- Active Skill: ${skill}`,
        `- Archive Status: ${idx.archived ? 'Archived' : 'Active'}`,
        `- Updated At: ${idx.updatedAt}`
      ];

      if (idx.parentId) {
        const duration = idx.durationMs ? `${(idx.durationMs / 1000).toFixed(1)}s` : '0s';
        lines.push(
          `- Subtask Prompt: "${idx.prompt || '(No prompt)'}"`,
          `- Run Status: ${idx.status || 'unknown'}`,
          `- Duration: ${duration}`
        );
      }

      return lines.join('\n');
    } catch (err: any) {
      // 查询会话信息失败错误提示
      return `❌ Failed to query session info: ${err.message}`;
    }
  }
}

export class ViewSessionContentTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'view_session_content',
      // 查看指定会话的对话历史
      description: 'Inspect actual chat history messages for a specified session. Use only when details are required to avoid context overload.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            // 要查看的会话 ID
            description: 'Session ID to inspect (optional, defaults to current session)'
          },
          limit: {
            type: 'number',
            // 最多获取的消息轮数
            description: 'Maximum number of recent message turns to retrieve (defaults to all)'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const sessionId = args.__sessionId || args.sessionId;
      if (!sessionId) {
        // 参数错误提示
        return '❌ Parameter error: Please provide a valid session ID.';
      }
      const idx = this.sessionManager.findLatestIndexById(sessionId);
      if (!idx) {
        // 未找到会话错误提示
        return `❌ Session not found: ${sessionId}`;
      }

      const history = await this.sessionManager.getHistory(sessionId);
      if (history.length === 0) {
        // 会话暂无历史提示
        return `ℹ️ Session [${sessionId}] has no chat history yet.`;
      }

      const limit = typeof args.limit === 'number' ? args.limit : history.length;
      const sliced = history.slice(-limit);

      const formatted = sliced.map((m, i) => {
        const attachCount = m.attachments?.length ? ` [with ${m.attachments.length} attachments]` : '';
        const toolCount = m.toolCalls?.length ? ` [invoked ${m.toolCalls.length} tool calls]` : '';
        return `[#${i + 1}] **${m.role.toUpperCase()}**:${attachCount}${toolCount}\n${m.content || '(Empty content)'}\n---`;
      });

      // 对话历史出参
      return `💬 Session [${sessionId}] Chat History (Latest ${sliced.length} entries):\n\n${formatted.join('\n\n')}`;
    } catch (err: any) {
      // 加载会话历史失败错误提示
      return `❌ Failed to load session history: ${err.message}`;
    }
  }
}

export class ViewSessionSnapshotTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'view_session_snapshot',
      // 查看会话压缩裁剪快照
      description: 'Inspect historical snapshot content of the session compacted due to length, containing raw messages and earlier snapshot ID link.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            // 会话 ID
            description: 'Session ID (optional, defaults to current session)'
          },
          snapshotId: {
            type: 'string',
            // 目标压缩快照 ID
            description: 'Target snapshot ID to inspect (optional, defaults to latest snapshot)'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const sessionId = args.__sessionId || args.sessionId;
      if (!sessionId) {
        // 参数错误提示
        return '❌ Parameter error: Please provide a valid session ID.';
      }
      const idx = this.sessionManager.findLatestIndexById(sessionId);
      if (!idx) {
        // 未找到会话错误提示
        return `❌ Session not found: ${sessionId}`;
      }

      let snapshotId = args.snapshotId;
      if (!snapshotId) {
        const session = await this.sessionManager.getOrCreate(sessionId);
        snapshotId = session.lastSnapshotId;
      }

      if (!snapshotId) {
        // 暂无压缩快照提示
        return `ℹ️ Session [${sessionId}] has no compaction snapshots.`;
      }

      const targetSnap = await this.sessionManager.getSnapshot(sessionId, snapshotId);
      if (!targetSnap) {
        // 快照未找到错误提示
        return `❌ Snapshot "${snapshotId}" not found in session [${sessionId}].`;
      }

      const formatted = targetSnap.messages.map((m: any, i: number) => {
        return `[#${i + 1}] **${m.role.toUpperCase()}**:\n${m.content || '(Empty content)'}\n---`;
      });

      // 快照对话历史出参
      return `📸 Session [${sessionId}] Snapshot [${snapshotId}] Chat History:\n\n- **Created At**: ${targetSnap.createdAt}\n- **Summary**: ${targetSnap.summary}\n- **Compacted Messages**: Total ${targetSnap.messageCount} entries\n\n--- Raw message details ---\n\n${formatted.join('\n\n')}`;
    } catch (err: any) {
      // 读取快照失败错误提示
      return `❌ Failed to read snapshot: ${err.message}`;
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
      // 派生独立子任务智能体
      description: 'Spawn a relatively isolated subagent task. The system runs an independent sense-plan-act loop in the background. Synchronously returns result.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            // 派发给子任务的描述
            description: 'Detailed prompt description dispatched to the subtask (e.g. "Research and compile latest trends in LLM technologies")'
          },
          providerId: {
            type: 'string',
            // 子任务调用的模型提供商 ID
            description: 'Provider ID for subtask model (optional, use list_provider to get valid IDs)'
          },
          modelId: {
            type: 'string',
            // 子任务调用的模型 ID
            description: 'Model ID for subtask (optional, use list_model to get valid IDs)'
          }
        },
        required: ['prompt']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.prompt) {
      // 缺少 prompt 参数错误
      return '❌ Parameter error: Detailed prompt description for subtask must be provided.';
    }
    if (!this.agentService) {
      // 缺少 AgentService 错误
      throw new Error('AgentService has not been injected yet, cannot spawn subagent.');
    }

    const parentSessionId = args.__sessionId || 'unknown_parent';
    const childSessionId = `${parentSessionId}_sub_${Date.now()}`;

    ctx.logger.info(`[SubagentTool] Spawning subagent task: parent "${parentSessionId}" -> child "${childSessionId}"`);
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
      // 中止后台运行的子任务
      description: 'Forcibly interrupt and abort an in-flight background subagent task by child session ID, releasing resources.',
      parameters: {
        type: 'object',
        properties: {
          childSessionId: {
            type: 'string',
            // 待中止的子会话 ID
            description: 'Child session ID to abort (e.g. "session_123_sub_1719999999000")'
          }
        },
        required: ['childSessionId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.childSessionId) {
      // 缺少 childSessionId 参数错误
      return '❌ Parameter error: Child session ID childSessionId must be specified.';
    }
    if (!this.agentService) {
      // 缺少 AgentService 错误
      throw new Error('AgentService has not been injected yet, cannot cancel subagent.');
    }

    try {
      return this.agentService.cancelSubAgent(args.childSessionId);
    } catch (err: any) {
      // 中止子任务失败错误提示
      return `❌ Failed to cancel subagent: ${err.message}`;
    }
  }
}
