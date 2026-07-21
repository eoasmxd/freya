import type { EventBus } from '@eoasmxd/freya-sdk';
import { EventEmitter } from 'node:events';

/** 基于 Node EventEmitter 的进程内事件总线，支持注册类事件缓冲区重播 */
export class FreyaEventBus implements EventBus {
  private emitter = new EventEmitter();
  private replayBuffers = new Map<string, any[][]>();

  on(event: string, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);

    const buffer = this.replayBuffers.get(event);
    if (buffer) {
      for (const args of buffer) {
        setImmediate(() => {
          listener(...args);
        });
      }
    }
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.emitter.off(event, listener);
  }

  emit(event: string, ...args: any[]): void {
    this.emitter.emit(event, ...args);

    const shouldBuffer = event.includes('register') || event.includes('init');
    if (shouldBuffer) {
      if (!this.replayBuffers.has(event)) {
        this.replayBuffers.set(event, []);
      }
      this.replayBuffers.get(event)!.push(args);
    }
  }
}
