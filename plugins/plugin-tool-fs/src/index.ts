import type { FreyaContext, ToolPlugin, FreyaTool } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import { EditFileTool, ListDirTool, ReadFileTool, WriteFileTool } from './tools.js';

export default class FsToolsPlugin implements ToolPlugin {
  type = 'tool' as const;

  private tools: FreyaTool[] = [];

  async setup(ctx: FreyaContext): Promise<void> {
    this.tools = [
      new ListDirTool(),
      new ReadFileTool(),
      new WriteFileTool(),
      new EditFileTool()
    ];

    const workspaceAbs = ctx.paths.workspaceDir;

    try {
      await fs.mkdir(workspaceAbs, { recursive: true });
      ctx.logger.info(`工作区目录已就绪: "${workspaceAbs}"`);
    } catch (err: any) {
      ctx.logger.error(`创建工作区目录失败: "${workspaceAbs}"`, err);
    }
  }

  getId(): string {
    return 'fs';
  }

  getInstructionPrompt(): string {
    return 'plugin.prompt.fs';
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }
}

export const Plugin = FsToolsPlugin;
