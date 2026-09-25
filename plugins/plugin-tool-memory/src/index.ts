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
      ctx.logger.info('Active memory multi-file persistence storage ready.');
    } catch (err: any) {
      ctx.logger.error('Failed to initialize active memory persistence storage:', err);
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
