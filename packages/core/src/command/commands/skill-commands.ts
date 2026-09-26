import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaSkill } from '../../skill/skill-registry.js';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export interface SkillCommandDeps {
    commands: FreyaCommandRegistry;
    sessionManager: FreyaSessionManager;
    skills: Map<string, FreyaSkill>;
    context: FreyaContext;
}

export function registerSkillCommands(deps: SkillCommandDeps): void {
    const { commands, sessionManager, skills, context } = deps;
    const i18n = new I18n({ zh, en }, context);

    const handleInfo = async (sessionId: string): Promise<string> => {
        const session = await sessionManager.getOrCreate(sessionId);
        const activeId = session.activeSkillId;
        if (activeId && skills.has(activeId)) {
            const skill = skills.get(activeId)!;
            const name = i18n.resolve(skill.name);
            const desc = i18n.resolve(skill.description) || i18n.t('cmd.skill.list.noDesc', 'No description');
            return i18n.t('cmd.skill.info.active', '🔧 Active skill: **{name}** `{id}` — {desc}', {
                name,
                id: activeId,
                desc
            });
        }
        return i18n.t('cmd.skill.info.none', '🔧 No skill is currently active.');
    };

    const handleList = async (): Promise<string> => {
        const activeSkills = Array.from(skills.values()).filter((s) => s.enabled !== false);
        if (activeSkills.length === 0) {
            return i18n.t('cmd.skill.list.empty', '📋 No available skills.');
        }
        const noDesc = i18n.t('cmd.skill.list.noDesc', 'No description');
        const lines = activeSkills.map((s) => {
            const name = i18n.resolve(s.name);
            const desc = i18n.resolve(s.description) || noDesc;
            return `- **${name}** \`${s.id}\` — ${desc}`;
        }).join('\n');
        return i18n.t('cmd.skill.list.title', '### 📋 Available Skills') + '\n\n' + lines;
    };

    const handleSet = async (skillId: string, sessionId: string): Promise<string> => {
        if (!skillId) {
            return i18n.t('cmd.skill.set.missingId', '❌ Usage: `/skill set <skillId>`.');
        }
        const skill = skills.get(skillId);
        if (!skill || skill.enabled === false) {
            return i18n.t('cmd.skill.set.notFound', '❌ Skill `{id}` does not exist or is not enabled. Use `/skill list` to view available skills.', { id: skillId });
        }
        await sessionManager.updateSession(sessionId, { activeSkillId: skillId });
        const name = i18n.resolve(skill.name);
        return i18n.t('cmd.skill.set.success', '✅ Skill activated: **{name}** `{id}`.', { name, id: skillId });
    };

    const handleClear = async (sessionId: string): Promise<string> => {
        await sessionManager.updateSession(sessionId, { activeSkillId: undefined });
        return i18n.t('cmd.skill.clear.success', '✅ Skill binding deactivated.');
    };

    commands.register({
        name: 'skill',
        description: i18n.all('cmd.skill.description', 'Skill management'),
        subcommands: [
            { name: 'info', description: i18n.all('cmd.skill.sub.info', 'Show current active skill') },
            { name: 'list', description: i18n.all('cmd.skill.sub.list', 'List all available skills') },
            { name: 'set', description: i18n.all('cmd.skill.sub.set', 'Activate a specified skill'), usage: '/skill set <skillId>' },
            { name: 'clear', description: i18n.all('cmd.skill.sub.clear', 'Deactivate current skill binding') },
        ],
        execute: async (args, sessionId) => {
            const sub = (args[0] || 'info').toLowerCase();

            switch (sub) {
                case 'info':
                    return await handleInfo(sessionId);

                case 'list':
                    return await handleList();

                case 'set': {
                    const skillId = args[1];
                    return await handleSet(skillId, sessionId);
                }

                case 'clear':
                    return await handleClear(sessionId);

                default: {
                    if (args[0]) {
                        return await handleSet(args[0], sessionId);
                    }
                    return await handleInfo(sessionId);
                }
            }
        }
    });
}
