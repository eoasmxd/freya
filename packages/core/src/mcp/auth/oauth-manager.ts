import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { McpAuthOAuth, McpAuthStartResult } from '../types.js';
import { McpOAuthProvider } from './oauth-provider.js';
import { TokenStore } from './token-store.js';

/**
 * MCP OAuth 授权中心管理器，统筹多服务的认证流与回调分发
 * Central OAuth manager orchestrating multi-server authorization flows and callback dispatching
 */
export class McpOAuthManager {
  private providers = new Map<string, McpOAuthProvider>();
  private onAuthSuccess?: (serverId: string) => Promise<void>;
  private readonly tokenStore: TokenStore;

  constructor(
    tokenStore?: TokenStore,
    private readonly context?: FreyaContext
  ) {
    this.tokenStore = tokenStore || new TokenStore();
  }

  /**
   * 设置授权成功后的全局回调处理函数
   * Set global callback handler invoked upon successful authorization
   */
  setOnAuthSuccess(callback: (serverId: string) => Promise<void>): void {
    this.onAuthSuccess = callback;
  }

  /**
   * 注册服务的 OAuth 配置
   * Register OAuth configuration for specified server
   */
  registerServer(serverId: string, config: McpAuthOAuth): void {
    const provider = new McpOAuthProvider(serverId, config, this.tokenStore, this.context);
    this.providers.set(serverId, provider);
  }

  /**
   * 获取指定服务的 OAuth 提供者
   * Get OAuth provider for specified server
   */
  getProvider(serverId: string): McpOAuthProvider | undefined {
    return this.providers.get(serverId);
  }

  /**
   * 启动指定服务的 OAuth 流程，优先使用设备授权模式，不支持时平滑降级
   * Start OAuth flow, prioritizing Device Authorization Grant (RFC 8628) with fallback
   */
  async startAuth(serverId: string, callbackUrl?: string): Promise<McpAuthStartResult> {
    const provider = this.providers.get(serverId);
    if (!provider) {
      throw new Error(`Server '${serverId}' does not support OAuth authentication.`);
    }

    try {
      const deviceUrl = await provider.resolveDeviceAuthUrl();
      if (deviceUrl) {
        const info = await provider.startDeviceAuth(this.onAuthSuccess);
        return {
          type: 'device',
          serverId,
          info
        };
      }
    } catch (err: any) {
      this.context?.logger.warn(`[McpOAuthManager] Device flow probe failed for '${serverId}': ${err.message}`);
    }

    const redirectUri = callbackUrl || this.getDefaultRedirectUri();
    const authorizationUrl = await provider.startAuth(redirectUri);
    return {
      type: 'code',
      serverId,
      authorizationUrl
    };
  }

  /**
   * 动态解析默认重定向 URL（结合当前 Web 配置端口）
   * Dynamically resolve default redirect URI matching WebContainer port
   */
  private getDefaultRedirectUri(): string {
    const port = (this.context?.config as any)?.server?.port ?? 3000;
    return `http://localhost:${port}/api/mcp/oauth/callback`;
  }

  /**
   * 处理回调参数并自动完成换票，返回对应的服务 ID
   * Process callback parameters, complete token exchange and return matching server ID
   */
  async handleCallback(code: string, state: string, serverIdHint?: string): Promise<string> {
    let targetServerId = serverIdHint;

    if (!targetServerId) {
      for (const serverId of this.providers.keys()) {
        const pending = await this.tokenStore.loadPendingAuth(serverId);
        if (pending?.state === state) {
          targetServerId = serverId;
          break;
        }
      }
    }

    if (!targetServerId) {
      throw new Error('No pending OAuth session found matching this state.');
    }

    const provider = this.providers.get(targetServerId);
    if (!provider) {
      throw new Error(`Server '${targetServerId}' is not configured for OAuth.`);
    }

    await provider.exchangeCode(code, state);
    if (this.onAuthSuccess) {
      await this.onAuthSuccess(targetServerId);
    }
    return targetServerId;
  }

  /**
   * 停止所有后台轮询任务
   * Stop all active background polling tasks
   */
  stop(): void {
    for (const provider of this.providers.values()) {
      provider.abortPolling();
    }
  }
}
