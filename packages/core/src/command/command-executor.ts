import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaCommandRegistry } from './command-registry.js';

/** 指令执行器：解析控制台/网络消息行并调度执行注册的系统指令 */
export class FreyaCommandExecutor {
  constructor(
    private context: FreyaContext,
    private registry: FreyaCommandRegistry
  ) { }

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
        message: `❌ 未知指令 "/${commandName}"，您可以输入 "/help" 查看所有可用指令。`
      });
      return true;
    }

    try {
      const replyContent = await cmd.execute(args, sessionId, this.context, connectionId);
      if (replyContent) {
        this.context.eventBus.emit('session:reply:text', { sessionId, content: replyContent });
      }
    } catch (err: any) {
      this.context.logger.error(`指令 /${commandName} 执行异常:`, err);
      this.context.eventBus.emit('session:reply:error', {
        sessionId,
        message: `❌ 指令执行失败: ${err.message || err}`
      });
    }

    return true;
  }
}
