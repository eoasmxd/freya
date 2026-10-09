import type { FreyaAttachment, FreyaContext, FreyaTool, FreyaToolResult, ToolDefinition } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

const MEDIA_EXTENSIONS = new Map<string, { type: 'image' | 'file'; mimeType: string }>([
  ['.png', { type: 'image', mimeType: 'image/png' }],
  ['.jpg', { type: 'image', mimeType: 'image/jpeg' }],
  ['.jpeg', { type: 'image', mimeType: 'image/jpeg' }],
  ['.webp', { type: 'image', mimeType: 'image/webp' }],
  ['.gif', { type: 'image', mimeType: 'image/gif' }],
  ['.svg', { type: 'image', mimeType: 'image/svg+xml' }],
  ['.bmp', { type: 'image', mimeType: 'image/bmp' }],
  ['.ico', { type: 'image', mimeType: 'image/x-icon' }],
  ['.mp3', { type: 'file', mimeType: 'audio/mpeg' }],
  ['.wav', { type: 'file', mimeType: 'audio/wav' }],
  ['.m4a', { type: 'file', mimeType: 'audio/mp4' }],
  ['.ogg', { type: 'file', mimeType: 'audio/ogg' }],
  ['.aac', { type: 'file', mimeType: 'audio/aac' }],
  ['.flac', { type: 'file', mimeType: 'audio/flac' }],
  ['.mp4', { type: 'file', mimeType: 'video/mp4' }],
  ['.webm', { type: 'file', mimeType: 'video/webm' }]
]);

/**
 * 识别媒体文件类型信息
 * Identify media file type information
 */
function getMediaFileInfo(filePath: string): { type: 'image' | 'file'; mimeType: string } | null {
  const ext = path.extname(filePath).toLowerCase();
  return MEDIA_EXTENSIONS.get(ext) || null;
}

/**
 * 快速嗅探文件是否为二进制格式（检查前 512 字节是否存在 NULL 空字节）
 * Fast sniff if file is binary by checking for NULL bytes in first 512 bytes
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await fileHandle.read(buffer, 0, 512, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0x00) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

/**
 * 解析作用域实际物理路径，返回 null 表示显式禁用
 * Resolve actual physical path of scope; returns null if explicitly disabled
 */
function resolveScopeBase(envValue: string | undefined, defaultPath: string, launchDir: string): string | null {
  if (envValue === undefined) {
    return defaultPath;
  }
  const trimmed = envValue.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'false') {
    return null;
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(launchDir, trimmed);
}

/**
 * 获取当前激活的作用域列表与描述文本
 * Get list of currently active scopes and description text
 */
function getActiveScopesInfo(): { scopes: string[]; description: string } {
  const scopes = ['workspace'];
  const descParts = ['default to "workspace" sandbox'];

  const srcVal = process.env.FREYA_FS_SRC;
  const isSrcDisabled = srcVal !== undefined && (srcVal.trim() === '' || srcVal.trim().toLowerCase() === 'false');
  if (!isSrcDisabled) {
    scopes.push('src');
    descParts.push('support "src" source code');
  }

  const docVal = process.env.FREYA_FS_DOC;
  const isDocDisabled = docVal !== undefined && (docVal.trim() === '' || docVal.trim().toLowerCase() === 'false');
  if (!isDocDisabled) {
    scopes.push('doc');
    descParts.push('support "doc" documentation');
  }

  // 读取作用域描述
  const description = `Read scope (optional, ${descParts.join(', ')})`;
  return { scopes, description };
}

/**
 * 获取经过安全边界校验的绝对路径
 * Get absolute path validated against security boundaries
 */
export function getSafePath(ctx: FreyaContext, relativePath: string, scope?: string): { targetAbs: string; baseAbs: string } {
  const targetScope = scope || 'workspace';
  let baseAbs: string | null = null;

  if (targetScope === 'workspace') {
    baseAbs = ctx.paths.workspaceDir;
  } else if (targetScope === 'src') {
    baseAbs = resolveScopeBase(process.env.FREYA_FS_SRC, path.join(ctx.paths.appRoot, 'src'), ctx.paths.launchDir);
  } else if (targetScope === 'doc') {
    baseAbs = resolveScopeBase(process.env.FREYA_FS_DOC, path.join(ctx.paths.appRoot, 'doc'), ctx.paths.launchDir);
  }

  if (!baseAbs) {
    // 作用域未开放安全拒绝
    throw new Error(`Security rejection: Scope "${targetScope}" is not available or has been disabled.`);
  }

  if (relativePath && path.isAbsolute(relativePath)) {
    // 绝对路径安全拒绝
    throw new Error('Security rejection: Only relative paths are allowed, absolute paths are prohibited.');
  }

  const targetAbs = path.resolve(baseAbs, relativePath || '.');
  const basePrefix = baseAbs.endsWith(path.sep) ? baseAbs : baseAbs + path.sep;

  if (targetAbs !== baseAbs && !targetAbs.startsWith(basePrefix)) {
    // 越界安全拒绝
    throw new Error(`Security boundary rejection: Cannot access relative path "${relativePath}" outside the target scope.`);
  }

  return { targetAbs, baseAbs };
}

/**
 * 屏蔽底层文件系统异常中携带的真实宿主机绝对路径
 * Mask real host absolute paths in underlying filesystem exceptions
 */
export function sanitizeError(err: any, baseAbs: string): string {
  const rawMessage = err?.message || String(err);
  const escapedWorkspace = baseAbs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedWorkspace + '[\\\\/]?', 'g');
  return rawMessage.replace(regex, '');
}

/**
 * 统一文件系统错误处理与物理路径脱敏
 * Unified filesystem error handling and physical path sanitization
 */
export function handleFsError(ctx: FreyaContext, action: string, err: any, baseAbs?: string): string {
  const targetBase = baseAbs || ctx.paths.workspaceDir;
  // 文件操作失败提示
  return `❌ Failed to ${action}: ${sanitizeError(err, targetBase)}`;
}

/**
 * 格式化文件大小
 * Format file size in bytes
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export class ListDirectoryTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    const { scopes, description } = getActiveScopesInfo();
    return {
      name: 'fs_list_directory',
      // 列出指定目录内容
      description: 'List files and subdirectories under specified directory path. Note: only relative paths allowed, no absolute or parent escape paths.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            // 要查看的相对路径
            description: 'Relative path of directory to inspect (optional, defaults to root ".")'
          },
          scope: {
            type: 'string',
            enum: scopes,
            description
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    let baseAbs = this.ctx?.paths.workspaceDir || '';
    try {
      const pathInfo = getSafePath(this.ctx!, args.path || '.', args.scope);
      const targetAbs = pathInfo.targetAbs;
      baseAbs = pathInfo.baseAbs;

      const stats = await fs.stat(targetAbs);
      if (!stats.isDirectory()) {
        // 非有效目录提示
        return `❌ Path "${args.path || '.'}" is not a valid directory.`;
      }

      const entries = await fs.readdir(targetAbs, { withFileTypes: true });
      if (entries.length === 0) {
        // 目录为空提示
        return `ℹ️ Directory "${args.path || '.'}" is empty.`;
      }

      const resultLines: string[] = [];
      for (const entry of entries) {
        const entryAbs = path.join(targetAbs, entry.name);
        if (entry.isDirectory()) {
          resultLines.push(`[Directory] ${entry.name}`);
        } else {
          try {
            const entryStats = await fs.stat(entryAbs);
            resultLines.push(`[File] ${entry.name} (${formatBytes(entryStats.size)})`);
          } catch {
            resultLines.push(`[File] ${entry.name}`);
          }
        }
      }

      const scopeInfo = args.scope ? ` (${args.scope})` : '';
      // 目录内容出参
      return `ℹ️ Directory "${args.path || '.'}"${scopeInfo} contains:\n${resultLines.join('\n')}`;
    } catch (err: any) {
      return handleFsError(this.ctx!, 'list directory', err, baseAbs);
    }
  }
}

export class ReadFileTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    const { scopes, description } = getActiveScopesInfo();
    return {
      name: 'fs_read_file',
      // 读取指定文本文件
      description: 'Read text content of specified file. ONLY for plain text and code files. Do NOT use for media files (images, audio). Supports line slicing to prevent context overflow on large files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            // 目标文件相对路径
            description: 'Relative path of target file (e.g. "notes.txt")'
          },
          scope: {
            type: 'string',
            enum: scopes,
            description
          },
          startLine: {
            type: 'integer',
            // 起始行号
            description: 'Start line number (optional, 1-indexed, inclusive. Defaults to line 1)'
          },
          endLine: {
            type: 'integer',
            // 结束行号
            description: 'End line number (optional, 1-indexed, inclusive. Defaults to end of file)'
          }
        },
        required: ['path']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.path) {
      // 缺少相对路径错误
      return '❌ Parameter error: Must specify target file relative path.';
    }
    let baseAbs = this.ctx?.paths.workspaceDir || '';
    try {
      const pathInfo = getSafePath(this.ctx!, args.path, args.scope);
      const targetAbs = pathInfo.targetAbs;
      baseAbs = pathInfo.baseAbs;

      const stats = await fs.stat(targetAbs);
      if (!stats.isFile()) {
        // 非有效文件提示
        return `❌ Path "${args.path}" is not a valid file.`;
      }

      const mediaInfo = getMediaFileInfo(targetAbs);
      if (mediaInfo) {
        // 媒体文件误读提示
        return `❌ Error: Cannot read media file "${args.path}" as text. Please use fs_read_attachment instead.`;
      }

      if (await isBinaryFile(targetAbs)) {
        // 二进制文件误读提示
        return `❌ Error: Cannot read binary file "${args.path}" as text. Binary formats (e.g. zip, pdf, exe, db) are not supported for text operations.`;
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
        // 起始行号超限错误
        return `❌ Start line (${start}) exceeds total line count (${totalLines}).`;
      }

      if (start > end) {
        // 起始行大于结束行错误
        return `❌ Start line (${start}) cannot be greater than end line (${end}).`;
      }

      const slicedLines = lines.slice(start - 1, end);
      const scopeInfo = args.scope ? ` (${args.scope})` : '';
      // 切片内容出参
      return `ℹ️ File "${args.path}"${scopeInfo} lines ${start} to ${end} (total ${totalLines} lines):\n${slicedLines.join('\n')}`;
    } catch (err: any) {
      return handleFsError(this.ctx!, 'read file', err, baseAbs);
    }
  }
}

export class ReadAttachmentTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    const { scopes, description } = getActiveScopesInfo();
    return {
      name: 'fs_read_attachment',
      // 读取媒体文件为附件
      description: 'Read a media file (image, audio) as a multimodal attachment. ONLY for media files. Do NOT use for text/code files.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            // 目标文件相对路径
            description: 'Relative path of target media file (e.g. "image.png", "audio.mp3")'
          },
          scope: {
            type: 'string',
            enum: scopes,
            description
          }
        },
        required: ['path']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string | FreyaToolResult> {
    if (!args.path) {
      // 缺少相对路径错误
      return '❌ Parameter error: Must specify target file relative path.';
    }
    let baseAbs = this.ctx?.paths.workspaceDir || '';
    try {
      const pathInfo = getSafePath(this.ctx!, args.path, args.scope);
      const targetAbs = pathInfo.targetAbs;
      baseAbs = pathInfo.baseAbs;

      const stats = await fs.stat(targetAbs);
      if (!stats.isFile()) {
        // 非有效文件提示
        return `❌ Path "${args.path}" is not a valid file.`;
      }

      const mediaInfo = getMediaFileInfo(targetAbs);
      if (!mediaInfo) {
        if (await isBinaryFile(targetAbs)) {
          // 不支持的非媒体二进制文件提示
          return `❌ Error: File "${args.path}" is an unsupported binary format. fs_read_attachment only supports media files (images, audio).`;
        }
        // 非媒体文本文件误读提示
        return `❌ Error: File "${args.path}" is a text file. Please use fs_read_file to read text/code files directly.`;
      }

      const scopeInfo = args.scope ? ` (${args.scope})` : '';
      return {
        // 媒体附件读取成功出参
        content: `ℹ️ Media file "${args.path}"${scopeInfo} loaded successfully as attachment.`,
        attachments: [
          {
            type: mediaInfo.type,
            mimeType: mediaInfo.mimeType,
            path: args.path
          }
        ]
      };
    } catch (err: any) {
      return handleFsError(this.ctx!, 'read attachment', err, baseAbs);
    }
  }
}

export class WriteFileTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'fs_write_file',
      // 创建或覆写完整文件
      description: 'Create or overwrite a complete file at target path within workspace. Automatically creates parent directories recursively. Warning: prefer fs_edit_file for large code files to avoid truncation.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            // 目标文件相对路径
            description: 'Relative path of target file (e.g. "logs/info.log")'
          },
          content: {
            type: 'string',
            // 写入的文本内容
            description: 'Complete text content to write'
          }
        },
        required: ['path', 'content']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.path || args.content === undefined) {
      // 缺少路径或内容参数错误
      return '❌ Parameter error: Must specify target path and content to write.';
    }
    if (args.scope && args.scope !== 'workspace') {
      // 非工作区写入安全拒绝
      return '❌ Security rejection: Write operations are only permitted in the workspace sandbox, all other areas are read-only.';
    }
    try {
      const { targetAbs, baseAbs } = getSafePath(this.ctx!, args.path);
      const dirAbs = path.dirname(targetAbs);

      await fs.mkdir(dirAbs, { recursive: true });
      await fs.writeFile(targetAbs, args.content, 'utf-8');

      // 写入成功出参
      return `ℹ️ Successfully wrote content to file "${args.path}".`;
    } catch (err: any) {
      return handleFsError(this.ctx!, 'write file', err);
    }
  }
}

export class EditFileTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'fs_edit_file',
      // 局部查找替换文件内容
      description: 'Find and replace a unique local text block in a workspace file. ONLY for plain text and code files. Do NOT use for media files. Target indentation and line breaks must match original text exactly; replacement is new text block. Preferred method for editing code files safely.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            // 目标文件相对路径
            description: 'Relative path of target file (e.g. "config.json")'
          },
          target: {
            type: 'string',
            // 查找的原文本段
            description: 'Exact original text snippet to find and replace'
          },
          replacement: {
            type: 'string',
            // 替换后的新文本段
            description: 'New replacement text snippet'
          }
        },
        required: ['path', 'target', 'replacement']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.path || args.target === undefined || args.replacement === undefined) {
      // 缺少必要参数错误
      return '❌ Parameter error: Must specify target path, search target, and replacement text.';
    }
    if (args.scope && args.scope !== 'workspace') {
      // 非工作区修改安全拒绝
      return '❌ Security rejection: Edit operations are only permitted in the workspace sandbox, all other areas are read-only.';
    }
    try {
      const { targetAbs, baseAbs } = getSafePath(this.ctx!, args.path);
      const stats = await fs.stat(targetAbs);
      if (!stats.isFile()) {
        // 非有效文件提示
        return `❌ Path "${args.path}" is not a valid file.`;
      }

      const mediaInfo = getMediaFileInfo(targetAbs);
      if (mediaInfo) {
        // 媒体文件拒绝修改提示
        return `❌ Error: Cannot edit media file "${args.path}". fs_edit_file is only supported for plain text and code files.`;
      }

      if (await isBinaryFile(targetAbs)) {
        // 二进制文件拒绝修改提示
        return `❌ Error: Cannot edit binary file "${args.path}". Binary files cannot be modified as text.`;
      }

      const content = await fs.readFile(targetAbs, 'utf-8');
      const firstIndex = content.indexOf(args.target);
      if (firstIndex === -1) {
        // 未匹配到目标文本错误提示
        return `❌ Edit failed: Target text not found in file "${args.path}". Ensure casing, indentation, and newlines match file exactly.`;
      }

      const secondIndex = content.indexOf(args.target, firstIndex + args.target.length);
      if (secondIndex !== -1) {
        // 多处匹配冲突拒绝提示
        return `❌ Edit rejected: Multiple occurrences of target text found in "${args.path}". Expand target block to include more context lines for uniqueness.`;
      }

      const newContent = content.slice(0, firstIndex) + args.replacement + content.slice(firstIndex + args.target.length);
      await fs.writeFile(targetAbs, newContent, 'utf-8');

      // 修改成功出参
      return `ℹ️ Successfully modified specified portion of file "${args.path}".`;
    } catch (err: any) {
      return handleFsError(this.ctx!, 'edit file', err);
    }
  }
}
