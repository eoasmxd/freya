import type { FreyaContext, ToolDefinition, FreyaTool } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

/** 安全工作区路径获取 (支持指定 scope 作用域) */
export function getSafePath(ctx: FreyaContext, relativePath: string, scope?: string): { targetAbs: string; baseAbs: string } {
  let baseAbs = ctx.paths.workspaceDir;
  if (scope === 'src') {
    baseAbs = path.join(ctx.paths.appRoot, 'src');
  } else if (scope === 'doc') {
    baseAbs = path.join(ctx.paths.appRoot, 'doc');
  }

  if (relativePath && path.isAbsolute(relativePath)) {
    throw new Error('安全拒绝：只能使用相对路径，不允许使用绝对路径。');
  }

  const targetAbs = path.resolve(baseAbs, relativePath || '.');
  const basePrefix = baseAbs.endsWith(path.sep) ? baseAbs : baseAbs + path.sep;

  if (targetAbs !== baseAbs && !targetAbs.startsWith(basePrefix)) {
    throw new Error(`安全越界拒绝：无法访问目标作用域外部的相对路径 "${relativePath}"。`);
  }

  return { targetAbs, baseAbs };
}

/** 屏蔽底层文件系统异常中携带的真实宿主机绝对路径 */
export function sanitizeError(err: any, baseAbs: string): string {
  const rawMessage = err?.message || String(err);
  const escapedWorkspace = baseAbs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedWorkspace + '[\\\\/]?', 'g');
  return rawMessage.replace(regex, '');
}

/** 统一文件系统错误处理与物理路径脱敏 */
export function handleFsError(ctx: FreyaContext, action: string, err: any, baseAbs?: string): string {
  const targetBase = baseAbs || ctx.paths.workspaceDir;
  return `❌ ${action}失败: ${sanitizeError(err, targetBase)}`;
}

/** 格式化文件大小 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export class ListDirTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'list_dir',
      description: '列出指定目录下的文件和子文件夹列表。注意：仅允许访问相对路径，不可传绝对路径或向上越级 escape 路径。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要查看的目录相对路径（可选，默认为根目录 "."）'
          },
          scope: {
            type: 'string',
            enum: ['workspace', 'src', 'doc'],
            description: '读取作用域（可选，默认为 "workspace" 沙箱，支持指定 "src" 源码区或 "doc" 文档区）'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    let baseAbs = ctx.paths.workspaceDir;
    try {
      const pathInfo = getSafePath(ctx, args.path || '.', args.scope);
      const targetAbs = pathInfo.targetAbs;
      baseAbs = pathInfo.baseAbs;

      const stats = await fs.stat(targetAbs);
      if (!stats.isDirectory()) {
        return `❌ 路径 "${args.path || '.'}" 不是一个有效的目录。`;
      }

      const entries = await fs.readdir(targetAbs, { withFileTypes: true });
      if (entries.length === 0) {
        return `ℹ️ 目录 "${args.path || '.'}" 为空。`;
      }

      const resultLines: string[] = [];
      for (const entry of entries) {
        const entryAbs = path.join(targetAbs, entry.name);
        if (entry.isDirectory()) {
          resultLines.push(`[目录] ${entry.name}`);
        } else {
          try {
            const entryStats = await fs.stat(entryAbs);
            resultLines.push(`[文件] ${entry.name} (${formatBytes(entryStats.size)})`);
          } catch {
            resultLines.push(`[文件] ${entry.name}`);
          }
        }
      }

      const scopeInfo = args.scope ? ` (${args.scope})` : '';
      return `ℹ️ 目录 "${args.path || '.'}"${scopeInfo} 内容如下：\n${resultLines.join('\n')}`;
    } catch (err: any) {
      return handleFsError(ctx, '列出目录', err, baseAbs);
    }
  }
}

export class ReadFileTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'read_file',
      description: '读取指定文件的文本内容。支持指定行号起止区间切片读取，防范大文件上下文超限。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目标文件的相对路径（如 "notes.txt"）'
          },
          scope: {
            type: 'string',
            enum: ['workspace', 'src', 'doc'],
            description: '读取作用域（可选，默认为 "workspace" 沙箱，支持指定 "src" 源码区或 "doc" 文档区）'
          },
          startLine: {
            type: 'integer',
            description: '起始行号（可选，1-indexed，包含该行。默认为第 1 行）'
          },
          endLine: {
            type: 'integer',
            description: '结束行号（可选，1-indexed，包含该行。默认读取至文件末尾）'
          }
        },
        required: ['path']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.path) {
      return '❌ 参数错误：必须指定目标文件相对路径。';
    }
    let baseAbs = ctx.paths.workspaceDir;
    try {
      const pathInfo = getSafePath(ctx, args.path, args.scope);
      const targetAbs = pathInfo.targetAbs;
      baseAbs = pathInfo.baseAbs;

      const stats = await fs.stat(targetAbs);
      if (!stats.isFile()) {
        return `❌ 路径 "${args.path}" 不是一个有效的文件。`;
      }

      const rawContent = await fs.readFile(targetAbs, 'utf-8');

      if (args.startLine === undefined && args.endLine === undefined) {
        return rawContent;
      }

      const lines = rawContent.split('\n');
      const totalLines = lines.length;

      const start = args.startLine !== undefined ? Math.max(1, parseInt(args.startLine, 10)) : 1;
      const end = args.endLine !== undefined ? Math.min(totalLines, parseInt(args.endLine, 10)) : totalLines;

      if (start > totalLines) {
        return `❌ 起始行号 (${start}) 超过了文件总行数 (${totalLines})。`;
      }

      if (start > end) {
        return `❌ 起始行号 (${start}) 不能大于结束行号 (${end})。`;
      }

      const slicedLines = lines.slice(start - 1, end);
      const scopeInfo = args.scope ? ` (${args.scope})` : '';
      return `ℹ️ 文件 "${args.path}"${scopeInfo} 的第 ${start} 至 ${end} 行（共 ${totalLines} 行）如下：\n${slicedLines.join('\n')}`;
    } catch (err: any) {
      return handleFsError(ctx, '读取文件', err, baseAbs);
    }
  }
}

export class WriteFileTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'write_file',
      description: '向安全工作区内的目标路径创建或覆写完整文件。支持自动递归创建父目录。警告：此为覆写操作，请勿直接调用以覆写大型文件或多行代码文件以防输出截断，应优先改用 edit_file 进行精准局部查找替换。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目标文件的相对路径（如 "logs/info.log"）'
          },
          content: {
            type: 'string',
            description: '要写入的完整文本内容'
          }
        },
        required: ['path', 'content']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.path || args.content === undefined) {
      return '❌ 参数错误：必须指定目标路径与写入内容。';
    }
    if (args.scope && args.scope !== 'workspace') {
      return `❌ 安全拒绝：物理源码区 (src) 与文档区 (doc) 为只读保护区，严禁写入或修改。`;
    }
    try {
      const { targetAbs, baseAbs } = getSafePath(ctx, args.path);
      const dirAbs = path.dirname(targetAbs);

      await fs.mkdir(dirAbs, { recursive: true });
      await fs.writeFile(targetAbs, args.content, 'utf-8');

      return `ℹ️ 已成功将内容写入文件 "${args.path}"。`;
    } catch (err: any) {
      return handleFsError(ctx, '写入文件', err);
    }
  }
}

export class EditFileTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'edit_file',
      description: '查找并替换安全工作区内目标文件中的唯一局部文本段。入参 target 的缩写、换行和空格必须与原文件内容完全精确匹配；replacement 为要替换上去的完整新文本段。此为安全修改大文件的首选方式。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目标文件的相对路径（如 "config.json"）'
          },
          target: {
            type: 'string',
            description: '要查找并被替换的原始精确文本段'
          },
          replacement: {
            type: 'string',
            description: '替换后的新文本段'
          }
        },
        required: ['path', 'target', 'replacement']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.path || args.target === undefined || args.replacement === undefined) {
      return '❌ 参数错误：必须指定目标路径、查找目标与替换文本。';
    }
    if (args.scope && args.scope !== 'workspace') {
      return `❌ 安全拒绝：物理源码区 (src) 与文档区 (doc) 为只读保护区，严禁写入或修改。`;
    }
    try {
      const { targetAbs, baseAbs } = getSafePath(ctx, args.path);
      const stats = await fs.stat(targetAbs);
      if (!stats.isFile()) {
        return `❌ 路径 "${args.path}" 不是一个有效的文件。`;
      }

      const content = await fs.readFile(targetAbs, 'utf-8');
      const index = content.indexOf(args.target);
      if (index === -1) {
        return `❌ 修改失败：在文件 "${args.path}" 中未找到指定的 target 文本。请确保 target 在大小写、缩进和换行上与文件内完全一致。`;
      }

      const newContent = content.slice(0, index) + args.replacement + content.slice(index + args.target.length);
      await fs.writeFile(targetAbs, newContent, 'utf-8');

      return `ℹ️ 已成功修改文件 "${args.path}" 的指定部分。`;
    } catch (err: any) {
      return handleFsError(ctx, '修改文件', err);
    }
  }
}
