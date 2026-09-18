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
  /** 程序物理安装根目录（只读系统源码与内置资源区） */
  appRoot: string;
  /** 运行态持久化主目录（用户配置与持久化存储入口，默认 ~/.freya） */
  homeDir: string;
  /** 宿主命令启动执行目录（默认启动路径 process.cwd()） */
  launchDir: string;
  /** 运行时数据持久化目录（~/.freya/data） */
  dataDir: string;
  /** 智能体专属文件读写工作区（默认为 ~/.freya/workspace，可由配置覆盖） */
  workspaceDir: string;
}

export interface FreyaContext {
  eventBus: EventBus;
  logger: Logger;
  readonly config: Readonly<Record<string, any>>;
  llm: ILLMService;
  paths: FreyaPaths;
}
