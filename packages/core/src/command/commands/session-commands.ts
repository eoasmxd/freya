import type { EventBus } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';

export interface SessionCommandDeps {
    commands: FreyaCommandRegistry;
    sessionManager: FreyaSessionManager;
    eventBus: EventBus;
}

export function registerSessionCommands(deps: SessionCommandDeps): void {
    const { commands, sessionManager, eventBus } = deps;

    const handleInfo = async (sessionId: string): Promise<string> => {
        const session = await sessionManager.getOrCreate(sessionId);
        const historyCount = session.history.length;
        const parentTag = session.parentId ? ` (父: \`${session.parentId}\`)` : '';
        const type = session.parentId ? `分支会话${parentTag}` : '主会话';
        const modelInfo = session.modelId ? `\`${session.modelId}\`` : '默认';
        const skillInfo = session.activeSkillId ? `\`${session.activeSkillId}\`` : '无';
        return [
            `### 📋 会话信息`,
            `- **会话 ID:** \`${session.id}\``,
            `- **类型:** ${type}`,
            `- **消息数:** \`${historyCount}\``,
            `- **绑定模型:** ${modelInfo}`,
            `- **激活技能:** ${skillInfo}`,
            `- **更新时间:** \`${session.updatedAt}\``,
        ].join('\n');
    };

    const handleReset = async (sessionId: string, connectionId?: string): Promise<string | undefined> => {
        if (!connectionId) return undefined;
        let newSessionId = sessionId;
        let previousSessionId = sessionId;

        if (sessionId === 'main') {
            const { oldId } = await sessionManager.archiveAndRecreate('main');
            previousSessionId = oldId;
            newSessionId = 'main';
        } else {
            const { oldId } = await sessionManager.archiveAndRecreate(sessionId);
            previousSessionId = oldId;
            newSessionId = sessionId;
        }

        eventBus.emit('connection:rebind', { connectionId, sessionId: newSessionId });

        eventBus.emit('session:reply:text', {
            sessionId: previousSessionId,
            content: `ℹ️ 物理端已离开当前会话，该历史会话已被归档。`
        });

        eventBus.emit('session:reply:text', {
            sessionId: newSessionId,
            content: sessionId === 'main'
                ? `✅ 旧主会话已归档为 \`${previousSessionId}\`，当前已切换至新主会话。`
                : `✅ 分支会话已归档为 \`${previousSessionId}\`，当前已在原地重置为全新分支。`
        });

        eventBus.emit('session:reply:completed', { sessionId: previousSessionId });
        eventBus.emit('session:reply:completed', { sessionId: newSessionId });
        return undefined;
    };

    const handleNew = async (name: string, sessionId: string, connectionId?: string): Promise<string | undefined> => {
        if (!connectionId) return undefined;
        const parent = await sessionManager.getOrCreate(sessionId);
        const branchId = `branch_${name}_${Date.now()}`;
        await sessionManager.createSession(branchId, {
            parentId: sessionId,
            providerId: parent.providerId,
            modelId: parent.modelId,
            activeSkillId: parent.activeSkillId
        });

        eventBus.emit('connection:rebind', { connectionId, sessionId: branchId });

        eventBus.emit('session:reply:text', {
            sessionId,
            content: `ℹ️ 物理端已离开当前会话，新建并前往分支会话: \`${branchId}\``
        });

        eventBus.emit('session:reply:text', {
            sessionId: branchId,
            content: `✅ 已创建分支会话 \`${branchId}\`（独立上下文），并自动切换。输入 \`/session main\` 可回到主会话。`
        });

        eventBus.emit('session:reply:completed', { sessionId });
        eventBus.emit('session:reply:completed', { sessionId: branchId });
        return undefined;
    };

    const handleMain = async (sessionId: string, connectionId?: string): Promise<string | undefined> => {
        if (!connectionId) return undefined;

        eventBus.emit('connection:rebind', { connectionId, sessionId: 'main' });

        eventBus.emit('session:reply:text', {
            sessionId,
            content: `ℹ️ 物理端已离开当前会话，切换回到主会话。`
        });

        eventBus.emit('session:reply:text', {
            sessionId: 'main',
            content: `✅ 已回到主会话。`
        });

        eventBus.emit('session:reply:completed', { sessionId });
        eventBus.emit('session:reply:completed', { sessionId: 'main' });
        return undefined;
    };

    const handleSwitch = async (targetId: string, sessionId: string, connectionId?: string): Promise<string | undefined> => {
        if (!connectionId) return undefined;
        const session = await sessionManager.getOrCreate(targetId);
        if (!session) {
            return `❌ 会话 \`${targetId}\` 不存在。`;
        }
        if (session.archived) {
            return `❌ 会话 \`${targetId}\` 已归档，无法切换。如需查看归档会话请使用 \`/session list archived\`。`;
        }

        eventBus.emit('connection:rebind', { connectionId, sessionId: targetId });

        eventBus.emit('session:reply:text', {
            sessionId,
            content: `ℹ️ 物理端已离开当前会话，切换去往会话: \`${targetId}\``
        });

        const type = session.parentId ? '分支' : '主';
        eventBus.emit('session:reply:text', {
            sessionId: targetId,
            content: `✅ 已切换到${type}会话 \`${targetId}\`。`
        });

        eventBus.emit('session:reply:completed', { sessionId });
        eventBus.emit('session:reply:completed', { sessionId: targetId });
        return undefined;
    };

    const handleList = async (filter: string, currentSessionId: string): Promise<string> => {
        let indices;
        let title;
        if (filter === 'archived') {
            indices = sessionManager.listSessions({ archived: true });
            title = '📦 已归档会话';
        } else if (filter === 'all') {
            indices = sessionManager.listSessions();
            title = '📋 全部会话';
        } else {
            indices = sessionManager.listSessions({ archived: false });
            title = '📋 活跃会话';
        }

        if (indices.length === 0) {
            return `ℹ️ ${title}：暂无。`;
        }

        const lines = indices.map((idx: any) => {
            const marker = idx.id === currentSessionId ? ' **(当前 👈)**' : '';
            const type = idx.parentId ? '分支' : '主';
            const archivedTag = idx.archived ? ` *(归档于 ${idx.archivedAt?.slice(0, 10)})*` : '';
            return `- \`${idx.id}\` *(${type})*${archivedTag}${marker}`;
        });

        return `### ${title}\n\n${lines.join('\n')}`;
    };

    commands.register({
        name: 'session',
        description: '会话管理',
        subcommands: [
            { name: 'info', description: '查看当前会话信息' },
            { name: 'reset', description: '归档当前会话并开启新会话' },
            { name: 'new', description: '创建分支子会话', usage: '/session new [名称]' },
            { name: 'main', description: '返回主会话' },
            { name: 'switch', description: '切换指定会话', usage: '/session switch <ID>' },
            { name: 'list', description: '列出会话', usage: '/session list [archived|all]' },
        ],
        execute: async (args, sessionId, ctx, connectionId) => {
            const sub = (args[0] || 'info').toLowerCase();

            switch (sub) {
                case 'info':
                    return await handleInfo(sessionId);

                case 'reset':
                    return await handleReset(sessionId, connectionId);

                case 'new': {
                    const name = args[1] || `会话${Date.now()}`;
                    return await handleNew(name, sessionId, connectionId);
                }

                case 'main':
                    return await handleMain(sessionId, connectionId);

                case 'switch': {
                    const targetId = args[1];
                    if (!targetId) {
                        return '❌ 用法：`\`/session switch <会话ID>\``。';
                    }
                    if (!sessionManager.has(targetId)) {
                        return `❌ 会话 \`${targetId}\` 不存在。请使用 \`/session new\` 创建新会话后重试。`;
                    }
                    return await handleSwitch(targetId, sessionId, connectionId);
                }

                case 'list': {
                    const filter = (args[1] || '').toLowerCase();
                    return await handleList(filter, sessionId);
                }

                default:
                    return `❌ 未知子命令 \`${sub}\`。可用子命令：\`info\` \`reset\` \`new\` \`main\` \`switch\` \`list\`。`;
            }
        }
    });

    commands.register({
        name: 'reset',
        description: '归档当前会话并创建新主会话',
        execute: async (args, sessionId, ctx, connectionId) => {
            return await handleReset(sessionId, connectionId);
        }
    });
}
