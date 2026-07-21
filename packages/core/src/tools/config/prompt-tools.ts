import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ReadPromptTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'read_prompt',
      description: '读取系统 6 大核心主提示词中的某一个内容。支持的名称列表: IDENTITY, SOUL, TOOLS, AGENTS, USER, MEMORY。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '主提示词名称（可选值: IDENTITY | SOUL | TOOLS | AGENTS | USER | MEMORY）'
          }
        },
        required: ['name']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.readPrompt(String(args.name || '').trim());
      return result;
    } catch (err: any) {
      return `❌ 读取主提示词失败: ${err.message}`;
    }
  }
}

export class WritePromptTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'write_prompt',
      description: '全量写入并覆盖某一个核心主提示词，同时将其热覆盖生效至当前运行内存中。支持的名称列表: IDENTITY, SOUL, TOOLS, AGENTS, USER, MEMORY。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '主提示词名称（如: SOUL）'
          },
          content: {
            type: 'string',
            description: '修改后的完整提示词 Markdown 字符串'
          }
        },
        required: ['name', 'content']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.writePrompt(
        String(args.name || '').trim(),
        String(args.content || '')
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 写入主提示词失败: ${err.message}`;
    }
  }
}

export class EditPromptTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'edit_prompt',
      description: '对核心主提示词（如 SOUL 等）执行局部精准修改替换。避免全量覆写造成格式混乱或 Token 损耗。支持的值包括: IDENTITY, SOUL, TOOLS, AGENTS, USER, MEMORY。',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '主提示词名称（如: SOUL）'
          },
          targetContent: {
            type: 'string',
            description: '当前提示词文件中准备被修改的旧文本片段（必须精确匹配）'
          },
          replacementContent: {
            type: 'string',
            description: '替换后的新文本内容'
          }
        },
        required: ['name', 'targetContent', 'replacementContent']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const result = await this.configService.editPrompt(
        String(args.name || '').trim(),
        String(args.targetContent || ''),
        String(args.replacementContent || '')
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 局部替换失败: ${err.message}`;
    }
  }
}
