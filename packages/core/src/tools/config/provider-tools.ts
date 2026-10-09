import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ListProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_list_provider',
      description: 'Query all configured model providers, returning provider ID, name, protocol type, baseURL, and bound model counts. apiKey is automatically masked.',
      parameters: { type: 'object', properties: {} }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const providers = await this.configService.listProviders();
      if (providers.length === 0) {
        return '⚠️ No model providers configured currently.';
      }
      const lines = providers.map((p, i) => {
        const modelCount = Array.isArray(p.models) ? p.models.length : 0;
        return `${i + 1}. [${p.id}] ${p.name}\n   Protocol: ${p.type} | baseURL: ${p.baseURL || 'Not set'} | Models: ${modelCount} | apiKey: ******`;
      });
      return `Total ${providers.length} model providers configured:\n\n${lines.join('\n\n')}`;
    } catch (err: any) {
      return `❌ Failed to list model providers: ${err.message}`;
    }
  }
}

export class CreateProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_create_provider',
      description: 'Add a new model provider. Requires unique ID, name, protocol type, and baseURL. apiKey is optional.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            // 提供商唯一标识
            description: 'Unique provider identifier (e.g. "deepseek-provider")'
          },
          name: {
            type: 'string',
            // 提供商显示名称
            description: 'Display name of provider (e.g. "DeepSeek API")'
          },
          type: {
            type: 'string',
            // 协议类型
            description: 'Protocol type (e.g. "openai")'
          },
          baseURL: {
            type: 'string',
            // API 地址
            description: 'API base URL'
          },
          apiKey: {
            type: 'string',
            // API 密钥
            description: 'API key secret (optional)'
          }
        },
        required: ['id', 'name', 'type', 'baseURL']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
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
      // 新增模型提供商失败错误提示
      return `❌ Failed to add model provider: ${err.message}`;
    }
  }
}

export class UpdateProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_update_provider',
      description: 'Modify properties of an existing model provider (name, type, baseURL, apiKey).',
      parameters: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            description: 'Target provider ID'
          },
          name: {
            type: 'string',
            description: 'New display name (optional)'
          },
          type: {
            type: 'string',
            description: 'New protocol type (optional)'
          },
          baseURL: {
            type: 'string',
            description: 'New API base URL (optional)'
          },
          apiKey: {
            type: 'string',
            description: 'New API key secret (optional)'
          }
        },
        required: ['providerId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const updates: Record<string, any> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.type !== undefined) updates.type = args.type;
      if (args.baseURL !== undefined) updates.baseURL = args.baseURL;
      if (args.apiKey !== undefined) updates.apiKey = args.apiKey;

      const result = await this.configService.editProvider(String(args.providerId || '').trim(), updates);
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ Failed to edit model provider: ${err.message}`;
    }
  }
}

export class DeleteProviderTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_delete_provider',
      description: 'Delete a specified model provider and all associated model configurations.',
      parameters: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            description: 'Provider ID to delete'
          }
        },
        required: ['providerId']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const result = await this.configService.removeProvider(String(args.providerId || '').trim());
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ Failed to remove model provider: ${err.message}`;
    }
  }
}
