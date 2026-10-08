import type { FreyaContext, ToolDefinition, FreyaTool } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface MemoryItem {
  id: string;
  time: string;
  content: string;
}

export interface MemoryIndexData {
  index: Record<string, string[]>;
}

export function getIndexFilePath(dataDir: string): string {
  return path.resolve(dataDir, 'memories.json');
}

export function getMemoriesSubdirPath(dataDir: string): string {
  return path.resolve(dataDir, 'memories');
}

export function getDateFilePath(dataDir: string, dateStr: string): string {
  const safeDate = dateStr.replace(/[^0-9-]/g, '');
  return path.resolve(getMemoriesSubdirPath(dataDir), `${safeDate}.json`);
}

export async function ensureIndexFile(dataDir: string): Promise<void> {
  const filePath = getIndexFilePath(dataDir);
  const dirPath = path.dirname(filePath);

  await fs.mkdir(dirPath, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    const initialData: MemoryIndexData = { index: {} };
    await fs.writeFile(filePath, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

export async function ensureSubdirExists(dataDir: string): Promise<void> {
  const subdir = getMemoriesSubdirPath(dataDir);
  await fs.mkdir(subdir, { recursive: true });
}

export async function readIndex(dataDir: string): Promise<MemoryIndexData> {
  await ensureIndexFile(dataDir);
  const filePath = getIndexFilePath(dataDir);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { index: {} };
  }
}

export async function writeIndex(dataDir: string, data: MemoryIndexData): Promise<void> {
  await ensureIndexFile(dataDir);
  const filePath = getIndexFilePath(dataDir);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function readDateMemory(dataDir: string, dateStr: string): Promise<MemoryItem[]> {
  await ensureSubdirExists(dataDir);
  const filePath = getDateFilePath(dataDir, dateStr);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function writeDateMemory(dataDir: string, dateStr: string, list: MemoryItem[]): Promise<void> {
  await ensureSubdirExists(dataDir);
  const filePath = getDateFilePath(dataDir, dateStr);
  if (list.length === 0) {
    try {
      await fs.unlink(filePath);
    } catch { }
    return;
  }
  await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf-8');
}

function getFormattedDateTime(): { date: string; time: string } {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dateStr = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return {
    date: `${year}-${month}-${dateStr}`,
    time: `${hours}:${minutes}:${seconds}`
  };
}

function cleanPathFromError(err: any, ctx: FreyaContext): string {
  const rawMessage = err?.message || String(err);
  const homeDir = ctx.paths.homeDir;
  const escapedPath = homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedPath + '[\\\\/]?', 'g');
  return rawMessage.replace(regex, '');
}

/**
 * 统一记忆错误处理与物理路径脱敏
 * Unified memory error handling and physical path sanitization
 */
export function handleMemoryError(action: string, err: any, ctx: FreyaContext): string {
  // 记忆操作失败提示
  return `❌ Failed to ${action}: ${cleanPathFromError(err, ctx)}`;
}

export class SaveMemoryTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) {}

  getDefinition(): ToolDefinition {
    return {
      name: 'memory_save',
      description: 'Add an important long-term memory entry into the memory store. Parameter content is the fact or preference to record; keywords must be 1-3 self-extracted core terms (no spaces) for future fuzzy retrieval.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Specific fact, preference, or background information to record'
          },
          keywords: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Self-extracted relevant core keyword list (e.g. ["cat", "pet", "coffee"])'
          }
        },
        required: ['content', 'keywords']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.content || !Array.isArray(args.keywords) || args.keywords.length === 0) {
      return '❌ Parameter error: Must specify memory content and keyword list.';
    }

    try {
      const dataDir = this.ctx?.paths.dataDir || '';
      const indexData = await readIndex(dataDir);
      const { date, time } = getFormattedDateTime();
      const id = `mem_${Date.now()}`;

      const dateList = await readDateMemory(dataDir, date);
      dateList.push({ id, time, content: args.content });
      await writeDateMemory(dataDir, date, dateList);

      for (const keyword of args.keywords) {
        const cleanKeyword = keyword.trim().toLowerCase();
        if (!cleanKeyword) continue;
        if (!indexData.index[cleanKeyword]) {
          indexData.index[cleanKeyword] = [];
        }
        if (!indexData.index[cleanKeyword].includes(date)) {
          indexData.index[cleanKeyword].push(date);
        }
      }
      await writeIndex(dataDir, indexData);

      this.ctx?.logger.debug(`[memory_save] Successfully written memory: [${id}] keywords=${JSON.stringify(args.keywords)}`);
      return `ℹ️ Memory saved successfully! (ID: ${id}, Date: ${date})`;
    } catch (err: any) {
      return handleMemoryError('save memory', err, this.ctx!);
    }
  }
}

export class SearchMemoryTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) {}

  getDefinition(): ToolDefinition {
    return {
      name: 'memory_search',
      // 查询关联长期记忆
      description: 'Query associated memories by keyword. System performs fuzzy retrieval and returns historical entries with IDs and timestamps.',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            // 检索核心词
            description: 'Search keyword (e.g. "cat" or "coffee")'
          }
        },
        required: ['keyword']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.keyword) {
      // 缺少检索词参数错误
      return '❌ Parameter error: Must specify search keyword.';
    }

    try {
      const dataDir = this.ctx?.paths.dataDir || '';
      const indexData = await readIndex(dataDir);
      const queryKeyword = args.keyword.trim().toLowerCase();

      let targetDates = indexData.index[queryKeyword] || [];

      if (targetDates.length === 0) {
        for (const [key, dates] of Object.entries(indexData.index)) {
          if (key.includes(queryKeyword) || queryKeyword.includes(key)) {
            targetDates.push(...dates);
          }
        }
        targetDates = Array.from(new Set(targetDates));
      }

      if (targetDates.length === 0) {
        // 未找到相关记忆提示
        return `ℹ️ No long-term memory found associated with keyword "${args.keyword}".`;
      }

      const resultLines: string[] = [];
      targetDates.sort();

      for (const date of targetDates) {
        const list = await readDateMemory(dataDir, date);
        for (const item of list) {
          resultLines.push(`[${date} ${item.time}] (ID: ${item.id}) - ${item.content}`);
        }
      }

      if (resultLines.length === 0) {
        // 未找到具体记忆内容提示
        return `ℹ️ No specific memory content found associated with keyword "${args.keyword}".`;
      }

      // 查询记忆结果出参
      return `🧠 Found associated long-term memories for keyword "${args.keyword}":\n${resultLines.join('\n')}`;
    } catch (err: any) {
      return handleMemoryError('query memory', err, this.ctx!);
    }
  }
}

export class DeleteMemoryTool implements FreyaTool {
  constructor(private ctx?: FreyaContext) {}

  getDefinition(): ToolDefinition {
    return {
      name: 'memory_delete',
      // 删除指定记忆
      description: 'Purge outdated or incorrect memory permanently from the memory store by unique ID (e.g. "mem_1234567"). Query memory first to confirm ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            // 待删除记忆项的唯一 ID
            description: 'Unique ID of the memory item to delete (e.g. "mem_1719999999000")'
          }
        },
        required: ['id']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.id) {
      // 缺少删除 id 参数错误
      return '❌ Parameter error: Must specify memory id to delete.';
    }

    try {
      const dataDir = this.ctx?.paths.dataDir || '';
      const indexData = await readIndex(dataDir);

      const allDates = Array.from(new Set(Object.values(indexData.index).flat()));
      let found = false;

      for (const date of allDates) {
        const list = await readDateMemory(dataDir, date);
        const filteredList = list.filter(item => item.id !== args.id);

        if (filteredList.length !== list.length) {
          found = true;
          await writeDateMemory(dataDir, date, filteredList);
        }
      }

      if (!found) {
        // 未找到记忆项提示
        return `❌ Delete failed: Memory item with ID "${args.id}" not found in memory store.`;
      }

      const activeDates = new Set<string>();
      for (const date of allDates) {
        const list = await readDateMemory(dataDir, date);
        if (list.length > 0) {
          activeDates.add(date);
        }
      }

      for (const [keyword, dates] of Object.entries(indexData.index)) {
        const validDates = dates.filter(d => activeDates.has(d));
        if (validDates.length === 0) {
          delete indexData.index[keyword];
        } else {
          indexData.index[keyword] = validDates;
        }
      }
      await writeIndex(dataDir, indexData);

      this.ctx?.logger.debug(`[delete_memory] Successfully purged memory from disk: [${args.id}]`);
      return `ℹ️ Long-term memory with ID "${args.id}" was successfully deleted, index synchronized.`;
    } catch (err: any) {
      return handleMemoryError('delete memory', err, this.ctx!);
    }
  }
}
