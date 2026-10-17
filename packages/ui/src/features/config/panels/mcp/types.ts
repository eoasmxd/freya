/**
 * MCP 前端数据结构与状态类型定义
 * Type definitions for MCP remote services in UI
 */

export interface McpToolItem {
  name: string;
  originalName: string;
  description: string;
  parameters: any;
}

export interface McpServerConfig {
  url: string;
  description?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  auth?: {
    type: 'headers' | 'oauth' | 'none';
    headers?: Record<string, string>;
    clientId?: string;
    clientSecret?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    deviceAuthorizationUrl?: string;
    scopes?: string[];
  };
  toolFilter?: {
    include?: string[];
    exclude?: string[];
  };
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

export type McpServerState = 'ready' | 'connecting' | 'auth_required' | 'error' | 'disabled';

export interface McpServerInfo {
  name?: string;
  version?: string;
  title?: string;
  icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
}

export interface McpServerStatusItem {
  id: string;
  url?: string;
  description?: string;
  instructions?: string;
  serverInfo?: McpServerInfo;
  headers?: Record<string, string>;
  auth?: any;
  config?: McpServerConfig;
  enabled: boolean;
  status: McpServerState;
  lastError?: string;
  toolCount: number;
  tools: McpToolItem[];
}
