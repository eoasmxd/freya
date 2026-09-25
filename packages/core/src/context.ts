import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ConnectionInfo,
  EventBus,
  FreyaContext,
  FreyaPaths,
  ILLMService,
  Logger,
} from '@eoasmxd/freya-sdk';
import path from 'node:path';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from './utils/paths.js';

export const currentConnectionStorage = new AsyncLocalStorage<ConnectionInfo>();

export function detectSystemLanguage(): string {
  const envLang = (process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
  if (envLang.startsWith('zh')) return 'zh';
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (locale.startsWith('zh')) return 'zh';
  } catch { }
  return 'en';
}

export class DefaultFreyaContext implements FreyaContext {
  logger!: Logger;
  eventBus!: EventBus;
  config: Readonly<Record<string, any>> = {};
  llm!: ILLMService;

  getLanguage(defaultLang?: string): string {
    const configLang = this.config?.system?.language;
    if (configLang && configLang !== 'auto') {
      return configLang.toLowerCase();
    }
    const currentConn = currentConnectionStorage.getStore();
    if (currentConn?.language && currentConn.language !== 'auto') {
      return currentConn.language.toLowerCase();
    }
    if (defaultLang && defaultLang !== 'auto') {
      return defaultLang.toLowerCase();
    }
    return detectSystemLanguage();
  }

  getConnection(): ConnectionInfo | undefined {
    return currentConnectionStorage.getStore();
  }

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
