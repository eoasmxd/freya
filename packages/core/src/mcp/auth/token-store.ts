import fs from 'node:fs/promises';
import path from 'node:path';
import { FREYA_HOME } from '../../utils/paths.js';
import type { McpOAuthTokenData, McpOAuthPendingAuth } from '../types.js';

/**
 * OAuth 凭据原子落盘存储管理
 * OAuth token and pending authentication state persistent store
 */
export class TokenStore {
  private readonly authDir = path.join(FREYA_HOME, 'data', 'mcp', 'auth');

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.authDir, { recursive: true });
  }

  /**
   * 读取服务当前持久化的 Token
   * Load persisted token for specified server
   */
  async loadToken(serverId: string): Promise<McpOAuthTokenData | null> {
    try {
      const filePath = path.join(this.authDir, `${serverId}.token.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as McpOAuthTokenData;
    } catch {
      return null;
    }
  }

  /**
   * 原子化保存 Token
   * Atomically save token for specified server
   */
  async saveToken(serverId: string, token: McpOAuthTokenData): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.authDir, `${serverId}.token.json`);
    const tempPath = `${filePath}.tmp.${Date.now()}`;

    await fs.writeFile(tempPath, JSON.stringify(token, null, 2), { mode: 0o600 });
    try {
      await fs.rename(tempPath, filePath);
    } catch {
      await fs.copyFile(tempPath, filePath);
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  /**
   * 保存待验证的 OAuth 中间态
   * Save pending OAuth authentication state
   */
  async savePendingAuth(serverId: string, pending: McpOAuthPendingAuth): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.authDir, `${serverId}.pending.json`);
    await fs.writeFile(filePath, JSON.stringify(pending, null, 2), { mode: 0o600 });
  }

  /**
   * 获取待验证的 OAuth 中间态
   * Load pending OAuth authentication state
   */
  async loadPendingAuth(serverId: string): Promise<McpOAuthPendingAuth | null> {
    try {
      const filePath = path.join(this.authDir, `${serverId}.pending.json`);
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as McpOAuthPendingAuth;
    } catch {
      return null;
    }
  }

  /**
   * 清除待验证的 OAuth 中间态
   * Clear pending OAuth authentication state
   */
  async clearPendingAuth(serverId: string): Promise<void> {
    try {
      const filePath = path.join(this.authDir, `${serverId}.pending.json`);
      await fs.unlink(filePath);
    } catch {}
  }
}
