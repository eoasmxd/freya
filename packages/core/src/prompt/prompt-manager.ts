import type { FreyaContext } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREYA_APP, FREYA_HOME } from '../utils/paths.js';
import { FreyaPromptRegistry } from './prompt-registry.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 提示词物理文件管理器，负责加载、缺失拷贝与持久化覆写
 * Physical prompt file manager responsible for loading, fallback copying, and persistent overwriting
 */
export class FreyaPromptManager {
  private defaultDirPath = path.join(FREYA_APP, 'config', 'prompts');
  private i18n: I18n;

  constructor(
    private promptRegistry: FreyaPromptRegistry,
    private ctx: FreyaContext
  ) {
    this.i18n = new I18n({ zh, en }, this.ctx);
  }

  async readPrompt(name: string, lang?: string): Promise<string> {
    const isCorePrompt = ['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY'].includes(name.toUpperCase());
    if (!isCorePrompt) {
      // 仅允许管理核心提示词
      // Only core prompts are allowed to be managed
      throw new Error(this.i18n.t(
        'prompt.error.onlyCore',
        'Execution rejected: Configuration management tools only allow managing core prompts'
      ));
    }
    const registryKey = `core.prompt.${name.toLowerCase()}`;
    return this.promptRegistry.get(registryKey, lang);
  }

  async writePrompt(name: string, content: string): Promise<string> {
    const isCorePrompt = ['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY'].includes(name.toUpperCase());
    if (!isCorePrompt) {
      // 仅允许管理核心提示词
      // Only core prompts are allowed to be managed
      throw new Error(this.i18n.t(
        'prompt.error.onlyCore',
        'Execution rejected: Configuration management tools only allow managing core prompts'
      ));
    }

    const runFilePath = path.join(FREYA_HOME, 'config', `${name.toUpperCase()}.md`);
    await fs.mkdir(path.dirname(runFilePath), { recursive: true });
    await fs.writeFile(runFilePath, content, 'utf-8');

    const registryKey = `core.prompt.${name.toLowerCase()}`;
    this.promptRegistry.updateContent(registryKey, content);

    // 提示物理覆写完成
    // Prompt document physically overwritten
    return this.i18n.t(
      'prompt.success.overwritten',
      'Prompt document "{name}" overwritten physically, in-memory hot reload ready.',
      { name }
    );
  }

  async editPrompt(name: string, targetContent: string, replacementContent: string): Promise<string> {
    const isCorePrompt = ['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY'].includes(name.toUpperCase());
    if (!isCorePrompt) {
      // 仅允许管理核心提示词
      // Only core prompts are allowed to be managed
      throw new Error(this.i18n.t(
        'prompt.error.onlyCore',
        'Execution rejected: Configuration management tools only allow managing core prompts'
      ));
    }

    const runFilePath = path.join(FREYA_HOME, 'config', `${name.toUpperCase()}.md`);
    const registryKey = `core.prompt.${name.toLowerCase()}`;
    const currentText = this.promptRegistry.get(registryKey);

    if (!currentText.includes(targetContent)) {
      // 目标替换片段未匹配
      // Target replacement fragment not found
      throw new Error(this.i18n.t(
        'prompt.error.targetNotFound',
        'Failed to match the specified target replacement fragment in document "{name}", edit cancelled.',
        { name }
      ));
    }

    const newText = currentText.replace(targetContent, replacementContent);
    await fs.mkdir(path.dirname(runFilePath), { recursive: true });
    await fs.writeFile(runFilePath, newText, 'utf-8');

    this.promptRegistry.updateContent(registryKey, newText);

    // 提示局部替换完成
    // Prompt document locally replaced
    return this.i18n.t(
      'prompt.success.edited',
      'Prompt document "{name}" locally replaced, in-memory hot reload ready.',
      { name }
    );
  }
}

