import type { EventBus } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from '../command-registry.js';

export interface StopCommandsDeps {
    commands: FreyaCommandRegistry;
    eventBus: EventBus;
}

export function registerStopCommands(deps: StopCommandsDeps): void {
    const { commands, eventBus } = deps;

    commands.register({
        name: 'stop',
        description: '中止大模型当前生成',
        execute: async (_args, sessionId, _ctx) => {
            eventBus.emit('session:interrupt', { sessionId });
            return 'ℹ️ 中断信号已发出。';
        }
    });
}
