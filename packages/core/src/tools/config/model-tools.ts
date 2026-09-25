import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ListModelsTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_model',
      // 查询所有模型列表
      description: 'Query all models configured across providers, returning model ID, name, provider, pricing, context window, and capabilities.',
      parameters: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            // 目标提供商 ID
            description: 'Optional: Filter models under specified provider only'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const providerId = args.providerId ? String(args.providerId).trim() : undefined;
      const models = await this.configService.listModels(providerId);
      if (models.length === 0) {
        // 未配置任何模型提示
        return '⚠️ No models configured currently.';
      }

      const lines: string[] = [];
      for (const m of models) {
        const caps = Array.isArray(m.capabilities) ? m.capabilities.join(', ') : 'Unknown';
        lines.push(
          `[${m.providerId}] ${m.id} (${m.name})\n` +
          `   Input Price: ${m.inputPrice ?? 0} (1M) | Output Price: ${m.outputPrice ?? 0} (1M) | Cached Input: ${m.cachedInputPrice ?? 0} (1M)\n` +
          `   Context Window: ${m.contextWindow ?? m.contextTokens ?? 'Not set'} | Max Output: ${m.maxTokens ?? 'Not set'} | Capabilities: ${caps}`
        );
      }

      // 模型列表出参
      return `Total ${lines.length} models found:\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      // 查询模型列表失败错误提示
      return `❌ Failed to list models: ${err.message}`;
    }
  }
}

export class AddModelTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'add_model',
      // 新增模型配置
      description: 'Add a new model configuration under a specified provider. Provider ID, model ID, and name are required; pricing and capabilities are optional.',
      parameters: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            // 目标提供商 ID
            description: 'Target provider ID'
          },
          id: {
            type: 'string',
            // 模型唯一标识
            description: 'Unique model identifier (e.g. "deepseek-chat")'
          },
          name: {
            type: 'string',
            // 模型显示名称
            description: 'Display name of the model (e.g. "DeepSeek Chat")'
          },
          inputPrice: {
            type: 'number',
            // 输入价格
            description: 'Input price (/ 1M Tokens, optional)'
          },
          outputPrice: {
            type: 'number',
            // 输出价格
            description: 'Output price (/ 1M Tokens, optional)'
          },
          cachedInputPrice: {
            type: 'number',
            // 缓存输入价格
            description: 'Cached input price (/ 1M Tokens, optional)'
          },
          contextWindow: {
            type: 'number',
            // 模型原生上下文物理窗口 Token 数
            description: 'Native physical context window limit in tokens (model hard limit, default 128000, optional)'
          },
          contextTokens: {
            type: 'number',
            // 智能体控制的上下文 Token 上限
            description: 'Agent-controlled context token threshold (triggers compaction when exceeded, default 128000, optional)'
          },
          maxTokens: {
            type: 'number',
            // 智能体控制的单次回复最大输出 Token 数
            description: 'Agent-controlled maximum tokens per response turn (default 4096, optional)'
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            // 模型能力集
            description: 'Model capabilities (e.g. ["text", "image"], optional, default ["text"])'
          }
        },
        required: ['providerId', 'id', 'name']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.addModel(
        String(args.providerId || '').trim(),
        {
          id: String(args.id || '').trim(),
          name: String(args.name || '').trim(),
          inputPrice: args.inputPrice,
          outputPrice: args.outputPrice,
          cachedInputPrice: args.cachedInputPrice,
          contextWindow: args.contextWindow,
          contextTokens: args.contextTokens,
          maxTokens: args.maxTokens,
          capabilities: args.capabilities
        }
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      // 新增模型失败错误提示
      return `❌ Failed to add model: ${err.message}`;
    }
  }
}

export class EditModelTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'edit_model',
      // 修改模型配置
      description: 'Modify properties of an existing model under a specified provider (name, pricing, context window, output limit, capabilities).',
      parameters: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            // 目标提供商 ID
            description: 'Target provider ID'
          },
          modelId: {
            type: 'string',
            // 目标模型 ID
            description: 'Target model ID'
          },
          name: {
            type: 'string',
            // 新的显示名称
            description: 'New display name (optional)'
          },
          inputPrice: {
            type: 'number',
            // 新的输入价格
            description: 'New input price (optional)'
          },
          outputPrice: {
            type: 'number',
            // 新的输出价格
            description: 'New output price (optional)'
          },
          cachedInputPrice: {
            type: 'number',
            // 新的缓存输入价格
            description: 'New cached input price (optional)'
          },
          contextWindow: {
            type: 'number',
            // 模型原生上下文物理窗口 Token 数
            description: 'Native physical context window limit in tokens (optional)'
          },
          contextTokens: {
            type: 'number',
            // 智能体控制的上下文 Token 上限
            description: 'Agent-controlled context token threshold (optional)'
          },
          maxTokens: {
            type: 'number',
            // 智能体控制的单次输出最大 Token 数
            description: 'Agent-controlled maximum tokens per response turn (optional)'
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            // 新的能力集
            description: 'New model capabilities (optional)'
          }
        },
        required: ['providerId', 'modelId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const updates: Record<string, any> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.inputPrice !== undefined) updates.inputPrice = args.inputPrice;
      if (args.outputPrice !== undefined) updates.outputPrice = args.outputPrice;
      if (args.cachedInputPrice !== undefined) updates.cachedInputPrice = args.cachedInputPrice;
      if (args.contextWindow !== undefined) updates.contextWindow = args.contextWindow;
      if (args.contextTokens !== undefined) updates.contextTokens = args.contextTokens;
      if (args.maxTokens !== undefined) updates.maxTokens = args.maxTokens;
      if (args.capabilities !== undefined) updates.capabilities = args.capabilities;

      const result = await this.configService.editModel(
        String(args.providerId || '').trim(),
        String(args.modelId || '').trim(),
        updates
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      // 修改模型失败错误提示
      return `❌ Failed to edit model: ${err.message}`;
    }
  }
}

export class RemoveModelTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'remove_model',
      // 删除模型配置
      description: 'Delete a model configuration from a specified provider.',
      parameters: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            // 目标提供商 ID
            description: 'Target provider ID'
          },
          modelId: {
            type: 'string',
            // 要删除的模型 ID
            description: 'Model ID to remove'
          }
        },
        required: ['providerId', 'modelId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.removeModel(
        String(args.providerId || '').trim(),
        String(args.modelId || '').trim()
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      // 删除模型失败错误提示
      return `❌ Failed to remove model: ${err.message}`;
    }
  }
}
