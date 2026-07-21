import type { EventBus } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';

export interface AuthCommandDeps {
    commands: FreyaCommandRegistry;
    eventBus: EventBus;
}

export function registerAuthCommands(deps: AuthCommandDeps): void {
    const { commands, eventBus } = deps;

    commands.register({
        name: 'approve',
        description: '批准大模型发起的敏感配置读写操作',
        execute: async (args, _sessionId, _ctx) => {
            const authId = args[0];
            if (!authId) {
                return '❌ 错误：请指定授权申请 ID（如: `/approve auth_xxxx`）。';
            }
            eventBus.emit('config:auth_response', { authId, approved: true });
            return `ℹ️ 授权指令已发出：同意批准申请 \`${authId}\`。`;
        }
    });

    commands.register({
        name: 'reject',
        description: '拒绝大模型发起的敏感配置读写操作',
        execute: async (args, _sessionId, _ctx) => {
            const authId = args[0];
            if (!authId) {
                return '❌ 错误：请指定授权申请 ID（如: `/reject auth_xxxx`）。';
            }
            eventBus.emit('config:auth_response', { authId, approved: false });
            return `ℹ️ 授权指令已发出：拒绝申请 \`${authId}\`。`;
        }
    });
}
