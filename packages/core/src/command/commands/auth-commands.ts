import type { EventBus, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export interface AuthCommandDeps {
    commands: FreyaCommandRegistry;
    eventBus: EventBus;
    context: FreyaContext;
}

export function registerAuthCommands(deps: AuthCommandDeps): void {
    const { commands, eventBus, context } = deps;
    const i18n = new I18n({ zh, en }, context);

    commands.register({
        name: 'approve',
        description: i18n.all('cmd.approve.description', 'Approve a sensitive configuration read/write operation initiated by the AI model'),
        execute: async (args) => {
            const authId = args[0];
            if (!authId) {
                return i18n.t('cmd.approve.missingId', '❌ Error: Please specify the authorization request ID (e.g. `/approve auth_xxxx`).');
            }
            eventBus.emit('config:auth_response', { authId, approved: true });
            return i18n.t('cmd.approve.sent', 'ℹ️ Authorization command sent: approved request `{authId}`.', { authId });
        }
    });

    commands.register({
        name: 'reject',
        description: i18n.all('cmd.reject.description', 'Reject a sensitive configuration read/write operation initiated by the AI model'),
        execute: async (args) => {
            const authId = args[0];
            if (!authId) {
                return i18n.t('cmd.reject.missingId', '❌ Error: Please specify the authorization request ID (e.g. `/reject auth_xxxx`).');
            }
            eventBus.emit('config:auth_response', { authId, approved: false });
            return i18n.t('cmd.reject.sent', 'ℹ️ Authorization command sent: rejected request `{authId}`.', { authId });
        }
    });
}
