import type { FreyaContext } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT, PROJECT_ROOT } from '../utils/paths.js';

export interface FreyaSkill {
  id: string;
  name: string;
  description: string;
  content: string;
}

/** 技能注册表，从 skills/ 目录加载 Markdown 格式技能 */
export class FreyaSkillRegistry {
  private skills = new Map<string, FreyaSkill>();

  async loadSkills(context: FreyaContext): Promise<void> {
    const runtimeSkillsDir = path.join(PROJECT_ROOT, 'skills');
    const defaultSkillsDir = path.join(APP_ROOT, 'skills');
    try {
      await fs.mkdir(runtimeSkillsDir, { recursive: true });
      await this.loadSkillsFromDirectory(defaultSkillsDir, context);
      await this.loadSkillsFromDirectory(runtimeSkillsDir, context);
      context.logger.info(`动态技能扫描完成。共加载了 ${this.skills.size} 个物理技能。`);
    } catch (err: any) {
      context.logger.error('扫描物理技能 skills 目录遭遇故障:', err);
    }
  }

  /** 从指定目录加载技能到内存注册表中 */
  private async loadSkillsFromDirectory(dirPath: string, context: FreyaContext): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const rawContent = await fs.readFile(path.join(dirPath, file), 'utf-8');
          const { metadata, content } = this.parseFrontmatter(rawContent);
          if (metadata.id) {
            this.skills.set(metadata.id, {
              id: metadata.id,
              name: metadata.name || file.replace('.md', ''),
              description: metadata.description || '',
              content: content.trim()
            });
          }
        }
      }
    } catch (err) {
      context.logger.warn(`扫描技能目录失败: ${dirPath}`, err);
    }
  }

  getSkills(): Map<string, FreyaSkill> {
    return this.skills;
  }

  get(id: string): FreyaSkill | undefined {
    return this.skills.get(id);
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  /** 解析技能文件的 YAML Frontmatter */
  private parseFrontmatter(rawContent: string): { metadata: Record<string, string>; content: string } {
    const metadata: Record<string, string> = {};
    let content = rawContent;

    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (match) {
      const yamlBlock = match[1];
      content = match[2];

      const lines = yamlBlock.split('\n');
      for (const line of lines) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '');
          metadata[key] = value;
        }
      }
    }
    return { metadata, content };
  }
}
