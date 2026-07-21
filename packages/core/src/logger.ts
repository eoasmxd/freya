import type { Logger } from '@eoasmxd/freya-sdk';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { PROJECT_ROOT } from './utils/paths.js';

/** 双轨日志器：按日期滚动写入文件，按配置输出至控制台 */
export class FreyaLogger implements Logger {
  private readonly logsDir: string;
  private consoleLevels = {
    error: true,
    warn: false,
    info: false,
    debug: false
  };

  private currentDay = '';
  private currentLogFilePath = '';

  constructor() {
    this.logsDir = path.join(PROJECT_ROOT, 'logs');
    fs.mkdirSync(this.logsDir, { recursive: true });
  }

  /** 设置各日志级别是否输出至控制台 */
  setConsoleLevel(levels: { error?: boolean; warn?: boolean; info?: boolean; debug?: boolean }): void {
    this.consoleLevels = { ...this.consoleLevels, ...levels };
  }

  private get logFile(): string {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.currentLogFilePath = path.join(this.logsDir, `${today}.log`);
    }
    return this.currentLogFilePath;
  }

  private format(level: string, message: string, args: any[]): string {
    const ts = new Date().toISOString();
    const extras = args.length > 0
      ? ' ' + args.map((a) => {
        if (a instanceof Error) {
          return a.stack || a.message;
        }
        return typeof a === 'object' ? inspect(a, { depth: 3, breakLength: Infinity }) : String(a);
      }).join(' ')
      : '';
    return `[${ts}] [${level}] ${message}${extras}`;
  }

  private write(line: string): void {
    fsPromises.appendFile(this.logFile, line + '\n', 'utf-8').catch(() => { });
  }

  info(message: string, ...args: any[]): void {
    const line = this.format('INFO ', message, args);
    if (this.consoleLevels.info) {
      console.log(`\x1b[32m${line}\x1b[0m`);
    }
    this.write(line);
  }

  warn(message: string, ...args: any[]): void {
    const line = this.format('WARN ', message, args);
    if (this.consoleLevels.warn) {
      console.warn(`\x1b[33m${line}\x1b[0m`);
    }
    this.write(line);
  }

  error(message: string, ...args: any[]): void {
    const line = this.format('ERROR', message, args);
    if (this.consoleLevels.error) {
      console.error(`\x1b[31m${line}\x1b[0m`);
    }
    this.write(line);
  }

  debug(message: string, ...args: any[]): void {
    const line = this.format('DEBUG', message, args);
    if (this.consoleLevels.debug) {
      console.debug(`\x1b[90m${line}\x1b[0m`);
    }
    this.write(line);
  }
}
