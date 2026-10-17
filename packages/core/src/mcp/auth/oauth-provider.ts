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

  constructor(
    private readonly serverId: string,
    private readonly config: McpAuthOAuth,
    private readonly tokenStore: TokenStore,
    private readonly context?: FreyaContext
  ) {}

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
    const authUrl = this.config.authorizationUrl;
    const tokenUrl = this.config.tokenUrl;
    const clientId = this.config.clientId || 'freya-client';

    if (!authUrl || !tokenUrl) {
      throw new Error(`[McpOAuth] Server '${this.serverId}' is missing authorizationUrl or tokenUrl.`);
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

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
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
   * 刷新 Token
   * Refresh access token using refresh token
   */
  private async refreshToken(refreshToken: string): Promise<string> {
    const tokenUrl = this.config.tokenUrl;
    if (!tokenUrl) {
      throw new McpAuthRequiredError(`Missing tokenUrl for refresh on server '${this.serverId}'`);
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId || 'freya-client'
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
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

  /**
   * 探测并解析 RFC 8628 设备授权端点
   * Resolve or discover RFC 8628 device authorization endpoint
   */
  async resolveDeviceAuthUrl(): Promise<string | undefined> {
    if (this.config.deviceAuthorizationUrl) {
      return this.config.deviceAuthorizationUrl;
    }

    const baseCandidate = this.config.authorizationUrl || this.config.tokenUrl;
    if (!baseCandidate) {
      return undefined;
    }

    try {
      const parsed = new URL(baseCandidate);
      const metadataUrls = [
        `${parsed.origin}/.well-known/oauth-authorization-server`,
        `${parsed.origin}/.well-known/openid-configuration`
      ];

      for (const metaUrl of metadataUrls) {
        try {
          const res = await fetch(metaUrl, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const data: any = await res.json();
            if (data.device_authorization_endpoint) {
              return data.device_authorization_endpoint;
            }
          }
        } catch {}
      }
    } catch {}

    return undefined;
  }

  /**
   * 启动设备码流程并在后台自动轮询换票
   * Start RFC 8628 device flow and start background token polling
   */
  async startDeviceAuth(onSuccess?: (serverId: string) => Promise<void>): Promise<McpDeviceAuthInfo> {
    const deviceUrl = await this.resolveDeviceAuthUrl();
    const tokenUrl = this.config.tokenUrl;

    if (!deviceUrl || !tokenUrl) {
      throw new Error(`[McpOAuth] Server '${this.serverId}' does not support device flow (missing deviceUrl or tokenUrl).`);
    }

    const clientId = this.config.clientId || 'freya-client';
    const body = new URLSearchParams({
      client_id: clientId
    });

    if (this.config.scopes && this.config.scopes.length > 0) {
      body.set('scope', this.config.scopes.join(' '));
    }

    const res = await fetch(deviceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.config.clientId || 'freya-client'
      });

      if (this.config.clientSecret) {
        body.set('client_secret', this.config.clientSecret);
      }

      try {
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
