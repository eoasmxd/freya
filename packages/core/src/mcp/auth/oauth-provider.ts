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
import { I18n } from '../../i18n/index.js';
import { zh } from '../../i18n/locales/zh.js';
import { en } from '../../i18n/locales/en.js';

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
  private discoveredAuthUrl?: string;
  private discoveredTokenUrl?: string;
  private discoveredDeviceUrl?: string;
  private registrationEndpoint?: string;
  private registeredClientId?: string;
  private registeredClientSecret?: string;
  private tokenEndpointAuthMethodsSupported?: string[];
  private grantTypesSupported?: string[];
  private supportsOfflineAccess = false;
  private lastDeviceAuthError?: string;
  private readonly i18n: I18n;

  constructor(
    private readonly serverId: string,
    private readonly config: McpAuthOAuth,
    private readonly tokenStore: TokenStore,
    private readonly context?: FreyaContext,
    private readonly serverUrl?: string
  ) {
    this.i18n = new I18n({ zh, en }, this.context);
  }

  /**
   * 记录来自 401 响应的挑战头与提示响应体
   * Store challenge header and response body hints from 401 Unauthorized
   */
  setAuthHint(authHeader?: string, responseBody?: string): void {
    this.authHeaderHint = authHeader;
    this.responseBodyHint = responseBody;
  }

  getLastDeviceAuthError(): string | undefined {
    return this.lastDeviceAuthError;
  }

  /**
   * 解析或动态探测 OAuth 2.1 规范端点 (RFC 8414 / RFC 9728 / OIDC Discovery / 401 Hints)
   * Discover or resolve standard OAuth 2.1 authorization server endpoints
   */
  async resolveEndpoints(): Promise<{ authorizationUrl?: string; tokenUrl?: string; deviceAuthorizationUrl?: string }> {
    let authUrl = this.config.authorizationUrl || this.discoveredAuthUrl;
    let tokenUrl = this.config.tokenUrl || this.discoveredTokenUrl;
    let deviceUrl = this.config.deviceAuthorizationUrl || this.discoveredDeviceUrl;

    if (authUrl && tokenUrl && deviceUrl) {
      return { authorizationUrl: authUrl, tokenUrl, deviceAuthorizationUrl: deviceUrl };
    }

    if (this.responseBodyHint) {
      try {
        const bodyData = JSON.parse(this.responseBodyHint);
        if (!authUrl) authUrl = bodyData.authorization_endpoint || bodyData.authorization_url || bodyData.authUrl || bodyData.loginUrl || bodyData.login_url;
        if (!tokenUrl) tokenUrl = bodyData.token_endpoint || bodyData.token_url || bodyData.tokenUrl;
        if (!deviceUrl) deviceUrl = bodyData.device_authorization_endpoint || bodyData.device_url || bodyData.deviceUrl;
      } catch { }
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
          probeQueue.push(`${parsed.origin}${path}/.well-known/openid-configuration`);
        }

        probeQueue.push(`${parsed.origin}/.well-known/oauth-protected-resource`);
        probeQueue.push(`${parsed.origin}/.well-known/oauth-authorization-server`);
        probeQueue.push(`${parsed.origin}/.well-known/openid-configuration`);

        const visitedUrls = new Set<string>();
        const buildAuthServerProbeUrls = (authServerUrl: string): string[] => {
          const targets: string[] = [];
          try {
            const authParsed = new URL(authServerUrl);
            const authPath = authParsed.pathname.replace(/\/+$/, '');
            if (authPath) {
              targets.push(`${authParsed.origin}/.well-known/oauth-authorization-server${authPath}`);
              targets.push(`${authParsed.origin}/.well-known/openid-configuration${authPath}`);
              targets.push(`${authParsed.origin}${authPath}/.well-known/oauth-authorization-server`);
              targets.push(`${authParsed.origin}${authPath}/.well-known/openid-configuration`);
            }
            targets.push(`${authParsed.origin}/.well-known/oauth-authorization-server`);
            targets.push(`${authParsed.origin}/.well-known/openid-configuration`);
          } catch { }
          return targets;
        };

        const probeEndpoints = async (url: string) => {
          if (visitedUrls.has(url)) return;
          visitedUrls.add(url);
          const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) return;
          const data: any = await res.json();
          if (Array.isArray(data.scopes_supported) && data.scopes_supported.length > 0) {
            const hasExplicitConfig = Boolean(this.config.scopes && this.config.scopes.length > 0);
            if (!hasExplicitConfig) {
              this.discoveredScopes = data.scopes_supported;
            }
          }
          if (Array.isArray(data.scopes_supported) && data.scopes_supported.includes('offline_access')) {
            this.supportsOfflineAccess = true;
          }
          if (Array.isArray(data.token_endpoint_auth_methods_supported)) {
            this.tokenEndpointAuthMethodsSupported = data.token_endpoint_auth_methods_supported.map(String);
          }
          if (Array.isArray(data.grant_types_supported)) {
            this.grantTypesSupported = data.grant_types_supported.map(String);
          }
          const rawResource = typeof data.resource === 'string'
            ? data.resource
            : (Array.isArray(data.protected_resources) && typeof data.protected_resources[0] === 'string'
              ? data.protected_resources[0]
              : undefined);
          if (rawResource && !this.discoveredResource) {
            if (this.isValidResourceUrl(rawResource)) {
              this.discoveredResource = rawResource;
            } else {
              this.context?.logger.warn(`[McpOAuth] Rejected mismatched resource URL '${rawResource}' for server '${this.serverId}'.`);
            }
          }
          if (!authUrl) authUrl = data.authorization_endpoint || data.authorization_url;
          if (!tokenUrl) tokenUrl = data.token_endpoint || data.token_url;
          if (!deviceUrl) deviceUrl = data.device_authorization_endpoint || data.device_url;
          if (!this.registrationEndpoint && data.registration_endpoint) {
            this.registrationEndpoint = data.registration_endpoint;
          }
          if ((!authUrl || !tokenUrl) && Array.isArray(data.authorization_servers) && data.authorization_servers.length > 0) {
            const authServer = String(data.authorization_servers[0] || '').trim();
            if (authServer) {
              const normalizedAuthServer = authServer.replace(/\/+$/, '');
              for (const subUrl of buildAuthServerProbeUrls(normalizedAuthServer)) {
                try {
                  await probeEndpoints(subUrl);
                  if (authUrl && tokenUrl) break;
                } catch { }
              }
            }
          }
        };

        for (const metaUrl of probeQueue) {
          try {
            await probeEndpoints(metaUrl);
            if (authUrl && tokenUrl) break;
          } catch { }
        }
      } catch { }
    }

    if (authUrl) this.discoveredAuthUrl = authUrl;
    if (tokenUrl) this.discoveredTokenUrl = tokenUrl;
    if (deviceUrl) this.discoveredDeviceUrl = deviceUrl;

    return { authorizationUrl: authUrl, tokenUrl, deviceAuthorizationUrl: deviceUrl };
  }

  /**
   * 依据 MCP 规范裁决最终生效的 Scope 参数
   * Determine effective scope matching MCP SDK priority
   */
  private determineScope(): string | undefined {
    let effectiveScope: string | undefined;

    if (this.config.scopes && this.config.scopes.length > 0) {
      effectiveScope = this.config.scopes.join(' ');
    } else if (this.discoveredScopes && this.discoveredScopes.length > 0) {
      const filteredScopes = !this.registrationEndpoint
        ? this.discoveredScopes.filter((s) => s.toLowerCase() !== 'openid')
        : this.discoveredScopes;
      if (filteredScopes.length > 0) {
        effectiveScope = filteredScopes.join(' ');
      }
    }

    if (this.authHeaderHint) {
      const scopeMatch = this.authHeaderHint.match(/scope=["']?([^"',]+)["']?/i);
      if (scopeMatch && scopeMatch[1]) {
        const requiredScopes = scopeMatch[1].split(/\s+/).filter(Boolean);
        const currentScopes = effectiveScope ? effectiveScope.split(/\s+/).filter(Boolean) : [];
        for (const req of requiredScopes) {
          if (!currentScopes.includes(req)) {
            currentScopes.push(req);
          }
        }
        effectiveScope = currentScopes.join(' ');
      }
    }

    if (effectiveScope && this.supportsOfflineAccess && !effectiveScope.split(' ').includes('offline_access')) {
      effectiveScope = `${effectiveScope} offline_access`;
    }

    return effectiveScope;
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
      resource: this.discoveredResource,
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

    const scope = this.determineScope();
    if (scope) {
      url.searchParams.set('scope', scope);
      if (scope.split(/\s+/).includes('offline_access') && !url.searchParams.has('prompt')) {
        url.searchParams.set('prompt', 'consent');
      }
    }
    if (this.discoveredResource) {
      url.searchParams.set('resource', this.discoveredResource);
    }

    return url.toString();
  }

  /**
   * 校验探测到的 Resource URL 是否与当前 MCP 服务归属同源
   * Validate that discovered Resource URL matches current MCP server origin and path prefix
   */
  private isValidResourceUrl(resourceUrl: string): boolean {
    if (!this.serverUrl) {
      return true;
    }
    try {
      const target = new URL(resourceUrl);
      const server = new URL(this.serverUrl);
      if (target.origin !== server.origin) {
        return false;
      }
      const targetPath = target.pathname.replace(/\/+$/, '');
      const serverPath = server.pathname.replace(/\/+$/, '');
      if (!targetPath) {
        return true;
      }
      return serverPath === targetPath || serverPath.startsWith(`${targetPath}/`);
    } catch {
      return false;
    }
  }

  /**
   * 依据服务端元数据与密钥状态注入 OAuth 客户端认证凭证
   * Apply OAuth client authentication credentials based on server metadata and client secret
   */
  private applyClientAuth(
    headers: Record<string, string>,
    body: URLSearchParams,
    clientId: string,
    clientSecret?: string
  ): void {
    body.set('client_id', clientId);
    if (!clientSecret) {
      return;
    }

    const supportsBasic = !this.tokenEndpointAuthMethodsSupported
      || this.tokenEndpointAuthMethodsSupported.includes('client_secret_basic');
    const supportsPost = Boolean(this.tokenEndpointAuthMethodsSupported?.includes('client_secret_post'));

    if (!supportsBasic && supportsPost) {
      body.set('client_secret', clientSecret);
      return;
    }

    const encoded = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
    headers['Authorization'] = `Basic ${encoded}`;
  }

  private isInvalidClientError(status: number, responseText: string): boolean {
    if (status !== 400 && status !== 401) {
      return false;
    }
    try {
      const parsed = JSON.parse(responseText);
      const errCode = String(parsed?.error || '').toLowerCase();
      if (errCode === 'invalid_client') {
        return true;
      }
    } catch { }
    const lower = responseText.toLowerCase();
    return lower.includes('invalid_client');
  }

  private async clearInvalidDynamicClient(): Promise<boolean> {
    if (this.config.clientId || !this.registrationEndpoint) {
      return false;
    }
    this.registeredClientId = undefined;
    this.registeredClientSecret = undefined;
    await this.tokenStore.clearClientInfo(this.serverId);
    this.context?.logger.warn(`[McpOAuth] Cleared expired dynamic client registration for server '${this.serverId}'.`);
    return true;
  }

  private parseOAuthTokenPayload(rawText: string, fallbackRefreshToken?: string): McpOAuthTokenData {
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = Object.fromEntries(new URLSearchParams(rawText));
    }
    if (data?.error) {
      const desc = data.error_description ? `: ${data.error_description}` : '';
      throw new Error(`${data.error}${desc}`);
    }
    if (!data?.access_token || typeof data.access_token !== 'string') {
      throw new Error(`Missing access_token in token response`);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || fallbackRefreshToken,
      tokenType: data.token_type || 'Bearer',
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope
    };
  }

  /**
   * 判断当前服务是否应采用非交互式 client_credentials（M2M）鉴权模式
   * Determine whether server should use non-interactive client_credentials M2M flow
   */
  private isClientCredentialsMode(endpoints: {
    authorizationUrl?: string;
    tokenUrl?: string;
    deviceAuthorizationUrl?: string;
  }): boolean {
    if (!this.config.clientId || !this.config.clientSecret || !endpoints.tokenUrl) {
      return false;
    }
    if (this.grantTypesSupported && this.grantTypesSupported.length > 0) {
      const supportsInteractive = this.grantTypesSupported.includes('authorization_code')
        || this.grantTypesSupported.includes('urn:ietf:params:oauth:grant-type:device_code');
      if (this.grantTypesSupported.includes('client_credentials') && !supportsInteractive) {
        return true;
      }
    }
    return !endpoints.authorizationUrl && !endpoints.deviceAuthorizationUrl;
  }

  /**
   * 通过 client_credentials 模式向 Token 端点请求访问令牌
   * Request access token using OAuth client_credentials grant
   */
  private async requestClientCredentialsToken(tokenUrl: string): Promise<string> {
    const clientId = this.config.clientId!;
    const clientSecret = this.config.clientSecret!;
    const body = new URLSearchParams({
      grant_type: 'client_credentials'
    });

    const scope = this.determineScope();
    if (scope) {
      body.set('scope', scope);
    }
    if (this.discoveredResource) {
      body.set('resource', this.discoveredResource);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    };
    this.applyClientAuth(headers, body, clientId, clientSecret);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new McpAuthRequiredError(`[McpOAuth] Client credentials request failed (${res.status}): ${errorText.slice(0, 300)}`);
    }

    const rawText = await res.text();
    const token = this.parseOAuthTokenPayload(rawText);
    await this.tokenStore.saveToken(this.serverId, token);
    return token.accessToken;
  }

  /**
   * 使用授权码换取 Token
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string, state?: string): Promise<void> {
    const pending = await this.tokenStore.loadPendingAuth(this.serverId);
    if (!pending || (state && pending.state !== state)) {
      throw new Error(`[McpOAuth] Invalid state parameter or expired auth session.`);
    }

    const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;
    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      await this.tokenStore.clearPendingAuth(this.serverId);
      throw new Error(`[McpOAuth] OAuth authentication session expired. Please initiate authorization again.`);
    }

    if (!this.config.clientId && !this.config.clientSecret && !this.registeredClientSecret) {
      const cachedClient = await this.tokenStore.loadClientInfo(this.serverId);
      if (cachedClient?.clientSecret) {
        this.registeredClientSecret = cachedClient.clientSecret;
      }
    }

    if (this.getClientSecret() && !this.tokenEndpointAuthMethodsSupported) {
      await this.resolveEndpoints().catch(() => { });
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier
    });

    const resource = pending.resource || this.discoveredResource;
    if (resource) {
      body.set('resource', resource);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    };
    this.applyClientAuth(headers, body, pending.clientId, this.getClientSecret());

    const res = await fetch(pending.tokenUrl, {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      const errorText = await res.text();
      if (this.isInvalidClientError(res.status, errorText)) {
        await this.clearInvalidDynamicClient();
      }
      throw new Error(`[McpOAuth] Token exchange failed: ${errorText.slice(0, 300)}`);
    }

    const rawText = await res.text();
    const token = this.parseOAuthTokenPayload(rawText);

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
    if (token && (!token.expiresAt || token.expiresAt - Date.now() > 60000)) {
      return token.accessToken;
    }

    if (token?.refreshToken) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshToken(token.refreshToken).finally(() => {
          this.refreshPromise = undefined;
        });
      }
      return await this.refreshPromise;
    }

    if (this.config.clientId && this.config.clientSecret) {
      const endpoints = await this.resolveEndpoints().catch(() => ({} as {
        authorizationUrl?: string;
        tokenUrl?: string;
        deviceAuthorizationUrl?: string;
      }));
      if (this.isClientCredentialsMode(endpoints)) {
        if (!this.refreshPromise) {
          this.refreshPromise = this.requestClientCredentialsToken(endpoints.tokenUrl!).finally(() => {
            this.refreshPromise = undefined;
          });
        }
        return await this.refreshPromise;
      }
    }

    if (!token) {
      throw new McpAuthRequiredError(`No access token found for server '${this.serverId}'`);
    }
    throw new McpAuthRequiredError(`Access token expired and no refresh token for server '${this.serverId}'`);
  }

  /**
   * 强制刷新 Access Token
   * Force refresh access token using stored refresh token
   */
  async forceRefreshToken(): Promise<boolean> {
    if (this.refreshPromise) {
      try {
        await this.refreshPromise;
        return true;
      } catch {
        return false;
      }
    }

    const token = await this.tokenStore.loadToken(this.serverId);
    if (token?.refreshToken) {
      try {
        this.refreshPromise = this.refreshToken(token.refreshToken).finally(() => {
          this.refreshPromise = undefined;
        });
        await this.refreshPromise;
        return true;
      } catch {
        return false;
      }
    }

    if (this.config.clientId && this.config.clientSecret) {
      const endpoints = await this.resolveEndpoints().catch(() => ({} as {
        authorizationUrl?: string;
        tokenUrl?: string;
        deviceAuthorizationUrl?: string;
      }));
      if (this.isClientCredentialsMode(endpoints)) {
        try {
          this.refreshPromise = this.requestClientCredentialsToken(endpoints.tokenUrl!).finally(() => {
            this.refreshPromise = undefined;
          });
          await this.refreshPromise;
          return true;
        } catch {
          return false;
        }
      }
    }

    return false;
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

    const clientId = await this.ensureClientId();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    if (this.discoveredResource) {
      body.set('resource', this.discoveredResource);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    };
    this.applyClientAuth(headers, body, clientId, this.getClientSecret());

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      if (this.isInvalidClientError(res.status, errorText)) {
        await this.clearInvalidDynamicClient();
      }
      this.context?.logger.warn(`[McpOAuth] Refresh token failed for server '${this.serverId}'. User re-auth required.`);
      throw new McpAuthRequiredError(`Failed to refresh token for server '${this.serverId}'`);
    }

    const rawText = await res.text();
    const newToken = this.parseOAuthTokenPayload(rawText, refreshToken);

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
    if (this.config.clientId) {
      return this.config.clientSecret;
    }
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
          redirect_uris: [fallbackRedirect],
          grant_types: [
            'authorization_code',
            'refresh_token',
            'urn:ietf:params:oauth:grant-type:device_code'
          ],
          response_types: ['code']
        };
        if (!this.tokenEndpointAuthMethodsSupported || this.tokenEndpointAuthMethodsSupported.includes('none')) {
          payload.token_endpoint_auth_method = 'none';
        }

        const res = await fetch(this.registrationEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          throw new Error(`[McpOAuth] Dynamic client registration rejected (${res.status}): ${errorText.slice(0, 300)}`);
        }

        const data: any = await res.json();
        if (data.client_id) {
          const resolvedId = String(data.client_id);
          this.registeredClientId = resolvedId;
          this.registeredClientSecret = data.client_secret ? String(data.client_secret) : undefined;
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

    throw new Error(
      this.i18n.t(
        'mcp.error.missingClientId',
        `[McpOAuth] No clientId configured for server "${this.serverId}", and the authorization server does not support RFC 7591 Dynamic Client Registration. Please provide "clientId" in your MCP server configuration.`,
        { serverId: this.serverId }
      )
    );
  }

  /**
   * 启动设备码流程并在后台自动轮询换票
   * Start RFC 8628 device flow and start background token polling
   */
  async startDeviceAuth(onSuccess?: (serverId: string) => Promise<void>): Promise<McpDeviceAuthInfo> {
    this.lastDeviceAuthError = undefined;
    const endpoints = await this.resolveEndpoints();
    const deviceUrl = endpoints.deviceAuthorizationUrl;
    const tokenUrl = endpoints.tokenUrl || this.config.tokenUrl;

    if (!deviceUrl || !tokenUrl) {
      throw new Error(
        this.i18n.t(
          'mcp.error.deviceFlowNotSupported',
          `[McpOAuth] Server '${this.serverId}' does not support device flow (missing deviceUrl or tokenUrl).`,
          { serverId: this.serverId }
        )
      );
    }

    let clientId = await this.ensureClientId();
    const requestDeviceCode = async (resolvedClientId: string): Promise<Response> => {
      const body = new URLSearchParams();
      const scope = this.determineScope();
      if (scope) {
        body.set('scope', scope);
      }
      if (this.discoveredResource) {
        body.set('resource', this.discoveredResource);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      };
      this.applyClientAuth(headers, body, resolvedClientId, this.getClientSecret());

      return await fetch(deviceUrl, {
        method: 'POST',
        headers,
        body
      });
    };

    let res = await requestDeviceCode(clientId);
    if (!res.ok) {
      const errorText = await res.text();
      if (this.isInvalidClientError(res.status, errorText) && await this.clearInvalidDynamicClient()) {
        clientId = await this.ensureClientId();
        res = await requestDeviceCode(clientId);
        if (!res.ok) {
          const retryErrorText = await res.text();
          throw new Error(`[McpOAuth] Device authorization request failed: ${retryErrorText.slice(0, 300)}`);
        }
      } else {
        throw new Error(`[McpOAuth] Device authorization request failed: ${errorText.slice(0, 300)}`);
      }
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
        device_code: deviceCode
      });
      if (this.discoveredResource) {
        body.set('resource', this.discoveredResource);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      };
      this.applyClientAuth(headers, body, clientId, this.getClientSecret());

      try {
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers,
          body,
          signal
        });

        if (res.ok) {
          const rawText = await res.text();
          const token = this.parseOAuthTokenPayload(rawText);

          await this.tokenStore.saveToken(this.serverId, token);
          this.context?.logger.info(`[McpOAuth] Device authorization succeeded for server '${this.serverId}'.`);

          if (onSuccess) {
            await onSuccess(this.serverId);
          }
          return;
        }

        const errorText = await res.text().catch(() => '');
        if (this.isInvalidClientError(res.status, errorText)) {
          await this.clearInvalidDynamicClient();
          this.lastDeviceAuthError = 'Dynamic client registration expired';
          this.context?.logger.warn(`[McpOAuth] Device polling stopped due to invalid client for '${this.serverId}'.`);
          return;
        }

        let data: any = {};
        try {
          data = JSON.parse(errorText);
        } catch { }
        const errType = data.error;

        if (errType === 'authorization_pending') {
          continue;
        } else if (errType === 'slow_down') {
          currentInterval += 5;
          continue;
        } else if (errType === 'expired_token' || errType === 'access_denied') {
          this.lastDeviceAuthError = errType === 'access_denied' ? 'Authorization was denied by user' : 'Device code expired';
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
