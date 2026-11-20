import type { FreyaTool, FreyaToolResult, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { McpToolSchema } from './types.js';
import { mapMcpResult } from './mcp-result-mapper.js';

export interface McpToolExecutor {
  callTool(originalName: string, args: Record<string, any>): Promise<any>;
  handleExecutionError?(error: Error): void;
  handleExecutionSuccess?(): void;
}

/**
 * 递归内联展开 JSON Schema 本地的 $defs / definitions 引用并清理不兼容的顶层元字段
 * Recursively inline local JSON Schema $defs / definitions references and strip incompatible top-level meta fields
 */
export function dereferenceJsonSchema(rawSchema: Record<string, any>): Record<string, any> {
  const defs: Record<string, any> = {};
  if (rawSchema.definitions && typeof rawSchema.definitions === 'object') {
    Object.assign(defs, rawSchema.definitions);
  }
  if (rawSchema.$defs && typeof rawSchema.$defs === 'object') {
    Object.assign(defs, rawSchema.$defs);
  }

  const resolveLocalRef = (ref: string): Record<string, any> | undefined => {
    let rawKey: string | undefined;
    let sourceDict: Record<string, any> | undefined;

    if (ref.startsWith('#/$defs/')) {
      rawKey = ref.slice('#/$defs/'.length);
      sourceDict = rawSchema.$defs;
    } else if (ref.startsWith('#/definitions/')) {
      rawKey = ref.slice('#/definitions/'.length);
      sourceDict = rawSchema.definitions;
    } else {
      return undefined;
    }

    if (!rawKey) return undefined;
    const segments = rawKey
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~'));
    if (segments.length === 0) return undefined;

    let current: any = sourceDict?.[segments[0]] ?? defs[segments[0]];
    for (let i = 1; i < segments.length; i++) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      current = current[segments[i]];
    }
    return current && typeof current === 'object' ? current : undefined;
  };

  const resolveNode = (node: any, visitedRefs: Set<string>): any => {
    if (Array.isArray(node)) {
      return node.map((item) => resolveNode(item, visitedRefs));
    }
    if (!node || typeof node !== 'object') {
      return node;
    }

    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (ref.startsWith('#/$defs/') || ref.startsWith('#/definitions/')) {
        const { $ref: _ignoredRef, ...siblingProps } = node;
        const resolvedSiblings = resolveObjectProps(siblingProps, visitedRefs);

        if (visitedRefs.has(ref)) {
          return {
            type: 'object',
            ...resolvedSiblings
          };
        }

        const targetDef = resolveLocalRef(ref);
        if (!targetDef) {
          return {
            type: 'object',
            ...resolvedSiblings
          };
        }

        const nextVisited = new Set(visitedRefs);
        nextVisited.add(ref);
        const resolvedTarget = resolveNode(targetDef, nextVisited);
        if (resolvedTarget && typeof resolvedTarget === 'object' && !Array.isArray(resolvedTarget)) {
          return {
            ...resolvedTarget,
            ...resolvedSiblings
          };
        }
        return resolvedTarget;
      }
    }

    return resolveObjectProps(node, visitedRefs);
  };

  const resolveObjectProps = (obj: Record<string, any>, visitedRefs: Set<string>): Record<string, any> => {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveNode(value, visitedRefs);
    }
    return result;
  };

  const { $schema, id, $id, $defs, definitions, ...stripped } = rawSchema;
  return resolveNode(stripped, new Set<string>());
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

    const cleanSchema = dereferenceJsonSchema(rawSchema);

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
