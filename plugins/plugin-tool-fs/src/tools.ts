import type { FreyaAttachment, FreyaContext, FreyaTool, FreyaToolResult, ToolDefinition } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RegexWorkerInitData, RegexWorkerRequest, RegexWorkerResponse } from './regex-worker.js';

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

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv'
]);

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_LIMIT = 500;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MATCH_LINE_LENGTH = 300;
const SEARCH_CONCURRENCY = 16;
const MAX_SEARCH_FILES = 10000;
const MAX_REGEX_LENGTH = 500;
const MAX_REGEX_QUANTIFIER = 1000;
const MAX_NESTED_QUANTIFIER_REPEAT = 10;
const REGEX_FILE_TIMEOUT_MS = 500;
const REGEX_TOTAL_TIMEOUT_MS = 5000;
const REGEX_WORKER_STARTUP_TIMEOUT_MS = 5000;

/**
 * 不安全正则表达式静态校验异常
 * Error thrown when a regular expression fails static ReDoS safety checks
 */
class UnsafeRegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeRegexError';
  }
}

/**
 * 正则执行超时异常
 * Error thrown when regular expression execution exceeds time budget
 */
class RegexTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegexTimeoutError';
  }
}

interface ScannedFile {
  absPath: string;
  relPath: string;
}

interface FileMatchOutcome {
  lines: string[];
  matchedIndices: number[];
  truncated: boolean;
}

interface TextMatcher {
  matchContent: (content: string, maxMatches: number) => Promise<FileMatchOutcome> | FileMatchOutcome;
  dispose?: () => Promise<void>;
}

interface FileSearchResult {
  relPath: string;
  lines: string[];
  matchedIndices: number[];
  truncated: boolean;
  skipReason?: string;
}

function parseOptionalClampedInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function clampInteger(value: unknown, defaultValue: number, min: number, max: number): number {
  return parseOptionalClampedInteger(value, min, max) ?? defaultValue;
}

function toPosixRelativePath(baseAbs: string, targetAbs: string): string {
  const rel = path.relative(baseAbs, targetAbs).split(path.sep).join('/');
  return rel || '.';
}

/**
 * 校验目标路径解析符号链接后的真实物理位置仍位于作用域根目录内
 * Verify that the symlink-resolved real path of target stays within scope base directory
 */
async function assertPathWithinBase(targetAbs: string, baseAbs: string): Promise<void> {
  const [realBase, realTarget] = await Promise.all([
    fs.realpath(baseAbs),
    fs.realpath(targetAbs)
  ]);
  const normalizedBase = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
  const normalizedTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  const basePrefix = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
  if (normalizedTarget !== normalizedBase && !normalizedTarget.startsWith(basePrefix)) {
    throw new Error('Security boundary rejection: Resolved path escapes the target scope via symbolic link.');
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingBrace(segment: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < segment.length; i++) {
    if (segment[i] === '{') {
      depth++;
    } else if (segment[i] === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function splitTopLevelComma(content: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      depth++;
    } else if (content[i] === '}') {
      depth--;
    } else if (content[i] === ',' && depth === 0) {
      parts.push(content.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(content.slice(start));
  return parts;
}

function compileGlobSegment(segment: string): string {
  let regexSource = '';
  let index = 0;
  while (index < segment.length) {
    const ch = segment[index];
    if (segment.startsWith('**/', index) && (index === 0 || segment[index - 1] === '/')) {
      regexSource += '(?:.*/)?';
      index += 3;
    } else if (segment.startsWith('**', index)) {
      regexSource += '.*';
      index += 2;
    } else if (ch === '*') {
      regexSource += '[^/]*';
      index += 1;
    } else if (ch === '?') {
      regexSource += '[^/]';
      index += 1;
    } else if (ch === '{') {
      const closeIndex = findMatchingBrace(segment, index);
      if (closeIndex !== -1) {
        const alternatives = splitTopLevelComma(segment.slice(index + 1, closeIndex));
        if (alternatives.length > 1) {
          regexSource += `(?:${alternatives.map((alt) => compileGlobSegment(alt)).join('|')})`;
          index = closeIndex + 1;
          continue;
        }
      }
      regexSource += escapeRegExp(ch);
      index += 1;
    } else {
      regexSource += escapeRegExp(ch);
      index += 1;
    }
  }
  return regexSource;
}

/**
 * 将简易 Glob 通配符编译为路径或文件名匹配函数
 * Compile glob pattern into a relative-path or filename matcher
 */
function compileGlobMatcher(pattern: string): (relPath: string, fileName: string) => boolean {
  const strippedDot = pattern.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const isRootAnchored = strippedDot.startsWith('/');
  const normalized = strippedDot.replace(/^\/+/, '');
  const matchFullPath = isRootAnchored || normalized.includes('/');

  const regexSource = `^${compileGlobSegment(normalized)}$`;
  const matcherRegex = new RegExp(regexSource, 'i');
  return (relPath: string, fileName: string) => matcherRegex.test(matchFullPath ? relPath : fileName);
}

function hasNullByte(buffer: Buffer, sampleLength = 512): boolean {
  const limit = Math.min(buffer.length, sampleLength);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0x00) {
      return true;
    }
  }
  return false;
}

function truncateLine(line: string): string {
  return line.length > MAX_MATCH_LINE_LENGTH
    ? line.slice(0, MAX_MATCH_LINE_LENGTH) + '...'
    : line;
}

interface ParsedQuantifier {
  endIndex: number;
  min: number;
  max: number;
  isRepeating: boolean;
  isUnbounded: boolean;
}

interface RegexGroupFrame {
  hasRepeatingQuantifier: boolean;
  hasBackref: boolean;
}

interface PendingRegexRequest {
  id: number;
  content: string;
  maxMatches: number;
  resolve: (outcome: FileMatchOutcome) => void;
  reject: (err: Error) => void;
}

/**
 * 解析正则原子或分组后紧邻的量词及惰性修饰符
 * Parse a quantifier (and optional lazy modifier) immediately following an atom or group
 */
function parseRegexQuantifier(pattern: string, start: number): ParsedQuantifier | null {
  if (start >= pattern.length) {
    return null;
  }

  const ch = pattern[start];
  let parsed: ParsedQuantifier | null = null;

  if (ch === '*') {
    parsed = { endIndex: start + 1, min: 0, max: Infinity, isRepeating: true, isUnbounded: true };
  } else if (ch === '+') {
    parsed = { endIndex: start + 1, min: 1, max: Infinity, isRepeating: true, isUnbounded: true };
  } else if (ch === '?') {
    parsed = { endIndex: start + 1, min: 0, max: 1, isRepeating: false, isUnbounded: false };
  } else if (ch === '{') {
    const match = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(start));
    if (match) {
      const min = Number(match[1]);
      const max = match[2] === undefined
        ? min
        : (match[2] === '' ? Infinity : Number(match[2]));
      parsed = {
        endIndex: start + match[0].length,
        min,
        max,
        isRepeating: max > 1,
        isUnbounded: max === Infinity
      };
    }
  }

  if (parsed && parsed.endIndex < pattern.length && pattern[parsed.endIndex] === '?') {
    parsed.endIndex += 1;
  }
  return parsed;
}

/**
 * 静态检测正则表达式是否存在高回溯（ReDoS）风险
 * Statically validate a regular expression against catastrophic backtracking (ReDoS) patterns
 */
function validateRegexSafety(pattern: string): void {
  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new UnsafeRegexError(`Regular expression exceeds maximum length of ${MAX_REGEX_LENGTH} characters.`);
  }

  const groupStack: RegexGroupFrame[] = [{ hasRepeatingQuantifier: false, hasBackref: false }];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '(') {
      groupStack.push({ hasRepeatingQuantifier: false, hasBackref: false });
      if (pattern[i + 1] === '?') {
        if (pattern.startsWith('?<=', i + 1) || pattern.startsWith('?<!', i + 1)) {
          i += 4;
        } else if (pattern.startsWith('?<', i + 1)) {
          const closeAngle = pattern.indexOf('>', i + 3);
          i = closeAngle !== -1 ? closeAngle + 1 : i + 3;
        } else if (
          pattern.startsWith('?:', i + 1) ||
          pattern.startsWith('?=', i + 1) ||
          pattern.startsWith('?!', i + 1)
        ) {
          i += 3;
        } else {
          i += 2;
        }
      } else {
        i += 1;
      }
      continue;
    }

    let nextIndex = i + 1;
    let atomIsBackref = false;
    let closedGroup: RegexGroupFrame | null = null;

    if (ch === '\\') {
      const nextCh = pattern[i + 1];
      if (nextCh !== undefined && nextCh >= '1' && nextCh <= '9') {
        let j = i + 2;
        while (j < pattern.length && pattern[j] >= '0' && pattern[j] <= '9') {
          j += 1;
        }
        nextIndex = j;
        atomIsBackref = true;
        groupStack[groupStack.length - 1].hasBackref = true;
      } else if (nextCh === 'k' && pattern[i + 2] === '<') {
        const closeAngle = pattern.indexOf('>', i + 3);
        if (closeAngle !== -1) {
          nextIndex = closeAngle + 1;
          atomIsBackref = true;
          groupStack[groupStack.length - 1].hasBackref = true;
        } else {
          nextIndex = Math.min(pattern.length, i + 2);
        }
      } else {
        nextIndex = Math.min(pattern.length, i + 2);
      }
    } else if (ch === '[') {
      let j = i + 1;
      while (j < pattern.length) {
        if (pattern[j] === '\\') {
          j += 2;
          continue;
        }
        if (pattern[j] === ']') {
          j += 1;
          break;
        }
        j += 1;
      }
      nextIndex = Math.min(pattern.length, j);
    } else if (ch === ')') {
      if (groupStack.length > 1) {
        closedGroup = groupStack.pop()!;
        const parent = groupStack[groupStack.length - 1];
        if (closedGroup.hasRepeatingQuantifier) {
          parent.hasRepeatingQuantifier = true;
        }
        if (closedGroup.hasBackref) {
          parent.hasBackref = true;
        }
      }
      nextIndex = i + 1;
    }

    const quantifier = parseRegexQuantifier(pattern, nextIndex);
    if (quantifier) {
      if (
        quantifier.min > MAX_REGEX_QUANTIFIER ||
        (Number.isFinite(quantifier.max) && quantifier.max > MAX_REGEX_QUANTIFIER)
      ) {
        throw new UnsafeRegexError(`Quantifier exceeds the maximum bound of ${MAX_REGEX_QUANTIFIER}.`);
      }

      if ((atomIsBackref || closedGroup?.hasBackref) && quantifier.isRepeating) {
        throw new UnsafeRegexError('Quantified backreferences are not allowed.');
      }

      if (
        closedGroup?.hasRepeatingQuantifier &&
        (quantifier.isUnbounded || quantifier.max > MAX_NESTED_QUANTIFIER_REPEAT)
      ) {
        throw new UnsafeRegexError('Nested repeating quantifiers are not allowed due to backtracking risk.');
      }

      if (quantifier.isRepeating) {
        groupStack[groupStack.length - 1].hasRepeatingQuantifier = true;
      }

      i = quantifier.endIndex;
    } else {
      i = nextIndex;
    }
  }
}

/**
 * 隔离工作线程并强制执行单文件及总耗时上限的正则匹配调度器
 * Worker-isolated regex execution runner enforcing per-file and total timeout limits
 */
class RegexWorkerRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private consumedMs = 0;
  private activeStartedAt = 0;
  private workerOnline = false;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private terminalError: Error | null = null;
  private activeRequest: PendingRegexRequest | null = null;
  private activeTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: PendingRegexRequest[] = [];

  constructor(
    private readonly pattern: string,
    private readonly caseSensitive: boolean
  ) { }

  match(content: string, maxMatches: number): Promise<FileMatchOutcome> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }
    if (this.disposed) {
      return Promise.reject(new Error('Regex worker has been disposed.'));
    }

    this.ensureWorker();
    return new Promise<FileMatchOutcome>((resolve, reject) => {
      this.queue.push({
        id: this.nextId++,
        content,
        maxMatches,
        resolve,
        reject
      });
      this.pumpQueue();
    });
  }

  private ensureWorker(): void {
    if (this.worker) {
      return;
    }

    const worker = new Worker(new URL('./regex-worker.js', import.meta.url), {
      workerData: {
        pattern: this.pattern,
        caseSensitive: this.caseSensitive
      } satisfies RegexWorkerInitData
    });
    this.worker = worker;

    this.startupTimer = setTimeout(() => {
      this.failAll(new Error(`Regex worker failed to start within ${REGEX_WORKER_STARTUP_TIMEOUT_MS}ms.`));
    }, REGEX_WORKER_STARTUP_TIMEOUT_MS);

    worker.once('online', () => {
      this.clearStartupTimer();
      this.workerOnline = true;
      this.pumpQueue();
    });

    worker.on('message', (res: RegexWorkerResponse) => {
      const req = this.activeRequest;
      if (!req || req.id !== res.id) {
        return;
      }
      this.clearActiveTimer();
      this.consumedMs += Date.now() - this.activeStartedAt;
      this.activeRequest = null;

      const lines = res.matchedIndices.length > 0 ? req.content.split(/\r?\n/) : [];
      req.resolve({
        lines,
        matchedIndices: res.matchedIndices,
        truncated: res.truncated
      });
      this.pumpQueue();
    });

    worker.on('error', (err: Error) => {
      this.failAll(err);
    });

    worker.on('exit', (code: number) => {
      if (!this.disposed && !this.terminalError && (this.activeRequest || this.queue.length > 0)) {
        this.failAll(new Error(`Regex worker exited unexpectedly with code ${code}.`));
      }
    });
  }

  private pumpQueue(): void {
    if (
      this.disposed ||
      this.terminalError ||
      this.activeRequest ||
      this.queue.length === 0 ||
      !this.worker ||
      !this.workerOnline
    ) {
      return;
    }

    const remainingTotalMs = REGEX_TOTAL_TIMEOUT_MS - this.consumedMs;
    if (remainingTotalMs <= 0) {
      this.failAll(new RegexTimeoutError(`Total regex search timeout exceeded (${REGEX_TOTAL_TIMEOUT_MS}ms).`));
      return;
    }

    const next = this.queue.shift()!;
    this.activeRequest = next;

    const fileTimeoutMs = Math.min(REGEX_FILE_TIMEOUT_MS, remainingTotalMs);
    const isTotalBudgetCap = remainingTotalMs <= REGEX_FILE_TIMEOUT_MS;
    this.activeTimer = setTimeout(() => {
      const timeoutMsg = isTotalBudgetCap
        ? `Total regex search timeout exceeded (${REGEX_TOTAL_TIMEOUT_MS}ms).`
        : `Single-file regex execution timed out after ${REGEX_FILE_TIMEOUT_MS}ms.`;
      this.failAll(new RegexTimeoutError(timeoutMsg));
    }, fileTimeoutMs);

    const req: RegexWorkerRequest = {
      id: next.id,
      content: next.content,
      maxMatches: next.maxMatches
    };
    this.activeStartedAt = Date.now();
    this.worker.postMessage(req);
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private clearActiveTimer(): void {
    if (this.activeTimer !== null) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
  }

  private failAll(err: Error): void {
    this.clearActiveTimer();
    this.clearStartupTimer();
    if (!this.terminalError) {
      this.terminalError = err;
    }

    const pending: PendingRegexRequest[] = [];
    if (this.activeRequest) {
      pending.push(this.activeRequest);
      this.activeRequest = null;
    }
    while (this.queue.length > 0) {
      pending.push(this.queue.shift()!);
    }

    for (const item of pending) {
      item.reject(this.terminalError);
    }

    if (this.worker) {
      const activeWorker = this.worker;
      this.worker = null;
      void activeWorker.terminate().catch(() => { });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearActiveTimer();
    this.clearStartupTimer();

    const disposeErr = this.terminalError ?? new Error('Regex worker disposed.');
    if (this.activeRequest) {
      this.activeRequest.reject(disposeErr);
      this.activeRequest = null;
    }
    while (this.queue.length > 0) {
      this.queue.shift()!.reject(disposeErr);
    }

    if (this.worker) {
      const activeWorker = this.worker;
      this.worker = null;
      await activeWorker.terminate().catch(() => { });
    }
  }
}

/**
 * 构建文本匹配器（普通文本使用同步预筛，正则使用静态校验与工作线程隔离）
 * Build text matcher (synchronous pre-filtering for plain text; static validation and worker isolation for regex)
 */
function createTextMatcher(query: string, isRegex: boolean, caseSensitive: boolean): TextMatcher {
  if (!isRegex) {
    const literalRegex = caseSensitive ? null : new RegExp(escapeRegExp(query), 'i');
    return {
      matchContent: (content: string, maxMatches: number): FileMatchOutcome => {
        const hasMatch = literalRegex ? literalRegex.test(content) : content.includes(query);
        if (!hasMatch) {
          return { lines: [], matchedIndices: [], truncated: false };
        }

        const lines = content.split(/\r?\n/);
        const matchedIndices: number[] = [];
        let truncated = false;

        for (let i = 0; i < lines.length; i++) {
          const lineMatched = literalRegex ? literalRegex.test(lines[i]) : lines[i].includes(query);
          if (lineMatched) {
            if (matchedIndices.length >= maxMatches) {
              truncated = true;
              break;
            }
            matchedIndices.push(i);
          }
        }

        return { lines, matchedIndices, truncated };
      }
    };
  }

  if (query.length > MAX_REGEX_LENGTH) {
    throw new UnsafeRegexError(`Regular expression exceeds maximum length of ${MAX_REGEX_LENGTH} characters.`);
  }
  const baseFlags = caseSensitive ? '' : 'i';
  new RegExp(query, baseFlags);
  validateRegexSafety(query);

  const runner = new RegexWorkerRunner(query, caseSensitive);
  return {
    matchContent: (content: string, maxMatches: number) => runner.match(content, maxMatches),
    dispose: () => runner.dispose()
  };
}

/**
 * 递归收集作用域内的合法文件，自动跳过符号链接与可选的默认忽略目录
 * Recursively collect valid files within scope while pruning symlinks and optional default ignored directories
 */
async function collectFiles(
  startAbs: string,
  baseAbs: string,
  options: {
    maxDepth?: number;
    fileMatcher?: (relPath: string, fileName: string) => boolean;
    maxFiles?: number;
    includeIgnored?: boolean;
  }
): Promise<{ files: ScannedFile[]; truncated: boolean; skippedIgnoredDirs: string[] }> {
  const files: ScannedFile[] = [];
  const skippedIgnoredDirs = new Set<string>();
  let truncated = false;

  const visit = async (dirAbs: string, depth: number): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;

      const entryAbs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (!options.includeIgnored && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          skippedIgnoredDirs.add(entry.name);
          continue;
        }
        if (options.maxDepth !== undefined && depth >= options.maxDepth) continue;
        await visit(entryAbs, depth + 1);
      } else if (entry.isFile()) {
        const relPath = toPosixRelativePath(baseAbs, entryAbs);
        if (options.fileMatcher) {
          const relFromStart = toPosixRelativePath(startAbs, entryAbs);
          if (!options.fileMatcher(relFromStart, entry.name) && !options.fileMatcher(relPath, entry.name)) {
            continue;
          }
        }
        if (options.maxFiles !== undefined && files.length >= options.maxFiles) {
          truncated = true;
          return;
        }
        files.push({ absPath: entryAbs, relPath });
      }
    }
  };

  await visit(startAbs, 0);
  return {
    files,
    truncated,
    skippedIgnoredDirs: Array.from(skippedIgnoredDirs).sort()
  };
}

/**
 * 将匹配行索引格式化为带或不带上下文的文本输出块
 * Format matched line indices into output blocks with optional surrounding context lines
 */
function formatMatchBlocks(
  relPath: string,
  lines: string[],
  matchedIndices: number[],
  contextLines: number
): string[] {
  if (contextLines === 0) {
    return matchedIndices.map(
      (idx) => `${relPath}:${idx + 1}: ${truncateLine(lines[idx])}`
    );
  }

  const matchedSet = new Set(matchedIndices);
  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of matchedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(lines.length - 1, idx + contextLines);
    const prev = ranges[ranges.length - 1];
    if (prev && start <= prev.end + 1) {
      prev.end = Math.max(prev.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range) => {
    const blockLines: string[] = [];
    for (let i = range.start; i <= range.end; i++) {
      const separator = matchedSet.has(i) ? ':' : '-';
      blockLines.push(`${relPath}${separator}${i + 1}${separator} ${truncateLine(lines[i])}`);
    }
    return blockLines.join('\n');
  });
}

/**
 * 检索单个文本文件并返回匹配行信息，包含整文件预筛与二进制跳过逻辑
 * Search a single text file with whole-file pre-filtering and binary skipping
 */
async function searchSingleFile(
  file: ScannedFile,
  matcher: TextMatcher,
  maxMatches: number
): Promise<FileSearchResult | null> {
  if (getMediaFileInfo(file.absPath)) {
    return { relPath: file.relPath, lines: [], matchedIndices: [], truncated: false, skipReason: 'Media files cannot be searched as text.' };
  }

  let stats;
  try {
    stats = await fs.stat(file.absPath);
  } catch {
    return null;
  }

  if (!stats.isFile() || stats.size === 0) {
    return null;
  }
  if (stats.size > MAX_SEARCH_FILE_BYTES) {
    return { relPath: file.relPath, lines: [], matchedIndices: [], truncated: false, skipReason: 'File exceeds the 2 MB text search size limit.' };
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file.absPath);
  } catch {
    return null;
  }

  if (hasNullByte(buffer)) {
    return { relPath: file.relPath, lines: [], matchedIndices: [], truncated: false, skipReason: 'Binary files cannot be searched as text.' };
  }

  const content = buffer.toString('utf-8');
  const matchOutcome = await matcher.matchContent(content, maxMatches);
  if (matchOutcome.matchedIndices.length === 0) {
    return null;
  }

  return {
    relPath: file.relPath,
    lines: matchOutcome.lines,
    matchedIndices: matchOutcome.matchedIndices,
    truncated: matchOutcome.truncated
  };
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

/**
 * 递归按 Glob 模式查找文件的只读工具
 * Read-only tool for recursively finding files matching a glob pattern
 */
export class FindFileTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    const { scopes, description } = getActiveScopesInfo();
    return {
      name: 'fs_find_file',
      description: 'Recursively find files matching a glob pattern (e.g. "*.ts", "**/*.md", "*config*") within the specified scope. By default ignores dependency/VCS directories (.git, node_modules, __pycache__, .venv); set includeIgnored=true to search them as well. Returns relative paths ready for fs_read_file.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Filename or relative-path glob pattern (e.g. "*.ts", "src/**/*.md", "*service*")'
          },
          path: {
            type: 'string',
            description: 'Starting relative directory path (optional, defaults to root ".")'
          },
          scope: {
            type: 'string',
            enum: scopes,
            description
          },
          maxDepth: {
            type: 'integer',
            description: 'Maximum directory recursion depth (optional, 0 searches only the starting directory)'
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum number of matched file paths to return (optional, default 100, max 500)'
          },
          includeIgnored: {
            type: 'boolean',
            description: 'Whether to include default ignored directories (.git, node_modules, __pycache__, .venv) during recursive traversal (optional, defaults to false)'
          }
        },
        required: ['pattern']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.pattern || typeof args.pattern !== 'string' || !args.pattern.trim()) {
      return '❌ Parameter error: Must specify a non-empty file search pattern.';
    }

    let baseAbs = this.ctx?.paths.workspaceDir || '';
    try {
      const pathInfo = getSafePath(this.ctx!, args.path || '.', args.scope);
      const targetAbs = pathInfo.targetAbs;
      baseAbs = pathInfo.baseAbs;

      await assertPathWithinBase(targetAbs, baseAbs);
      const stats = await fs.stat(targetAbs);
      if (!stats.isDirectory()) {
        return `❌ Path "${args.path || '.'}" is not a valid directory.`;
      }

      const maxDepth = parseOptionalClampedInteger(args.maxDepth, 0, 100);
      const maxResults = clampInteger(args.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);
      const includeIgnored = args.includeIgnored === true;
      const matcher = compileGlobMatcher(args.pattern);

      const { files, truncated, skippedIgnoredDirs } = await collectFiles(targetAbs, baseAbs, {
        maxDepth,
        fileMatcher: matcher,
        maxFiles: maxResults,
        includeIgnored
      });

      const scopeInfo = args.scope ? ` (${args.scope})` : '';
      if (files.length === 0) {
        const skippedNote = skippedIgnoredDirs.length > 0
          ? ` (skipped ignored directories: ${skippedIgnoredDirs.join(', ')}; set includeIgnored=true to include)`
          : '';
        return `ℹ️ No files matching "${args.pattern}" found under "${args.path || '.'}"${scopeInfo}${skippedNote}.`;
      }

      const noteParts: string[] = [];
      if (truncated) {
        noteParts.push(`truncated at limit ${maxResults}`);
      }
      if (skippedIgnoredDirs.length > 0) {
        noteParts.push(`skipped ignored directories: ${skippedIgnoredDirs.join(', ')}`);
      }
      const statusNote = noteParts.length > 0 ? ` (${noteParts.join(', ')})` : '';
      const fileLines = files.map((f) => f.relPath).join('\n');
      return `ℹ️ Found ${files.length} file(s) matching "${args.pattern}"${scopeInfo}${statusNote}:\n${fileLines}`;
    } catch (err: any) {
      return handleFsError(this.ctx!, 'find files', err, baseAbs);
    }
  }
}

/**
 * 类 grep 的快速只读文本与正则搜索工具
 * Fast grep-like read-only text and regular expression search tool
 */
export class SearchTextTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) { }

  getDefinition(): ToolDefinition {
    const { scopes, description } = getActiveScopesInfo();
    return {
      name: 'fs_search_text',
      description: 'Fast grep-like search for text or regular expressions across files in a directory or a single file. Automatically skips binary/media files, files over 2MB, and by default skips dependency/VCS directories (.git, node_modules, __pycache__, .venv) unless includeIgnored=true. Returns "path:line: content" matches ready for fs_read_file.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Plain text substring or regular expression pattern to search for'
          },
          isRegex: {
            type: 'boolean',
            description: 'Whether to interpret query as a regular expression (optional, defaults to false)'
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether matching is case-sensitive (optional, defaults to false)'
          },
          path: {
            type: 'string',
            description: 'Starting relative directory or single relative file path (optional, defaults to root ".")'
          },
          include: {
            type: 'string',
            description: 'Optional filename or relative-path glob filter (e.g. "*.ts", "doc/**/*.md")'
          },
          scope: {
            type: 'string',
            enum: scopes,
            description
          },
          contextLines: {
            type: 'integer',
            description: 'Number of context lines before and after each match (optional, 0-5, defaults to 0)'
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum total matching lines to return (optional, default 100, max 500)'
          },
          includeIgnored: {
            type: 'boolean',
            description: 'Whether to include default ignored directories (.git, node_modules, __pycache__, .venv) during recursive traversal (optional, defaults to false)'
          }
        },
        required: ['query']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.query || typeof args.query !== 'string') {
      return '❌ Parameter error: Must specify a non-empty search query.';
    }

    const isRegex = args.isRegex === true;
    const caseSensitive = args.caseSensitive === true;
    let matcher: TextMatcher;
    try {
      matcher = createTextMatcher(args.query, isRegex, caseSensitive);
    } catch (err: any) {
      if (err instanceof UnsafeRegexError) {
        return `❌ Unsafe regular expression "${args.query}": ${err.message} Simplify the pattern or use plain text search (isRegex: false).`;
      }
      return `❌ Invalid regular expression "${args.query}": ${err.message}`;
    }

    let baseAbs = this.ctx?.paths.workspaceDir || '';
    try {
      try {
        const pathInfo = getSafePath(this.ctx!, args.path || '.', args.scope);
        const targetAbs = pathInfo.targetAbs;
        baseAbs = pathInfo.baseAbs;

        await assertPathWithinBase(targetAbs, baseAbs);
        const stats = await fs.stat(targetAbs);
        const includeMatcher = typeof args.include === 'string' && args.include.trim()
          ? compileGlobMatcher(args.include)
          : undefined;
        const includeIgnored = args.includeIgnored === true;

        let filesToSearch: ScannedFile[] = [];
        let fileScanTruncated = false;
        let skippedIgnoredDirs: string[] = [];
        if (stats.isFile()) {
          const relPath = toPosixRelativePath(baseAbs, targetAbs);
          if (!includeMatcher || includeMatcher(relPath, path.basename(targetAbs))) {
            filesToSearch = [{ absPath: targetAbs, relPath }];
          }
        } else if (stats.isDirectory()) {
          const collected = await collectFiles(targetAbs, baseAbs, {
            fileMatcher: includeMatcher,
            maxFiles: MAX_SEARCH_FILES,
            includeIgnored
          });
          filesToSearch = collected.files;
          fileScanTruncated = collected.truncated;
          skippedIgnoredDirs = collected.skippedIgnoredDirs;
        } else {
          return `❌ Path "${args.path || '.'}" is neither a valid file nor directory.`;
        }

        const scopeInfo = args.scope ? ` (${args.scope})` : '';
        if (filesToSearch.length === 0) {
          const skippedNote = skippedIgnoredDirs.length > 0
            ? ` (skipped ignored directories: ${skippedIgnoredDirs.join(', ')}; set includeIgnored=true to include)`
            : '';
          return `ℹ️ No eligible files to search under "${args.path || '.'}"${scopeInfo}${skippedNote}.`;
        }

        const contextLines = clampInteger(args.contextLines, 0, 0, 5);
        const maxResults = clampInteger(args.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_LIMIT);

        const outputBlocks: string[] = [];
        let matchedFileCount = 0;
        let totalMatches = 0;
        let truncated = false;
        let singleFileSkipReason: string | undefined;
        let regexTimeoutError: RegexTimeoutError | null = null;

        for (let offset = 0; offset < filesToSearch.length; offset += SEARCH_CONCURRENCY) {
          const remaining = maxResults - totalMatches;
          const probeLimit = remaining > 0 ? remaining : 1;

          const batch = filesToSearch.slice(offset, offset + SEARCH_CONCURRENCY);
          const batchResults = await Promise.allSettled(
            batch.map((file) => searchSingleFile(file, matcher, probeLimit))
          );

          for (let i = 0; i < batchResults.length; i++) {
            const settled = batchResults[i];
            if (settled.status === 'rejected') {
              if (settled.reason instanceof RegexTimeoutError) {
                regexTimeoutError = settled.reason;
                break;
              }
              throw settled.reason;
            }
            const result = settled.value;
            if (!result) continue;
            if (result.matchedIndices.length === 0) {
              if (stats.isFile() && result.skipReason) {
                singleFileSkipReason = result.skipReason;
              }
              continue;
            }

            const allowance = maxResults - totalMatches;
            if (allowance <= 0) {
              truncated = true;
              break;
            }

            if (result.matchedIndices.length > allowance) {
              const trimmedIndices = result.matchedIndices.slice(0, allowance);
              outputBlocks.push(
                ...formatMatchBlocks(result.relPath, result.lines, trimmedIndices, contextLines)
              );
              matchedFileCount += 1;
              totalMatches += trimmedIndices.length;
              truncated = true;
              break;
            }

            outputBlocks.push(
              ...formatMatchBlocks(result.relPath, result.lines, result.matchedIndices, contextLines)
            );
            matchedFileCount += 1;
            totalMatches += result.matchedIndices.length;
            if (result.truncated) {
              truncated = true;
              break;
            }
          }

          if (truncated || regexTimeoutError) break;
        }

        if (regexTimeoutError && totalMatches === 0) {
          return `❌ Regular expression search timed out for "${args.query}": ${regexTimeoutError.message} Simplify the pattern or use plain text search (isRegex: false).`;
        }

        if (totalMatches === 0) {
          if (singleFileSkipReason) {
            return `ℹ️ Skipped "${args.path || '.'}": ${singleFileSkipReason}`;
          }
          const noMatchNotes: string[] = [];
          if (fileScanTruncated) {
            noMatchNotes.push(`file scan capped at ${MAX_SEARCH_FILES} files`);
          }
          if (skippedIgnoredDirs.length > 0) {
            noMatchNotes.push(`skipped ignored directories: ${skippedIgnoredDirs.join(', ')}; set includeIgnored=true to include`);
          }
          const scanNote = noMatchNotes.length > 0 ? ` (${noMatchNotes.join(', ')})` : '';
          return `ℹ️ No matches found for "${args.query}" under "${args.path || '.'}"${scopeInfo}${scanNote}.`;
        }

        const blockSeparator = contextLines > 0 ? '\n--\n' : '\n';
        const outputBody = outputBlocks.join(blockSeparator);
        const noteParts: string[] = [];
        if (truncated) {
          noteParts.push(`truncated at limit ${maxResults}`);
        }
        if (regexTimeoutError) {
          noteParts.push(`search stopped early with partial results: ${regexTimeoutError.message}`);
        }
        if (fileScanTruncated) {
          noteParts.push(`file scan capped at ${MAX_SEARCH_FILES} files`);
        }
        if (skippedIgnoredDirs.length > 0) {
          noteParts.push(`skipped ignored directories: ${skippedIgnoredDirs.join(', ')}`);
        }
        const truncatedNote = noteParts.length > 0 ? ` (${noteParts.join(', ')})` : '';

        return `ℹ️ Found ${totalMatches} match(es) across ${matchedFileCount} file(s)${scopeInfo}${truncatedNote}:\n${outputBody}`;
      } finally {
        await matcher.dispose?.();
      }
    } catch (err: any) {
      if (err instanceof RegexTimeoutError) {
        return `❌ Regular expression search timed out for "${args.query}": ${err.message} Simplify the pattern or use plain text search (isRegex: false).`;
      }
      return handleFsError(this.ctx!, 'search text', err, baseAbs);
    }
  }
}
