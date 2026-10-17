import type { FreyaTool, FreyaToolResult, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { McpToolSchema } from './types.js';
import { mapMcpResult } from './mcp-result-mapper.js';

export interface McpToolExecutor {
  callTool(originalName: string, args: Record<string, any>): Promise<any>;
  handleExecutionError?(error: Error): void;
  handleExecutionSuccess?(): void;
}

/**
 * MCP 桥接原子工具实现，负责参数清理、代理执行与结果转换
 * MCP bridged atomic tool implementation wrapping remote schema and execution
 */
export class McpBridgedTool implements FreyaTool {
  constructor(
    private readonly serverId: string,
    private readonly exposedName: string,
    private readonly originalName: string,
    private readonly schema: McpToolSchema,
    private readonly executor: McpToolExecutor
  ) {}

  getOriginalName(): string {
    return this.originalName;
  }

  getDefinition(): ToolDefinition {
    const rawSchema = (this.schema.inputSchema && typeof this.schema.inputSchema === 'object')
      ? this.schema.inputSchema
      : { type: 'object', properties: {} };

    const { $schema, $id, $defs, definitions, ...cleanSchema } = rawSchema;

    return {
      name: this.exposedName,
      description: this.schema.description || `MCP Tool [${this.originalName}] from service ${this.serverId}`,
      parameters: {
        type: 'object',
        properties: cleanSchema.properties || {},
        ...cleanSchema
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string | FreyaToolResult> {
    const { __sessionId, ...cleanArgs } = args || {};
    try {
      const rawResult = await this.executor.callTool(this.originalName, cleanArgs);
      this.executor.handleExecutionSuccess?.();
      return await mapMcpResult(this.serverId, this.originalName, rawResult);
    } catch (err: any) {
      this.executor.handleExecutionError?.(err);
      throw err;
    }
  }
}
