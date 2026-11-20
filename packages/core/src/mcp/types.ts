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

export interface McpRegisteredClientInfo {
  clientId: string;
  clientSecret?: string;
  registeredAt: number;
}

export interface McpOAuthPendingAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  resource?: string;
  createdAt: number;
}

/**
 * MCP 传输层抽象契约接口，统一屏蔽底层通信协议差异
 * Abstract transport contract encapsulating underlying MCP communication protocols
 */
export interface McpTransport {
  sendJsonRpc(method: string, params?: any): Promise<any>;
  sendJsonRpcNotification(method: string, params?: any): Promise<void>;
  disconnect(): Promise<void>;
  setProtocolVersion?(version: string): void;
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

/**
 * MCP 连接异常的附加状态描述选项，用于协议降级与会话过期识别
 * Supplementary options on MCP connection errors for transport fallback and session expiration detection
 */
export interface McpConnectionErrorOptions {
  isSessionExpired?: boolean;
  httpStatus?: number;
  isJsonRpcError?: boolean;
}

export class McpConnectionError extends Error {
  constructor(
    message: string,
    public readonly options?: McpConnectionErrorOptions
  ) {
    super(message);
    this.name = 'McpConnectionError';
  }
}
