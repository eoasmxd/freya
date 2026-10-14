import type { EventBus, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export interface SessionCommandDeps {
    commands: FreyaCommandRegistry;
    sessionManager: FreyaSessionManager;
    eventBus: EventBus;
    context: FreyaContext;
}

export function registerSessionCommands(deps: SessionCommandDeps): void {
    const { commands, sessionManager, eventBus, context } = deps;
    const i18n = new I18n({ zh, en }, context);

    const handleInfo = async (sessionId: string): Promise<string> => {
        const session = await sessionManager.getOrCreate(sessionId);
        const historyCount = session.history.length;
        const type = session.parentId
            ? i18n.t('cmd.session.info.typeBranch', 'Branch Session (parent: `{parentId}`)', { parentId: session.parentId })
            : i18n.t('cmd.session.info.typeMain', 'Main Session');
        const modelInfo = session.modelId
            ? `\`${session.modelId}\``
            : i18n.t('cmd.session.info.modelDefault', 'Default');
        const skillInfo = session.activeSkillId
            ? `\`${session.activeSkillId}\``
            : i18n.t('cmd.session.info.skillNone', 'None');
        return [
            i18n.t('cmd.session.info.title', '### 📋 Session Info'),
            i18n.t('cmd.session.info.id', '- **Session ID:** `{id}`', { id: session.id }),
            i18n.t('cmd.session.info.type', '- **Type:** {type}', { type }),
            i18n.t('cmd.session.info.messageCount', '- **Messages:** `{count}`', { count: historyCount }),
            i18n.t('cmd.session.info.model', '- **Bound Model:** {model}', { model: modelInfo }),
            i18n.t('cmd.session.info.skill', '- **Active Skill:** {skill}', { skill: skillInfo }),
            i18n.t('cmd.session.info.updatedAt', '- **Updated At:** `{time}`', { time: session.updatedAt }),
        ].join('\n');
    };

    const handleReset = async (sessionId: string, connectionId?: string): Promise<string | undefined> => {
        if (!connectionId) return undefined;

        const { oldId, archived } = await sessionManager.archiveAndRecreate(sessionId);

        if (!archived) {
            eventBus.emit('session:reply:text', {
                sessionId,
                content: i18n.t('cmd.session.reset.noHistory', 'ℹ️ Current session has no message history, reset skipped.')
            });
            eventBus.emit('session:reply:completed', { sessionId });
            return undefined;
        }

        const previousSessionId = oldId;
        const newSessionId = sessionId;

        eventBus.emit('connection:rebind', { connectionId, sessionId: newSessionId });

        eventBus.emit('session:reply:text', {
            sessionId: previousSessionId,
            content: i18n.t('cmd.session.reset.left', 'ℹ️ Connection has left this session; the session has been archived.')
        });

        eventBus.emit('session:reply:text', {
            sessionId: newSessionId,
            content: sessionId === 'main'
                ? i18n.t('cmd.session.reset.mainSuccess', '✅ Previous main session archived as `{oldId}`, now switched to new main session.', { oldId: previousSessionId })
                : i18n.t('cmd.session.reset.branchSuccess', '✅ Branch session archived as `{oldId}`, reset to a fresh branch in-place.', { oldId: previousSessionId })
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
            content: i18n.t('cmd.session.new.left', 'ℹ️ Connection has left this session, moved to new branch: `{branchId}`', { branchId })
        });

        eventBus.emit('session:reply:text', {
            sessionId: branchId,
            content: i18n.t('cmd.session.new.success', '✅ Branch session `{branchId}` created (isolated context), switched automatically. Type `/session main` to return.', { branchId })
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
            content: i18n.t('cmd.session.main.left', 'ℹ️ Connection has left this session, switching back to main.')
        });

        eventBus.emit('session:reply:text', {
            sessionId: 'main',
            content: i18n.t('cmd.session.main.success', '✅ Returned to main session.')
        });

        eventBus.emit('session:reply:completed', { sessionId });
        eventBus.emit('session:reply:completed', { sessionId: 'main' });
        return undefined;
    };

    const handleSwitch = async (targetId: string, sessionId: string, connectionId?: string): Promise<string | undefined> => {
        if (!connectionId) return undefined;
        if (!sessionManager.has(targetId)) {
            return i18n.t('cmd.session.switch.notFound', '❌ Session `{id}` does not exist. Use `/session new` to create one.', { id: targetId });
        }
        const session = await sessionManager.getOrCreate(targetId);

        eventBus.emit('connection:rebind', { connectionId, sessionId: targetId });

        eventBus.emit('session:reply:text', {
            sessionId,
            content: i18n.t('cmd.session.switch.left', 'ℹ️ Connection has left this session, switching to: `{id}`', { id: targetId })
        });

        const type = session.parentId
            ? i18n.t('cmd.session.switch.typeBranch', 'branch ')
            : i18n.t('cmd.session.switch.typeMain', 'main ');
        eventBus.emit('session:reply:text', {
            sessionId: targetId,
            content: i18n.t('cmd.session.switch.success', '✅ Switched to {type}session `{id}`.', { type, id: targetId })
        });

        eventBus.emit('session:reply:completed', { sessionId });
        eventBus.emit('session:reply:completed', { sessionId: targetId });
        return undefined;
    };

    const handleList = async (currentSessionId: string): Promise<string> => {
        const indices = sessionManager.listSessions();
        const title = i18n.t('cmd.session.list.title', '📋 Sessions');

        if (indices.length === 0) {
            return i18n.t('cmd.session.list.empty', 'ℹ️ {title}: none.', { title });
        }

        const lines = indices.map((idx: any) => {
            const marker = idx.id === currentSessionId
                ? i18n.t('cmd.session.list.current', ' **(current 👈)**')
                : '';
            const type = idx.parentId
                ? i18n.t('cmd.session.list.typeBranch', 'branch')
                : i18n.t('cmd.session.list.typeMain', 'main');
            return `- \`${idx.id}\` *(${type})*${marker}`;
        });

        return `### ${title}\n\n${lines.join('\n')}`;
    };

    commands.register({
        name: 'session',
        description: i18n.all('cmd.session.description', 'Session management'),
        subcommands: [
            { name: 'info', description: i18n.all('cmd.session.sub.info', 'Show current session info') },
            { name: 'reset', description: i18n.all('cmd.session.sub.reset', 'Archive current session and start a new one') },
            { name: 'new', description: i18n.all('cmd.session.sub.new', 'Create a branch sub-session'), usage: '/session new [name]' },
            { name: 'main', description: i18n.all('cmd.session.sub.main', 'Return to main session') },
            { name: 'switch', description: i18n.all('cmd.session.sub.switch', 'Switch to a specified session'), usage: '/session switch <ID>' },
            { name: 'list', description: i18n.all('cmd.session.sub.list', 'List active sessions'), usage: '/session list' },
        ],
        execute: async (args, sessionId, _ctx, connectionId) => {
            const sub = (args[0] || 'info').toLowerCase();

            switch (sub) {
                case 'info':
                    return await handleInfo(sessionId);

                case 'reset':
                    return await handleReset(sessionId, connectionId);

                case 'new': {
                    const name = args[1] || `session${Date.now()}`;
                    return await handleNew(name, sessionId, connectionId);
                }

                case 'main':
                    return await handleMain(sessionId, connectionId);

                case 'switch': {
                    const targetId = args[1];
                    if (!targetId) {
                        return i18n.t('cmd.session.switch.missingId', '❌ Usage: `/session switch <sessionId>`.');
                    }
                    if (!sessionManager.has(targetId)) {
                        return i18n.t('cmd.session.switch.notFound', '❌ Session `{id}` does not exist. Use `/session new` to create one.', { id: targetId });
                    }
                    return await handleSwitch(targetId, sessionId, connectionId);
                }

                case 'list': {
                    return await handleList(sessionId);
                }

                default:
                    return i18n.t('cmd.session.unknown', '❌ Unknown subcommand `{sub}`. Available: `info` `reset` `new` `main` `switch` `list`.', { sub });
            }
        }
    });

    commands.register({
        name: 'reset',
        description: i18n.all('cmd.reset.description', 'Archive current session and create a new main session'),
        execute: async (_args, sessionId, _ctx, connectionId) => {
            return await handleReset(sessionId, connectionId);
        }
    });
}
