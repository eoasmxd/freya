import type { ILLMService } from './llm.js';

export interface EventBus {
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

export interface FreyaPaths {
  /** 程序物理安装根目录（只读代码与程序级静态资源区） */
  appRoot: string;
  /** 运行态主目录（用户个性化配置与持久化数据区，默认 ~/.freya） */
  projectRoot: string;
  /** 运行时数据持久化目录（~/.freya/data） */
  dataDir: string;
  /** 宿主与大模型交互隔离的文件读写沙箱（~/.freya/workspace） */
  workspaceDir: string;
}

export interface FreyaContext {
  eventBus: EventBus;
  logger: Logger;
  readonly config: Readonly<Record<string, any>>;
  llm: ILLMService;
  paths: FreyaPaths;
}
