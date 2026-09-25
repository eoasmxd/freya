import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaContext } from '@eoasmxd/freya-sdk';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export interface HelpCommandsDeps {
    commands: FreyaCommandRegistry;
    context: FreyaContext;
}

export function registerHelpCommands(deps: HelpCommandsDeps): void {
    const { commands, context } = deps;
    const i18n = new I18n({ zh, en }, context);

    commands.register({
        name: 'help',
        description: i18n.all('cmd.help.description', 'List all available commands and their descriptions'),
        execute: async () => {
            const all = commands.list();
            if (all.length === 0) {
                return i18n.t('cmd.help.empty', 'ℹ️ No commands are currently registered.');
            }

            const aliasLabel = i18n.t('cmd.help.aliasLabel', 'aliases');
            const usageLabel = i18n.t('cmd.help.usageLabel', 'usage');

            const lines = all
                .sort((a, b) => a.name.localeCompare(b.name))
                .flatMap((cmd) => {
                    const desc = i18n.resolve(cmd.description);
                    const aliases = cmd.alias && cmd.alias.length > 0
                        ? ` *(${aliasLabel}: ${cmd.alias.map((a) => `\`${a}\``).join(', ')})*`
                        : '';
                    const header = `- **\`/${cmd.name}\`**${aliases} — ${desc}`;

                    if (cmd.subcommands && cmd.subcommands.length > 0) {
                        const subLines = cmd.subcommands.map((sub) => {
                            const subDesc = i18n.resolve(sub.description);
                            const usage = sub.usage ? ` (${usageLabel}: \`${sub.usage}\`)` : '';
                            return `  - \`${sub.name}\` — ${subDesc}${usage}`;
                        });
                        return [header, ...subLines];
                    }
                    return [header];
                });

            return i18n.t('cmd.help.title', '### ℹ️ Available Commands ({count} total)', { count: all.length })
                + '\n\n' + lines.join('\n');
        }
    });
}
