import type {
  EventBus,
  FreyaContext,
  FreyaPaths,
  ILLMService,
  Logger,
} from '@eoasmxd/freya-sdk';
import path from 'node:path';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from './utils/paths.js';

export class DefaultFreyaContext implements FreyaContext {
  logger!: Logger;
  eventBus!: EventBus;
  config: Readonly<Record<string, any>> = {};
  llm!: ILLMService;
  get paths(): FreyaPaths {
    const configWorkspace = this.config?.workspace;
    let workspaceDir = path.join(FREYA_HOME, 'workspace');
    if (configWorkspace && typeof configWorkspace === 'string') {
      workspaceDir = path.isAbsolute(configWorkspace)
        ? configWorkspace
        : path.resolve(FREYA_HOME, configWorkspace);
    }

    return {
      appRoot: FREYA_APP,
      homeDir: FREYA_HOME,
      launchDir: FREYA_LAUNCH,
      dataDir: path.join(FREYA_HOME, 'data'),
      workspaceDir,
    };
  }
}
