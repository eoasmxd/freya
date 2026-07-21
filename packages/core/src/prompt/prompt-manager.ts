import type { Logger } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, PROJECT_ROOT } from '../utils/paths.js';
import { FreyaPromptRegistry } from './prompt-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 提示词物理文件管理器，负责加载、缺失拷贝与持久化覆写 */
export class FreyaPromptManager {
  private defaultDirPath = path.join(APP_ROOT, 'config', 'prompts');

  constructor(
    private promptRegistry: FreyaPromptRegistry,
    private logger?: Logger
  ) { }

  async readPrompt(name: string): Promise<string> {
    const isCorePrompt = ['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY'].includes(name.toUpperCase());
    if (!isCorePrompt) {
      throw new Error(`拒绝执行：配置管理工具仅允许管理核心提示词`);
    }
    const registryKey = `core.prompt.${name.toLowerCase()}`;
    return this.promptRegistry.get(registryKey);
  }

  async writePrompt(name: string, content: string): Promise<string> {
    const isCorePrompt = ['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY'].includes(name.toUpperCase());
    if (!isCorePrompt) {
      throw new Error(`拒绝执行：配置管理工具仅允许管理核心提示词`);
    }

    const runFilePath = path.join(PROJECT_ROOT, 'config', `${name.toUpperCase()}.md`);
    await fs.mkdir(path.dirname(runFilePath), { recursive: true });
    await fs.writeFile(runFilePath, content, 'utf-8');

    const registryKey = `core.prompt.${name.toLowerCase()}`;
    this.promptRegistry.updateContent(registryKey, content);
    return `提示词文档 "${name}" 物理覆写完成，内存热更新已就绪。`;
  }

  async editPrompt(name: string, targetContent: string, replacementContent: string): Promise<string> {
    const isCorePrompt = ['IDENTITY', 'SOUL', 'USER', 'TOOLS', 'AGENTS', 'MEMORY'].includes(name.toUpperCase());
    if (!isCorePrompt) {
      throw new Error(`拒绝执行：配置管理工具仅允许管理核心提示词`);
    }

    const runFilePath = path.join(PROJECT_ROOT, 'config', `${name.toUpperCase()}.md`);
    const registryKey = `core.prompt.${name.toLowerCase()}`;
    const currentText = this.promptRegistry.get(registryKey);

    if (!currentText.includes(targetContent)) {
      throw new Error(`未能在文档 "${name}" 中匹配到指定的目标替换片段，修改取消。`);
    }

    const newText = currentText.replace(targetContent, replacementContent);
    await fs.mkdir(path.dirname(runFilePath), { recursive: true });
    await fs.writeFile(runFilePath, newText, 'utf-8');

    this.promptRegistry.updateContent(registryKey, newText);
    return `提示词文档 "${name}" 局部替换完成，内存热更新已就绪。`;
  }
}
