import type { FreyaSkill } from '../../skill/skill-registry.js';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';

export interface SkillCommandDeps {
    commands: FreyaCommandRegistry;
    sessionManager: FreyaSessionManager;
    skills: Map<string, FreyaSkill>;
}

export function registerSkillCommands(deps: SkillCommandDeps): void {
    const { commands, sessionManager, skills } = deps;

    const handleInfo = async (sessionId: string): Promise<string> => {
        const session = await sessionManager.getOrCreate(sessionId);
        const activeId = session.activeSkillId;
        if (activeId && skills.has(activeId)) {
            const skill = skills.get(activeId)!;
            return `🔧 当前激活技能: **${skill.name}** \`${activeId}\` — ${skill.description || ''}`;
        }
        return '🔧 当前未激活任何技能。';
    };

    const handleList = async (): Promise<string> => {
        if (skills.size === 0) {
            return '📋 暂无可用技能。';
        }
        const lines = Array.from(skills.values()).map((s) =>
            `- **${s.name}** — ${s.description || '无描述'}`
        ).join('\n');
        return `### 📋 可用技能\n\n${lines}`;
    };

    const handleSet = async (skillId: string, sessionId: string): Promise<string> => {
        if (!skillId) {
            return '❌ 用法：`\`/skill set <skillId>\``。';
        }
        const skill = skills.get(skillId);
        if (!skill) {
            return `❌ 技能 \`${skillId}\` 不存在。请使用 \`/skill list\` 查看可用技能。`;
        }
        await sessionManager.updateSession(sessionId, { activeSkillId: skillId });
        return `✅ 已激活技能: **${skill.name}** \`${skillId}\`。`;
    };

    const handleClear = async (sessionId: string): Promise<string> => {
        await sessionManager.updateSession(sessionId, { activeSkillId: undefined });
        return '✅ 已解除技能绑定。';
    };

    commands.register({
        name: 'skill',
        description: '技能管理',
        subcommands: [
            { name: 'info', description: '查看当前激活的技能' },
            { name: 'list', description: '列出所有可用技能' },
            { name: 'set', description: '激活指定技能', usage: '/skill set <skillId>' },
            { name: 'clear', description: '解除技能绑定' },
        ],
        execute: async (args, sessionId, ctx) => {
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
