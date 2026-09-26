import type { EventBus, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export interface StopCommandsDeps {
    commands: FreyaCommandRegistry;
    eventBus: EventBus;
    context: FreyaContext;
}

export function registerStopCommands(deps: StopCommandsDeps): void {
    const { commands, eventBus, context } = deps;
    const i18n = new I18n({ zh, en }, context);

    commands.register({
        name: 'stop',
        description: i18n.all('cmd.stop.description', 'Abort the current AI model generation'),
        execute: async (_args, sessionId) => {
            eventBus.emit('session:interrupt', { sessionId });
            return i18n.t('cmd.stop.sent', 'ℹ️ Interrupt signal sent.');
        }
    });
}
