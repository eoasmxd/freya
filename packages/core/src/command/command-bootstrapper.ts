import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../session/session-manager.js';
import type { FreyaSkillRegistry } from '../skill/skill-registry.js';
import { FreyaCommandRegistry } from './command-registry.js';

import { registerAuthCommands } from './commands/auth-commands.js';
import { registerHelpCommands } from './commands/help-commands.js';
import { registerModelCommands } from './commands/model-commands.js';
import { registerSessionCommands } from './commands/session-commands.js';
import { registerSkillCommands } from './commands/skill-commands.js';
import { registerStopCommands } from './commands/stop-commands.js';

export interface CommandBootstrapperDeps {
    registry: FreyaCommandRegistry;
    context: FreyaContext;
    skillRegistry: FreyaSkillRegistry;
    sessionManager: FreyaSessionManager;
}

export class CommandBootstrapper {
    static registerBuiltinCommands(deps: CommandBootstrapperDeps): void {
        const { registry, context, skillRegistry, sessionManager } = deps;
        const { eventBus } = context;

        registerSessionCommands({ commands: registry, sessionManager, eventBus });
        registerModelCommands({ commands: registry, sessionManager, context });
        registerSkillCommands({ commands: registry, sessionManager, skills: skillRegistry.getSkills() });
        registerStopCommands({ commands: registry, eventBus });
        registerAuthCommands({ commands: registry, eventBus });
        registerHelpCommands({ commands: registry });
    }
}
