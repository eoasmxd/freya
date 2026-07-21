import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ListProvidersTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'list_provider',
      description: '查询当前已配置的所有模型提供商列表，返回每个提供商的 ID、名称、协议类型、baseURL 及挂载的模型数量。apiKey 自动脱敏。',
      parameters: { type: 'object', properties: {} }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const providers = await this.configService.listProviders();
      if (providers.length === 0) return '⚠️ 当前未配置任何模型提供商。';
      const lines = providers.map((p, i) => {
        const modelCount = Array.isArray(p.models) ? p.models.length : 0;
        return `${i + 1}. [${p.id}] ${p.name}\n   协议: ${p.type} | baseURL: ${p.baseURL || '未设置'} | 模型数: ${modelCount} | apiKey: ******`;
      });
      return `当前共 ${providers.length} 个模型提供商：\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `❌ 查询模型提供商列表失败: ${err.message}`;
    }
  }
}

export class AddProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'add_provider',
      description: '新增一个模型提供商。需要指定唯一 ID、名称、协议类型和 baseURL。apiKey 可选，留空则视为未配置。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '提供商唯一标识（如 "deepseek-provider"）' },
          name: { type: 'string', description: '提供商显示名称（如 "DeepSeek API"）' },
          type: { type: 'string', description: '协议类型（如 "openai"）' },
          baseURL: { type: 'string', description: 'API 地址' },
          apiKey: { type: 'string', description: 'API 密钥（可选）' }
        },
        required: ['id', 'name', 'type', 'baseURL']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.addProvider({
        id: String(args.id || '').trim(),
        name: String(args.name || '').trim(),
        type: String(args.type || '').trim(),
        baseURL: String(args.baseURL || '').trim(),
        apiKey: String(args.apiKey || '')
      });
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 新增模型提供商失败: ${err.message}`;
    }
  }
}

export class EditProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'edit_provider',
      description: '修改指定模型提供商的属性（name、type、baseURL、apiKey）。',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: '目标提供商 ID' },
          name: { type: 'string', description: '新的显示名称（可选）' },
          type: { type: 'string', description: '新的协议类型（可选）' },
          baseURL: { type: 'string', description: '新的 API 地址（可选）' },
          apiKey: { type: 'string', description: '新的 API 密钥（可选）' }
        },
        required: ['providerId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const updates: Record<string, any> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.type !== undefined) updates.type = args.type;
      if (args.baseURL !== undefined) updates.baseURL = args.baseURL;
      if (args.apiKey !== undefined) updates.apiKey = args.apiKey;

      const result = await this.configService.editProvider(String(args.providerId || '').trim(), updates);
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 修改模型提供商失败: ${err.message}`;
    }
  }
}

export class RemoveProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'remove_provider',
      description: '删除指定的模型提供商及其下所有模型配置。',
      parameters: {
        type: 'object',
        properties: { providerId: { type: 'string', description: '要删除的提供商 ID' } },
        required: ['providerId']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.removeProvider(String(args.providerId || '').trim());
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 删除模型提供商失败: ${err.message}`;
    }
  }
}
