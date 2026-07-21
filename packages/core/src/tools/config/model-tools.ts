import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ListModelsTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_model',
      description: '查询所有模型提供商下挂载的模型列表，返回每个模型的 ID、名称、所属提供商、价格、上下文窗口及能力集。',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: '可选：仅查询指定提供商下的模型' }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const providerId = args.providerId ? String(args.providerId).trim() : undefined;
      const models = await this.configService.listModels(providerId);
      if (models.length === 0) return '⚠️ 当前未配置任何模型。';

      const lines: string[] = [];
      for (const m of models) {
        const caps = Array.isArray(m.capabilities) ? m.capabilities.join(', ') : '未知';
        lines.push(
          `[${m.providerId}] ${m.id} (${m.name})\n` +
          `   输入价格: ${m.inputPrice ?? 0} (1M) | 输出价格: ${m.outputPrice ?? 0} (1M) | 缓存输入: ${m.cachedInputPrice ?? 0} (1M)\n` +
          `   上下文窗口: ${m.contextWindow ?? m.contextTokens ?? '未设置'} | 最大输出: ${m.maxTokens ?? '未设置'} | 能力: ${caps}`
        );
      }

      return `当前共 ${lines.length} 个模型：\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `❌ 查询模型列表失败: ${err.message}`;
    }
  }
}

export class AddModelTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'add_model',
      description: '在指定提供商下新增一个模型配置。需要指定提供商 ID、模型 ID 和名称，其余价格与能力字段可选。',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: '目标提供商 ID' },
          id: { type: 'string', description: '模型唯一标识（如 "deepseek-chat"）' },
          name: { type: 'string', description: '模型显示名称（如 "DeepSeek Chat"）' },
          inputPrice: { type: 'number', description: '输入价格（/ 1M Tokens，可选）' },
          outputPrice: { type: 'number', description: '输出价格（/ 1M Tokens，可选）' },
          cachedInputPrice: { type: 'number', description: '缓存输入价格（/ 1M Tokens，可选）' },

          contextWindow: { type: 'number', description: '上下文最大窗口 Token 数（可选）' },
          maxTokens: { type: 'number', description: '单次输出最大 Token 数（可选）' },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            description: '模型能力集（如 ["text", "image"]，可选，默认 ["text"]）'
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
          maxTokens: args.maxTokens,
          capabilities: args.capabilities
        }
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 新增模型失败: ${err.message}`;
    }
  }
}

export class EditModelTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'edit_model',
      description: '修改指定提供商下某个模型的属性（name、价格、上下文窗口、能力集等）。',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: '目标提供商 ID' },
          modelId: { type: 'string', description: '目标模型 ID' },
          name: { type: 'string', description: '新的显示名称（可选）' },
          inputPrice: { type: 'number', description: '新的输入价格（可选）' },
          outputPrice: { type: 'number', description: '新的输出价格（可选）' },
          cachedInputPrice: { type: 'number', description: '新的缓存输入价格（可选）' },
          contextWindow: { type: 'number', description: '新的上下文窗口 Token 数（可选）' },
          maxTokens: { type: 'number', description: '新的单次输出最大 Token 数（可选）' },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            description: '新的能力集（可选）'
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
      if (args.maxTokens !== undefined) updates.maxTokens = args.maxTokens;
      if (args.capabilities !== undefined) updates.capabilities = args.capabilities;

      const result = await this.configService.editModel(
        String(args.providerId || '').trim(),
        String(args.modelId || '').trim(),
        updates
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 修改模型失败: ${err.message}`;
    }
  }
}

export class RemoveModelTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'remove_model',
      description: '从指定提供商下删除一个模型配置。',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: '目标提供商 ID' },
          modelId: { type: 'string', description: '要删除的模型 ID' }
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
      return `❌ 删除模型失败: ${err.message}`;
    }
  }
}
