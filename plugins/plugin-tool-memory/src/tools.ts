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
  const projectRoot = ctx.paths.projectRoot;
  const escapedPath = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedPath + '[\\\\/]?', 'g');
  return rawMessage.replace(regex, '');
}

/** 统一记忆错误处理与物理路径脱敏 */
export function handleMemoryError(action: string, err: any, ctx: FreyaContext): string {
  return `❌ ${action}失败: ${cleanPathFromError(err, ctx)}`;
}

export class AddMemoryTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'add_memory',
      description: '向记忆库中添加一条重要的长期记忆。参数 content 需为要记录的具体事实或偏好，keywords 必须为你自主提取的 1-3 个中文核心词（不能带空格），系统会物理绑定日期持久化以供未来模糊搜索。',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '需要被记录的具体事实、偏好或背景信息'
          },
          keywords: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: '自主提取的强相关核心词列表（如：["猫", "咪咪", "宠物"]）'
          }
        },
        required: ['content', 'keywords']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.content || !Array.isArray(args.keywords) || args.keywords.length === 0) {
      return '❌ 参数错误：必须指定具体记忆内容 content 和核心词列表 keywords。';
    }

    try {
      const dataDir = ctx.paths.dataDir;
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

      ctx.logger.debug(`[add_memory] 成功写入多文件记忆: [${id}] keywords=${JSON.stringify(args.keywords)}`);
      return `ℹ️ 记忆保存成功！(ID: ${id}, 日期: ${date})`;
    } catch (err: any) {
      return handleMemoryError('保存记忆', err, ctx);
    }
  }
}

export class QueryMemoryTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'query_memory',
      description: '根据核心检索词查询与之关联的记忆。keyword 应为单个中文核心词，系统将自动进行模糊检索并回溯返回包含 ID 和日期的历史记忆内容。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '检索核心词（如："猫" 或 "黑咖啡"）'
          }
        },
        required: ['keyword']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.keyword) {
      return '❌ 参数错误：必须指定检索的核心词 keyword。';
    }

    try {
      const dataDir = ctx.paths.dataDir;
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
        return `ℹ️ 记忆库中未找到与核心词 "${args.keyword}" 相关的长期记忆。`;
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
        return `ℹ️ 记忆库中未找到与核心词 "${args.keyword}" 相关的具体记忆内容。`;
      }

      return `🧠 找到与核心词 "${args.keyword}" 关联的长期记忆如下：\n${resultLines.join('\n')}`;
    } catch (err: any) {
      return handleMemoryError('查询记忆', err, ctx);
    }
  }
}

export class DeleteMemoryTool implements FreyaTool {

  getDefinition(): ToolDefinition {
    return {
      name: 'delete_memory',
      description: '根据唯一 ID 从记忆库中彻底擦除过时或错误的记忆。id 需传入形如 "mem_1234567" 的物理标识，删除前建议先 query_memory 确认 id。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '待删除记忆项的唯一 ID（例如："mem_1719999999000"）'
          }
        },
        required: ['id']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    if (!args.id) {
      return '❌ 参数错误：必须指定待删除记忆的 id。';
    }

    try {
      const dataDir = ctx.paths.dataDir;
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
        return `❌ 删除失败：在记忆库中未找到 ID 为 "${args.id}" 的记忆项。`;
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

      ctx.logger.debug(`[delete_memory] 成功从物理多文件中擦除记忆: [${args.id}]`);
      return `ℹ️ ID 为 "${args.id}" 的长期记忆已被成功删除，索引已同步修剪。`;
    } catch (err: any) {
      return handleMemoryError('删除记忆', err, ctx);
    }
  }
}
