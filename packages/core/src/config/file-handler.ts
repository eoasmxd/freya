import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/paths.js';

/** 配置文件底层 IO 处理器 */
export class FreyaConfigFileHandler {
  async readFreyaConfig(): Promise<Record<string, any>> {
    const filePath = path.join(PROJECT_ROOT, 'config', 'freya.json');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  async writeFreyaConfig(config: Record<string, any>): Promise<void> {
    const filePath = path.join(PROJECT_ROOT, 'config', 'freya.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  async readProviders(): Promise<any[]> {
    const filePath = path.join(PROJECT_ROOT, 'config', 'providers.json');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async writeProviders(providers: any[]): Promise<void> {
    const filePath = path.join(PROJECT_ROOT, 'config', 'providers.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(providers, null, 2) + '\n', 'utf-8');
  }

  async readPromptFile(name: string): Promise<string> {
    const filePath = path.join(PROJECT_ROOT, 'config', `${name.toUpperCase()}.md`);
    return await fs.readFile(filePath, 'utf-8');
  }

  async writePromptFile(name: string, content: string): Promise<void> {
    const filePath = path.join(PROJECT_ROOT, 'config', `${name.toUpperCase()}.md`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content.trim() + '\n', 'utf-8');
  }
}
