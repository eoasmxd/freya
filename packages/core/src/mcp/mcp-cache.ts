import fs from 'node:fs/promises';
import path from 'node:path';
import { FREYA_HOME } from '../utils/paths.js';
import type { McpCacheData } from './types.js';

/**
 * MCP 元数据与工具定义本地缓存管理器
 * MCP metadata and tools definition local cache manager
 */
export class McpCacheManager {
  private readonly cacheDir = path.join(FREYA_HOME, 'data', 'mcp', 'cache');

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * 加载指定服务的缓存数据
   * Load cached data for specified service
   */
  async loadCache(serverId: string): Promise<McpCacheData | null> {
    try {
      const filePath = path.join(this.cacheDir, `${serverId}.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as McpCacheData;
    } catch {
      return null;
    }
  }

  /**
   * 写入指定服务的缓存数据
   * Save cached data for specified service
   */
  async saveCache(serverId: string, cache: McpCacheData): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.cacheDir, `${serverId}.json`);
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(cache, null, 2), 'utf-8');
    try {
      await fs.rename(tempPath, filePath);
    } catch {
      await fs.copyFile(tempPath, filePath);
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}
