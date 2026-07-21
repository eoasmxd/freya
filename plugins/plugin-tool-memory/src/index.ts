import type { FreyaContext, ToolPlugin, FreyaTool } from '@eoasmxd/freya-sdk';
import { AddMemoryTool, DeleteMemoryTool, ensureIndexFile, ensureSubdirExists, QueryMemoryTool } from './tools.js';

export default class MemoryToolsPlugin implements ToolPlugin {
  type = 'tool' as const;

  private tools: FreyaTool[] = [];

  async setup(ctx: FreyaContext): Promise<void> {
    this.tools = [
      new AddMemoryTool(),
      new QueryMemoryTool(),
      new DeleteMemoryTool()
    ];

    try {
      await ensureIndexFile(ctx.paths.dataDir);
      await ensureSubdirExists(ctx.paths.dataDir);
      ctx.logger.info('主动记忆多文件持久化存储已就绪。');
    } catch (err: any) {
      ctx.logger.error('初始化主动记忆多文件持久化存储失败:', err);
    }
  }

  getId(): string {
    return 'memory';
  }

  getInstructionPrompt(): string {
    return 'plugin.prompt.memory';
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }
}
