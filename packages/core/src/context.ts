import type {
  EventBus,
  FreyaContext,
  FreyaPaths,
  ILLMService,
  Logger,
} from '@eoasmxd/freya-sdk';
import path from 'node:path';
import { APP_ROOT, PROJECT_ROOT } from './utils/paths.js';

export class DefaultFreyaContext implements FreyaContext {
  logger!: Logger;
  eventBus!: EventBus;
  config: Readonly<Record<string, any>> = {};
  llm!: ILLMService;
  get paths(): FreyaPaths {
    const configWorkspace = this.config?.workspace;
    let workspaceDir = path.join(PROJECT_ROOT, 'workspace');
    if (configWorkspace && typeof configWorkspace === 'string') {
      workspaceDir = path.isAbsolute(configWorkspace)
        ? configWorkspace
        : path.resolve(PROJECT_ROOT, configWorkspace);
    }

    return {
      appRoot: APP_ROOT,
      projectRoot: PROJECT_ROOT,
      dataDir: path.join(PROJECT_ROOT, 'data'),
      workspaceDir,
    };
  }
}
