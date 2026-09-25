import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

export interface ModelCommandDeps {
    commands: FreyaCommandRegistry;
    sessionManager: FreyaSessionManager;
    context: FreyaContext;
}

export function registerModelCommands(deps: ModelCommandDeps): void {
    const { commands, sessionManager, context } = deps;
    const i18n = new I18n({ zh, en }, context);

    const handleInfo = async (sessionId: string): Promise<string> => {
        const session = await sessionManager.getOrCreate(sessionId);
        const { providerId, modelId } = session;
        if (modelId) {
            const provider = providerId || i18n.t('cmd.model.info.defaultProvider', 'default');
            return i18n.t('cmd.model.info.bound', '🔧 Current session bound model: `{modelId}` (Provider: `{provider}`).', { modelId, provider });
        }
        return i18n.t('cmd.model.info.default', '🔧 Current session has no specific model bound; system default model will be used.');
    };

    const handleList = (): string => {
        const modelsConfig = context.config.models;
        if (!modelsConfig || typeof modelsConfig !== 'object') {
            return i18n.t('cmd.model.list.noneConfigured', '❌ No models are configured yet. Please configure the `models` field in Web settings or `config/freya.json`.');
        }

        const categories: { label: string; key: string }[] = [
            { label: i18n.t('cmd.model.list.categoryDefault', 'Default'), key: 'default' },
            { label: i18n.t('cmd.model.list.categoryImage', 'Image'), key: 'image' },
            { label: i18n.t('cmd.model.list.categoryAudio', 'Audio'), key: 'audio' },
        ];

        const allLines: string[] = [];
        for (const cat of categories) {
            const items = modelsConfig[cat.key];
            if (Array.isArray(items) && items.length > 0) {
                for (const m of items) {
                    const id = m.model || m.id || '?';
                    const name = m.name || id;
                    allLines.push(`- **[${cat.label}]** ${name} (\`${id}\`)`);
                }
            }
        }

        if (allLines.length === 0) {
            return i18n.t('cmd.model.list.empty', 'ℹ️ No enabled models found in `models` configuration.');
        }

        return i18n.t('cmd.model.list.title', '### 📋 Configured Models (from `config/freya.json`)') + `\n\n${allLines.join('\n')}`;
    };

    const handleSet = async (args: string[], sessionId: string): Promise<string> => {
        const arg1 = args[1];
        const arg2 = args[2];
        
        let providerId: string | undefined = undefined;
        let modelId: string | undefined = undefined;

        if (!arg1) {
            return i18n.t('cmd.model.set.usage', '❌ Usage: `/model set <modelId>` or `/model set <providerId> <modelId>`.');
        }

        if (arg2) {
            providerId = arg1;
            modelId = arg2;
        } else {
            modelId = arg1;
        }

        const defaultModels: { provider: string; model: string; name: string }[] = [];
        const modelsConfig = context.config.models;
        if (modelsConfig && typeof modelsConfig === 'object') {
            const items = modelsConfig.default;
            if (Array.isArray(items)) {
                for (const m of items) {
                    const id = m.model || m.id;
                    const p = m.provider || '';
                    const n = m.name || id;
                    if (id) {
                        defaultModels.push({ provider: p, model: id, name: n });
                    }
                }
            }
        }

        if (defaultModels.length === 0) {
            return i18n.t('cmd.model.set.chainEmpty', '❌ No models are configured in the system default model fallback chain.');
        }

        if (providerId) {
            const matched = defaultModels.find((m) => m.provider === providerId && m.model === modelId);
            if (!matched) {
                return i18n.t('cmd.model.set.notFound', '❌ Model `{modelId}` (Provider: `{providerId}`) was not found in default model configuration.', { modelId, providerId });
            }
        } else {
            const matches = defaultModels.filter((m) => m.model === modelId);
            if (matches.length === 0) {
                const hint = defaultModels.slice(0, 5).map((m) => `\`${m.model}\``).join(', ');
                const more = defaultModels.length > 5
                    ? i18n.t('cmd.model.set.moreCount', ' ... and {count} more', { count: defaultModels.length })
                    : '';
                return i18n.t('cmd.model.set.notFoundHint', '❌ Model `{modelId}` was not found in default model configuration. Available models: {hint}{more}.', { modelId, hint, more });
            } else if (matches.length > 1) {
                const providers = matches.map((m) => `\`${m.provider}\``).join(', ');
                return i18n.t('cmd.model.set.duplicateHint', '❌ Ambiguous model name exists. Please use `/model set <providerId> <modelId>` to specify provider explicitly. Available providers: {providers}.', { providers });
            } else {
                providerId = matches[0].provider;
            }
        }

        await sessionManager.updateSession(sessionId, { providerId, modelId });
        const provider = providerId || i18n.t('cmd.model.info.defaultProvider', 'default');
        return i18n.t('cmd.model.set.success', '🔧 Session model changed to: `{modelId}` (Provider: `{provider}`).', { modelId, provider });
    };

    const handleReset = async (sessionId: string): Promise<string> => {
        await sessionManager.updateSession(sessionId, { providerId: undefined, modelId: undefined });
        return i18n.t('cmd.model.reset.success', '🔧 Model binding removed, restored to default.');
    };

    commands.register({
        name: 'model',
        description: i18n.all('cmd.model.description', 'Model management'),
        subcommands: [
            { name: 'info', description: i18n.all('cmd.model.sub.info', 'View the model bound to the current session') },
            { name: 'list', description: i18n.all('cmd.model.sub.list', 'List all configured models') },
            { name: 'set', description: i18n.all('cmd.model.sub.set', 'Set the model bound to the current session'), usage: '/model set <modelId>' },
            { name: 'reset', description: i18n.all('cmd.model.sub.reset', 'Unbind the model and revert to default') },
        ],
        execute: async (args, sessionId) => {
            const sub = (args[0] || 'info').toLowerCase();

            switch (sub) {
                case 'info':
                    return await handleInfo(sessionId);

                case 'list':
                    return handleList();

                case 'set':
                    return await handleSet(args, sessionId);

                case 'reset':
                    return await handleReset(sessionId);

                default:
                    if (args[0]) {
                        return await handleSet(['set', ...args], sessionId);
                    }
                    return await handleInfo(sessionId);
            }
        }
    });

    commands.register({
        name: 'models',
        description: i18n.all('cmd.models.description', 'List all configured models'),
        execute: async () => {
            return handleList();
        }
    });
}
