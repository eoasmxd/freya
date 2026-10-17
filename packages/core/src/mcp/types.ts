/**
 * MCP 客户端与服务类型定义
 * MCP client and server type definitions
 */

export type McpAuthType = 'none' | 'headers' | 'oauth';

export interface McpAuthHeaders {
  type: 'headers';
  headers: Record<string, string>;
}

export interface McpAuthOAuth {
  type: 'oauth';
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  deviceAuthorizationUrl?: string;
  scopes?: string[];
}

export interface McpDeviceAuthInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export type McpAuthStartResult =
  | {
    type: 'device';
    serverId: string;
    info: McpDeviceAuthInfo;
  }
  | {
    type: 'code';
    serverId: string;
    authorizationUrl: string;
  };

export type McpAuthConfig = McpAuthHeaders | McpAuthOAuth | { type: 'none' };

export interface McpServerConfig {
  url: string;
  description?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  auth?: McpAuthConfig;
  toolFilter?: {
    include?: string[];
    exclude?: string[];
  };
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface McpOAuthTokenData {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
  scope?: string;
}

export interface McpOAuthPendingAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  createdAt: number;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
}

export interface McpCacheData {
  configHash: string;
  serverInfo?: {
    name: string;
    version?: string;
    title?: string;
  };
  instructions?: string;
  description?: string;
  tools: McpToolSchema[];
  updatedAt: number;
}

export type McpServerStatus = 'disabled' | 'ready' | 'connecting' | 'connected' | 'auth_required' | 'error';

export class McpAuthRequiredError extends Error {
  constructor(
    message = 'AUTH_REQUIRED',
    public readonly authHeader?: string,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'McpAuthRequiredError';
  }
}

export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConnectionError';
  }
}
