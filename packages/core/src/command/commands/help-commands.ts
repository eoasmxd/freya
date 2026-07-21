import type { FreyaCommandRegistry } from '../command-registry.js';

export interface HelpCommandsDeps {
    commands: FreyaCommandRegistry;
}

export function registerHelpCommands(deps: HelpCommandsDeps): void {
    const { commands } = deps;

    commands.register({
        name: 'help',
        description: '列出所有可用指令及说明',
        execute: async () => {
            const all = commands.list();
            if (all.length === 0) {
                return 'ℹ️ 当前没有任何注册的指令。';
            }

            const lines = all
                .sort((a, b) => a.name.localeCompare(b.name))
                .flatMap((cmd) => {
                    const aliases = cmd.alias && cmd.alias.length > 0
                        ? ` *(别名: ${cmd.alias.map((a) => `\`${a}\``).join(', ')})*`
                        : '';
                    const header = `- **\`/${cmd.name}\`**${aliases} — ${cmd.description}`;

                    if (cmd.subcommands && cmd.subcommands.length > 0) {
                        const subLines = cmd.subcommands.map((sub) => {
                            const usage = sub.usage ? ` (用法: \`${sub.usage}\`)` : '';
                            return `  - \`${sub.name}\` — ${sub.description}${usage}`;
                        });
                        return [header, ...subLines];
                    }
                    return [header];
                });

            return `### ℹ️ 可用指令列表（共 ${all.length} 条）\n\n${lines.join('\n')}`;
        }
    });
}
