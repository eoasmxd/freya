import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';

export interface ModelCommandDeps {
    commands: FreyaCommandRegistry;
    sessionManager: FreyaSessionManager;
    context: FreyaContext;
}

export function registerModelCommands(deps: ModelCommandDeps): void {
    const { commands, sessionManager, context } = deps;

    const handleInfo = async (sessionId: string): Promise<string> => {
        const session = await sessionManager.getOrCreate(sessionId);
        const { providerId, modelId } = session;
        if (modelId) {
            return `🔧 当前会话绑定模型: \`${modelId}\` (提供商: \`${providerId || '默认'}\`)。`;
        }
        return '🔧 当前会话未绑定指定模型，将使用系统默认模型。';
    };

    const handleList = (): string => {
        const modelsConfig = context.config.models;
        if (!modelsConfig || typeof modelsConfig !== 'object') {
            return '❌ 系统尚未配置任何模型，请在 Web 设置页面或 `config/freya.json` 中配置 `models` 字段。';
        }

        const categories: { label: string; key: string }[] = [
            { label: '默认', key: 'default' },
            { label: '图像', key: 'image' },
            { label: '音频', key: 'audio' },
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
            return 'ℹ️ `models` 配置中没有已启用的模型。';
        }

        return `### 📋 已配置模型（来自 \`config/freya.json\`）\n\n${allLines.join('\n')}`;
    };

    const handleSet = async (args: string[], sessionId: string): Promise<string> => {
        const arg1 = args[1];
        const arg2 = args[2];
        
        let providerId: string | undefined = undefined;
        let modelId: string | undefined = undefined;

        if (!arg1) {
            return '❌ 用法：`\`/model set <modelId>\`` 或 `\`/model set <providerId> <modelId>\``。';
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
            return '❌ 系统 default 模型降级链中尚未配置任何模型。';
        }

        if (providerId) {
            const matched = defaultModels.find((m) => m.provider === providerId && m.model === modelId);
            if (!matched) {
                return `❌ 模型 \`${modelId}\` (提供商: \`${providerId}\`) 未在 default 模型配置中找到。`;
            }
        } else {
            const matches = defaultModels.filter((m) => m.model === modelId);
            if (matches.length === 0) {
                const hint = defaultModels.slice(0, 5).map((m) => `\`${m.model}\``).join(', ');
                const more = defaultModels.length > 5 ? ` ... 等 ${defaultModels.length} 个` : '';
                return `❌ 模型 \`${modelId}\` 未在 default 模型配置中找到。可用模型：${hint}${more}。`;
            } else if (matches.length > 1) {
                const providersHint = matches.map((m) => `\`${m.provider}\``).join(', ');
                return `❌ 存在重名模型，请使用 \`/model set <providerId> <modelId>\` 明确指定提供商。可选的提供商为：${providersHint}。`;
            } else {
                providerId = matches[0].provider;
            }
        }

        await sessionManager.updateSession(sessionId, { providerId, modelId });
        return `🔧 已将会话绑定模型改为: \`${modelId}\` (提供商: \`${providerId || '默认'}\`)。`;
    };

    const handleReset = async (sessionId: string): Promise<string> => {
        await sessionManager.updateSession(sessionId, { providerId: undefined, modelId: undefined });
        return '🔧 已解除模型绑定，恢复默认。';
    };

    commands.register({
        name: 'model',
        description: '模型管理',
        subcommands: [
            { name: 'info', description: '查看当前会话绑定的模型' },
            { name: 'list', description: '列出所有已配置的模型' },
            { name: 'set', description: '设置当前会话绑定的模型', usage: '/model set <modelId>' },
            { name: 'reset', description: '解除模型绑定，恢复默认' },
        ],
        execute: async (args, sessionId, ctx) => {
            const sub = (args[0] || 'info').toLowerCase();

            switch (sub) {
                case 'info':
                    return await handleInfo(sessionId);

                case 'list':
                    return await handleList();

                case 'set': {
                    return await handleSet(args, sessionId);
                }

                case 'reset':
                    return await handleReset(sessionId);

                default: {
                    if (args[0]) {
                        return await handleSet(['set', ...args], sessionId);
                    }
                    return await handleInfo(sessionId);
                }
            }
        }
    });

    commands.register({
        name: 'models',
        description: '列出所有已配置的模型',
        execute: async () => {
            return handleList();
        }
    });
}
