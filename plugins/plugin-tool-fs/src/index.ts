import type { FreyaContext, ToolPlugin, FreyaTool } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import { EditFileTool, ListDirectoryTool, ReadAttachmentTool, ReadFileTool, WriteFileTool } from './tools.js';

export default class FsToolsPlugin implements ToolPlugin {
  type = 'tool' as const;

  private tools: FreyaTool[] = [];

  async setup(ctx: FreyaContext): Promise<void> {
    this.tools = [
      new ListDirectoryTool(ctx),
      new ReadFileTool(ctx),
      new ReadAttachmentTool(ctx),
      new WriteFileTool(ctx),
      new EditFileTool(ctx)
    ];

    const workspaceAbs = ctx.paths.workspaceDir;

    try {
      await fs.mkdir(workspaceAbs, { recursive: true });
      ctx.logger.info(`Workspace directory ready: "${workspaceAbs}"`);
    } catch (err: any) {
      ctx.logger.error(`Failed to create workspace directory: "${workspaceAbs}"`, err);
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
