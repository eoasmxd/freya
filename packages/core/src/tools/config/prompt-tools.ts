import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

export class ReadPromptTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_read_prompt',
      // 读取核心主提示词内容
      description: 'Read content of one of the 6 core system prompt templates. Supported names: IDENTITY, SOUL, TOOLS, AGENTS, USER, MEMORY.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            // 主提示词名称
            description: 'Core prompt template name (allowed values: IDENTITY | SOUL | TOOLS | AGENTS | USER | MEMORY)'
          }
        },
        required: ['name']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const result = await this.configService.readPrompt(String(args.name || '').trim());
      return result;
    } catch (err: any) {
      // 读取主提示词失败错误提示
      return `❌ Failed to read core prompt: ${err.message}`;
    }
  }
}

export class WritePromptTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_write_prompt',
      // 全量写入覆写核心主提示词
      description: 'Overwrite one of the core system prompt templates and apply hot-reloading to current runtime memory. Supported names: IDENTITY, SOUL, TOOLS, AGENTS, USER, MEMORY.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            // 主提示词名称
            description: 'Core prompt template name (e.g. SOUL)'
          },
          content: {
            type: 'string',
            // 修改后的完整提示词 Markdown 字符串
            description: 'Updated full prompt markdown text string'
          }
        },
        required: ['name', 'content']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const result = await this.configService.writePrompt(
        String(args.name || '').trim(),
        String(args.content || '')
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      // 写入主提示词失败错误提示
      return `❌ Failed to write core prompt: ${err.message}`;
    }
  }
}

export class EditPromptTool implements FreyaTool {
  constructor(private configService: FreyaConfigManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'config_edit_prompt',
      // 局部精准修改核心主提示词
      description: 'Perform precision targeted string replacement within a core system prompt template (e.g. SOUL) to prevent formatting drift or token waste. Supported values: IDENTITY, SOUL, TOOLS, AGENTS, USER, MEMORY.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            // 主提示词名称
            description: 'Core prompt template name (e.g. SOUL)'
          },
          targetContent: {
            type: 'string',
            // 准备被修改的旧文本片段
            description: 'Exact old text snippet in current prompt file to be replaced (must match precisely)'
          },
          replacementContent: {
            type: 'string',
            // 替换后的新文本内容
            description: 'New replacement text string'
          }
        },
        required: ['name', 'targetContent', 'replacementContent']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const result = await this.configService.editPrompt(
        String(args.name || '').trim(),
        String(args.targetContent || ''),
        String(args.replacementContent || '')
      );
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      // 局部替换失败错误提示
      return `❌ Failed to edit prompt: ${err.message}`;
    }
  }
}
