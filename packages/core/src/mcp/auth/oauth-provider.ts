import crypto from 'node:crypto';
import type { FreyaContext } from '@eoasmxd/freya-sdk';
import {
  McpAuthRequiredError,
  type McpAuthOAuth,
  type McpDeviceAuthInfo,
  type McpOAuthPendingAuth,
  type McpOAuthTokenData
} from '../types.js';
import { TokenStore } from './token-store.js';

/**
 * 原生 OAuth 2.1 认证提供者（支持 PKCE、设备码模式、自动刷新与并发单飞锁）
 * Native OAuth 2.1 provider with PKCE, Device Flow (RFC 8628), auto-refresh and mutex lock
 */
export class McpOAuthProvider {
  private refreshPromise?: Promise<string>;
  private activePollingAbort?: AbortController;
  private authHeaderHint?: string;
  private responseBodyHint?: string;
  private discoveredScopes?: string[];
  private discoveredResource?: string;
  private registrationEndpoint?: string;
  private registeredClientId?: string;
  private registeredClientSecret?: string;

  constructor(
    private readonly serverId: string,
    private readonly config: McpAuthOAuth,
    private readonly tokenStore: TokenStore,
    private readonly context?: FreyaContext,
    private readonly serverUrl?: string
  ) {}

  /**
   * 记录来自 401 响应的挑战头与提示响应体
   * Store challenge header and response body hints from 401 Unauthorized
   */
  setAuthHint(authHeader?: string, responseBody?: string): void {
    this.authHeaderHint = authHeader;
    this.responseBodyHint = responseBody;
  }

  /**
   * 解析或动态探测 OAuth 2.1 规范端点 (RFC 8414 / RFC 9728 / OIDC Discovery / 401 Hints)
   * Discover or resolve standard OAuth 2.1 authorization server endpoints
   */
  async resolveEndpoints(): Promise<{ authorizationUrl?: string; tokenUrl?: string; deviceAuthorizationUrl?: string }> {
    let authUrl = this.config.authorizationUrl;
    let tokenUrl = this.config.tokenUrl;
    let deviceUrl = this.config.deviceAuthorizationUrl;

    if (authUrl && tokenUrl && deviceUrl) {
      return { authorizationUrl: authUrl, tokenUrl, deviceAuthorizationUrl: deviceUrl };
    }

    if (this.responseBodyHint) {
      try {
        const bodyData = JSON.parse(this.responseBodyHint);
        if (!authUrl) authUrl = bodyData.authorization_endpoint || bodyData.authorization_url || bodyData.authUrl || bodyData.loginUrl || bodyData.login_url;
        if (!tokenUrl) tokenUrl = bodyData.token_endpoint || bodyData.token_url || bodyData.tokenUrl;
        if (!deviceUrl) deviceUrl = bodyData.device_authorization_endpoint || bodyData.device_url || bodyData.deviceUrl;
      } catch {}
    }

    let resourceMetadataUrl: string | undefined;
    if (this.authHeaderHint) {
      const authUriMatch = this.authHeaderHint.match(/(?:authorization_uri|auth_url|authorization_endpoint)=["']?([^"',\s]+)["']?/i);
      if (authUriMatch && !authUrl) {
        authUrl = authUriMatch[1];
      }
      const tokenUriMatch = this.authHeaderHint.match(/(?:token_uri|token_url|token_endpoint)=["']?([^"',\s]+)["']?/i);
      if (tokenUriMatch && !tokenUrl) {
        tokenUrl = tokenUriMatch[1];
      }
      const resourceMetaMatch = this.authHeaderHint.match(/resource_metadata=["']?([^"',\s]+)["']?/i);
      if (resourceMetaMatch) {
        resourceMetadataUrl = resourceMetaMatch[1];
      }
    }

    if (authUrl && tokenUrl) {
      return { authorizationUrl: authUrl, tokenUrl, deviceAuthorizationUrl: deviceUrl };
    }

    const candidateUrl = this.serverUrl || this.config.authorizationUrl || this.config.tokenUrl;
    if (candidateUrl) {
      try {
        const parsed = new URL(candidateUrl);
        const path = parsed.pathname.replace(/\/+$/, '');
        const probeQueue: string[] = [];

        if (resourceMetadataUrl) {
          probeQueue.push(resourceMetadataUrl);
        }

        if (path && path !== '') {
          probeQueue.push(`${parsed.origin}/.well-known/oauth-protected-resource${path}`);
          probeQueue.push(`${parsed.origin}/.well-known/oauth-authorization-server${path}`);
          probeQueue.push(`${candidateUrl}/.well-known/openid-configuration`);
        }

        probeQueue.push(`${parsed.origin}/.well-known/oauth-protected-resource`);
        probeQueue.push(`${parsed.origin}/.well-known/oauth-authorization-server`);
        probeQueue.push(`${parsed.origin}/.well-known/openid-configuration`);

        const probeEndpoints = async (url: string) => {
          const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) return;
          const data: any = await res.json();
          if (Array.isArray(data.scopes_supported) && data.scopes_supported.length > 0) {
            this.discoveredScopes = data.scopes_supported;
          }
          if (data.resource && typeof data.resource === 'string') {
            this.discoveredResource = data.resource;
          }
          if (Array.isArray(data.authorization_servers) && data.authorization_servers.length > 0) {
            const authServer = data.authorization_servers[0];
            await probeEndpoints(`${authServer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`);
            await probeEndpoints(`${authServer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
          }
          if (!authUrl) authUrl = data.authorization_endpoint || data.authorization_url;
          if (!tokenUrl) tokenUrl = data.token_endpoint || data.token_url;
          if (!deviceUrl) deviceUrl = data.device_authorization_endpoint || data.device_url;
          if (!this.registrationEndpoint && data.registration_endpoint) {
            this.registrationEndpoint = data.registration_endpoint;
          }
        };

        for (const metaUrl of probeQueue) {
          try {
            await probeEndpoints(metaUrl);
            if (authUrl && tokenUrl && deviceUrl) break;
          } catch {}
        }
      } catch {}
    }

    return { authorizationUrl: authUrl, tokenUrl, deviceAuthorizationUrl: deviceUrl };
  }

  /**
   * 生成 PKCE Code Verifier 与 Code Challenge
   * Generate PKCE code verifier and code challenge
   */
  private generatePkce(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
    return { verifier, challenge };
  }

  /**
   * 启动 OAuth 流程，生成授权重定向 URL 并保存中间态
   * Start OAuth flow, generate authorization redirect URL and save pending state
   */
  async startAuth(callbackUrl: string): Promise<string> {
    const endpoints = await this.resolveEndpoints();
    const authUrl = endpoints.authorizationUrl;
    const tokenUrl = endpoints.tokenUrl;
    const clientId = await this.ensureClientId(callbackUrl);

    if (!authUrl || !tokenUrl) {
      throw new Error(`[McpOAuth] Failed to resolve authorizationUrl or tokenUrl for server '${this.serverId}'.`);
    }

    const { verifier, challenge } = this.generatePkce();
    const state = crypto.randomBytes(16).toString('hex');

    const pending: McpOAuthPendingAuth = {
      state,
      codeVerifier: verifier,
      redirectUri: callbackUrl,
      authorizationUrl: authUrl,
      tokenUrl,
      clientId,
      createdAt: Date.now()
    };

    await this.tokenStore.savePendingAuth(this.serverId, pending);

    const url = new URL(authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);

    if (this.config.scopes && this.config.scopes.length > 0) {
      url.searchParams.set('scope', this.config.scopes.join(' '));
    }
    const targetResource = this.discoveredResource || this.serverUrl;
    if (targetResource) {
      url.searchParams.set('resource', targetResource);
    }

    return url.toString();
  }

  /**
   * 使用授权码换取 Token
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string, state: string): Promise<void> {
    const pending = await this.tokenStore.loadPendingAuth(this.serverId);
    if (!pending || pending.state !== state) {
      throw new Error(`[McpOAuth] Invalid state parameter or expired auth session.`);
    }

    const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;
    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      await this.tokenStore.clearPendingAuth(this.serverId);
      throw new Error(`[McpOAuth] OAuth authentication session expired. Please initiate authorization again.`);
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier
    });

    const clientSecret = this.getClientSecret();
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const res = await fetch(pending.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[McpOAuth] Token exchange failed: ${err.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const token: McpOAuthTokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'Bearer',
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope
    };

    await this.tokenStore.saveToken(this.serverId, token);
    await this.tokenStore.clearPendingAuth(this.serverId);
  }

  /**
   * 获取有效 Token（含单飞锁与主动刷新机制）
   * Get valid access token with mutex lock and auto-refresh
   */
  async getValidToken(): Promise<string> {
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    const token = await this.tokenStore.loadToken(this.serverId);
    if (!token) {
      throw new McpAuthRequiredError(`No access token found for server '${this.serverId}'`);
    }

    if (!token.expiresAt || token.expiresAt - Date.now() > 60000) {
      return token.accessToken;
    }

    if (!token.refreshToken) {
      throw new McpAuthRequiredError(`Access token expired and no refresh token for server '${this.serverId}'`);
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshToken(token.refreshToken).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return await this.refreshPromise;
  }

  /**
   * 强制刷新 Access Token
   * Force refresh access token using stored refresh token
   */
  async forceRefreshToken(): Promise<boolean> {
    const token = await this.tokenStore.loadToken(this.serverId);
    if (!token?.refreshToken) return false;
    try {
      await this.refreshToken(token.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 刷新 Token
   * Refresh access token using refresh token
   */
  private async refreshToken(refreshToken: string): Promise<string> {
    const endpoints = await this.resolveEndpoints();
    const tokenUrl = endpoints.tokenUrl || this.config.tokenUrl;
    if (!tokenUrl) {
      throw new McpAuthRequiredError(`Missing tokenUrl for refresh on server '${this.serverId}'`);
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId || 'freya-client'
    });

    const clientSecret = this.getClientSecret();
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!res.ok) {
      this.context?.logger.warn(`[McpOAuth] Refresh token failed for server '${this.serverId}'. User re-auth required.`);
      throw new McpAuthRequiredError(`Failed to refresh token for server '${this.serverId}'`);
    }

    const data: any = await res.json();
    const newToken: McpOAuthTokenData = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      tokenType: data.token_type || 'Bearer',
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope
    };

    await this.tokenStore.saveToken(this.serverId, newToken);
    return newToken.accessToken;
  }

  async resolveDeviceAuthUrl(): Promise<string | undefined> {
    const endpoints = await this.resolveEndpoints();
    return endpoints.deviceAuthorizationUrl;
  }

  /**
   * 统一获取客户端密钥（优先使用显式配置，其次使用 RFC 7591 动态注册结果）
   * Get client secret prioritizing explicit config with fallback to RFC 7591 dynamic result
   */
  private getClientSecret(): string | undefined {
    return this.config.clientSecret || this.registeredClientSecret;
  }

  /**
   * 依据 RFC 7591 执行动态客户端注册以获取合法 client_id
   * Dynamically register client via RFC 7591 to obtain client_id
   */
  async ensureClientId(redirectUri?: string): Promise<string> {
    if (this.config.clientId) {
      return this.config.clientId;
    }
    if (this.registeredClientId) {
      return this.registeredClientId;
    }

    const cachedClient = await this.tokenStore.loadClientInfo(this.serverId);
    if (cachedClient?.clientId) {
      this.registeredClientId = cachedClient.clientId;
      this.registeredClientSecret = cachedClient.clientSecret;
      return cachedClient.clientId;
    }

    await this.resolveEndpoints();
    if (this.registrationEndpoint) {
      try {
        const fallbackRedirect = redirectUri || 'http://localhost/callback';
        const payload: Record<string, any> = {
          client_name: 'freya-mcp-client',
          token_endpoint_auth_method: 'none',
          redirect_uris: [fallbackRedirect],
          grant_types: [
            'authorization_code',
            'refresh_token',
            'urn:ietf:params:oauth:grant-type:device_code'
          ],
          response_types: ['code']
        };

        const res = await fetch(this.registrationEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`[McpOAuth] Dynamic client registration rejected (${res.status}): ${errText.slice(0, 300)}`);
        }

        const data: any = await res.json();
        if (data.client_id) {
          const resolvedId = String(data.client_id);
          this.registeredClientId = resolvedId;
          if (data.client_secret) {
            this.registeredClientSecret = String(data.client_secret);
          }
          await this.tokenStore.saveClientInfo(this.serverId, {
            clientId: resolvedId,
            clientSecret: this.registeredClientSecret,
            registeredAt: Date.now()
          });
          return resolvedId;
        }
      } catch (err: any) {
        this.context?.logger.warn(`[McpOAuth] RFC 7591 Dynamic client registration failed: ${err.message}`);
        throw err;
      }
    }

    return 'freya-mcp-client';
  }

  /**
   * 启动设备码流程并在后台自动轮询换票
   * Start RFC 8628 device flow and start background token polling
   */
  async startDeviceAuth(onSuccess?: (serverId: string) => Promise<void>): Promise<McpDeviceAuthInfo> {
    const endpoints = await this.resolveEndpoints();
    const deviceUrl = endpoints.deviceAuthorizationUrl;
    const tokenUrl = endpoints.tokenUrl || this.config.tokenUrl;

    if (!deviceUrl || !tokenUrl) {
      throw new Error(`[McpOAuth] Server '${this.serverId}' does not support device flow (missing deviceUrl or tokenUrl).`);
    }

    const clientId = await this.ensureClientId();
    const body = new URLSearchParams({
      client_id: clientId
    });

    const scopes = this.config.scopes?.length ? this.config.scopes : this.discoveredScopes;
    if (scopes && scopes.length > 0) {
      body.set('scope', scopes.join(' '));
    }
    if (this.discoveredResource) {
      body.set('resource', this.discoveredResource);
    }

    const res = await fetch(deviceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[McpOAuth] Device authorization request failed: ${err.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const info: McpDeviceAuthInfo = {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri || data.verification_url,
      verificationUriComplete: data.verification_uri_complete || data.verification_url_complete,
      expiresIn: data.expires_in || 1800,
      interval: data.interval || 5
    };

    if (this.activePollingAbort) {
      this.activePollingAbort.abort();
    }
    this.activePollingAbort = new AbortController();

    this.pollDeviceToken(
      info.deviceCode,
      tokenUrl,
      info.interval,
      Date.now() + info.expiresIn * 1000,
      this.activePollingAbort.signal,
      onSuccess
    ).catch((err) => {
      this.context?.logger.warn(`[McpOAuth] Background device polling error for server '${this.serverId}':`, err);
    });

    return info;
  }

  /**
   * 中止后台设备授权轮询
   * Abort background device polling
   */
  abortPolling(): void {
    if (this.activePollingAbort) {
      this.activePollingAbort.abort();
      this.activePollingAbort = undefined;
    }
  }

  /**
   * 后台轮询置换设备授权 Token
   * Poll token endpoint in background until user grants authorization or timeout occurs
   */
  private async pollDeviceToken(
    deviceCode: string,
    tokenUrl: string,
    intervalSec: number,
    expiresAt: number,
    signal: AbortSignal,
    onSuccess?: (serverId: string) => Promise<void>
  ): Promise<void> {
    let currentInterval = intervalSec;

    while (Date.now() < expiresAt && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, currentInterval * 1000);
        timer.unref?.();
      });
      if (signal.aborted) return;

      const clientId = await this.ensureClientId();
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: clientId
      });

      const clientSecret = this.getClientSecret();
      if (clientSecret) {
        body.set('client_secret', clientSecret);
      }

      try {
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body,
          signal
        });

        if (res.ok) {
          const data: any = await res.json();
          const token: McpOAuthTokenData = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            tokenType: data.token_type || 'Bearer',
            expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
            scope: data.scope
          };

          await this.tokenStore.saveToken(this.serverId, token);
          this.context?.logger.info(`[McpOAuth] Device authorization succeeded for server '${this.serverId}'.`);

          if (onSuccess) {
            await onSuccess(this.serverId);
          }
          return;
        }

        const data: any = await res.json().catch(() => ({}));
        const errType = data.error;

        if (errType === 'authorization_pending') {
          continue;
        } else if (errType === 'slow_down') {
          currentInterval += 5;
          continue;
        } else if (errType === 'expired_token' || errType === 'access_denied') {
          this.context?.logger.warn(`[McpOAuth] Device authorization stopped for '${this.serverId}': ${errType}`);
          return;
        } else {
          this.context?.logger.warn(`[McpOAuth] Device polling received error for '${this.serverId}': ${JSON.stringify(data)}`);
          return;
        }
      } catch (err: any) {
        if (signal.aborted) return;
        this.context?.logger.warn(`[McpOAuth] Poll request error for '${this.serverId}': ${err.message}`);
      }
    }
  }
}
