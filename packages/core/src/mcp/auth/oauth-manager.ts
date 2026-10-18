import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { McpAuthOAuth, McpAuthStartResult } from '../types.js';
import { McpOAuthProvider } from './oauth-provider.js';
import { TokenStore } from './token-store.js';
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

/**
 * MCP OAuth 授权中心管理器，统筹多服务的认证流与回调分发
 * Central OAuth manager orchestrating multi-server authorization flows and callback dispatching
 */
export class McpOAuthManager {
  private providers = new Map<string, McpOAuthProvider>();
  private onAuthSuccess?: (serverId: string) => Promise<void>;
  private readonly tokenStore: TokenStore;
  private readonly i18n: I18n;
  private callbackPort?: number;
  private serverUrlResolver?: (serverId: string) => string | undefined;

  constructor(
    tokenStore?: TokenStore,
    private readonly context?: FreyaContext
  ) {
    this.tokenStore = tokenStore || new TokenStore();
    this.i18n = new I18n({ zh, en }, this.context);
  }

  setServerUrlResolver(resolver: (serverId: string) => string | undefined): void {
    this.serverUrlResolver = resolver;
  }

  /**
   * 设置授权成功后的全局回调处理函数
   * Set global callback handler invoked upon successful authorization
   */
  setOnAuthSuccess(callback: (serverId: string) => Promise<void>): void {
    this.onAuthSuccess = callback;
  }

  /**
   * 设置 Web 服务实际监听端口，用于生成默认回调地址
   * Set actual Web server listening port used for default redirect URI
   */
  setCallbackPort(port: number): void {
    this.callbackPort = port;
  }

  /**
   * 注册服务的 OAuth 配置
   * Register OAuth configuration for specified server
   */
  registerServer(serverId: string, config: McpAuthOAuth, serverUrl?: string): void {
    const url = serverUrl || this.serverUrlResolver?.(serverId);
    const provider = new McpOAuthProvider(serverId, config, this.tokenStore, this.context, url);
    this.providers.set(serverId, provider);
  }

  /**
   * 获取指定服务的 OAuth 提供者（支持按需根据服务端点自动创建）
   * Get OAuth provider for specified server with on-demand fallback
   */
  getProvider(serverId: string): McpOAuthProvider | undefined {
    let provider = this.providers.get(serverId);
    if (!provider) {
      const url = this.serverUrlResolver?.(serverId);
      if (url) {
        provider = new McpOAuthProvider(serverId, { type: 'oauth' }, this.tokenStore, this.context, url);
        this.providers.set(serverId, provider);
      }
    }
    return provider;
  }

  /**
   * 启动指定服务的 OAuth 流程，优先使用设备授权模式，不支持时平滑降级
   * Start OAuth flow, prioritizing Device Authorization Grant (RFC 8628) with fallback
   */
  async startAuth(serverId: string, callbackUrl?: string): Promise<McpAuthStartResult> {
    const provider = this.getProvider(serverId);
    if (!provider) {
      throw new Error(this.i18n.t('mcp.error.oauthNotSupported', `Server '${serverId}' does not support OAuth authentication.`, { serverId }));
    }

    const deviceUrl = await provider.resolveDeviceAuthUrl().catch(() => undefined);
    if (deviceUrl) {
      try {
        const info = await provider.startDeviceAuth(this.onAuthSuccess);
        return {
          type: 'device',
          serverId,
          info
        };
      } catch (err: any) {
        this.context?.logger.warn(
          `[McpOAuthManager] Device flow failed for '${serverId}' (${err.message}), falling back to authorization code flow.`
        );
      }
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
    const port = this.callbackPort ?? (this.context?.config as any)?.server?.port ?? 3000;
    return `http://localhost:${port}/api/mcp/oauth/callback`;
  }

  /**
   * 处理回调参数并自动完成换票，返回对应的服务 ID
   * Process callback parameters, complete token exchange and return matching server ID
   */
  async handleCallback(code: string, state: string, serverIdHint?: string): Promise<string> {
    let targetServerId = serverIdHint;

    if (!targetServerId) {
      const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;
      for (const serverId of this.providers.keys()) {
        const pending = await this.tokenStore.loadPendingAuth(serverId);
        if (pending && Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
          await this.tokenStore.clearPendingAuth(serverId);
          continue;
        }
        if (pending?.state === state) {
          targetServerId = serverId;
          break;
        }
      }
    }

    if (!targetServerId) {
      throw new Error(this.i18n.t('mcp.error.noPendingSession', 'No pending OAuth session found matching this state.'));
    }

    const provider = this.providers.get(targetServerId);
    if (!provider) {
      throw new Error(this.i18n.t('mcp.error.notConfiguredForOAuth', `Server '${targetServerId}' is not configured for OAuth.`, { serverId: targetServerId }));
    }

    await provider.exchangeCode(code, state);
    if (this.onAuthSuccess) {
      try {
        await this.onAuthSuccess(targetServerId);
      } catch (err: any) {
        this.context?.logger.warn(`[McpOAuthManager] Post-auth probe failed for '${targetServerId}': ${err.message}`);
      }
    }
    return targetServerId;
  }

  /**
   * 尝试强制刷新指定服务的凭据
   * Attempt to force refresh credentials for specified server
   */
  async forceRefreshToken(serverId: string): Promise<boolean> {
    const provider = this.providers.get(serverId);
    if (!provider) return false;
    return await provider.forceRefreshToken();
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
