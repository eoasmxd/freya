import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from './command-registry.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

/**
 * 指令执行器：解析控制台/网络消息行并调度执行注册的系统指令
 * Command executor: parses terminal/network message lines and dispatches registered system commands
 */
export class FreyaCommandExecutor {
  private readonly i18n: I18n;

  constructor(
    private context: FreyaContext,
    private registry: FreyaCommandRegistry
  ) {
    this.i18n = new I18n({ zh, en }, context);
  }

  async executeLine(
    line: string,
    sessionId: string,
    connectionId?: string
  ): Promise<boolean> {
    const text = line.trim();
    if (!text.startsWith('/') || text === '/') {
      return false;
    }

    const commandText = text.slice(1);
    const parts = commandText.split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const cmd = this.registry.get(commandName);
    if (!cmd) {
      this.context.eventBus.emit('session:reply:error', {
        sessionId,
        message: this.i18n.t(
          'cmd.error.unknown',
          '❌ Unknown command "/{commandName}". Type "/help" to view all available commands.',
          { commandName }
        )
      });
      return true;
    }

    if (!this.registry.isCommandEnabled(commandName)) {
      this.context.eventBus.emit('session:reply:error', {
        sessionId,
        message: this.i18n.t(
          'cmd.error.disabled',
          '❌ Permission denied: Command "/{commandName}" is disabled by administrator.',
          { commandName }
        )
      });
      return true;
    }

    try {
      const replyContent = await cmd.execute(args, sessionId, this.context, connectionId);
      if (replyContent) {
        this.context.eventBus.emit('session:reply:text', { sessionId, content: replyContent });
      }
    } catch (err: any) {
      this.context.logger.error(`Error executing command /${commandName}:`, err);
      this.context.eventBus.emit('session:reply:error', {
        sessionId,
        message: this.i18n.t(
          'cmd.error.executionFailed',
          '❌ Command execution failed: {message}',
          { message: err.message || String(err) }
        )
      });
    }

    return true;
  }
}
