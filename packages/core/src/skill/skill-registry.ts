import type { FreyaContext } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FREYA_APP, FREYA_HOME, FREYA_WORKSPACE } from '../utils/paths.js';

export interface FreyaSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  source: 'builtin' | 'workspace' | 'runtime';
}

/** 技能注册表，从 skills/ 目录加载 Markdown 格式技能并管理软开关状态 */
export class FreyaSkillRegistry {
  private skills = new Map<string, FreyaSkill>();
  private context?: FreyaContext;

  async loadSkills(context: FreyaContext): Promise<void> {
    this.context = context;
    const defaultSkillsDir = path.join(FREYA_APP, 'skills');
    const workspaceSkillsDir = path.join(FREYA_WORKSPACE, 'skills');
    const runtimeSkillsDir = path.join(FREYA_HOME, 'skills');
    const configSkillsPath = path.join(FREYA_HOME, 'config', 'skills.json');

    try {
      await fs.mkdir(runtimeSkillsDir, { recursive: true });
      await this.loadSkillsFromDirectory(defaultSkillsDir, 'builtin', context);

      const resolvedDefault = path.resolve(defaultSkillsDir);
      const resolvedWorkspace = path.resolve(workspaceSkillsDir);
      const resolvedRuntime = path.resolve(runtimeSkillsDir);

      if (resolvedWorkspace !== resolvedDefault && resolvedWorkspace !== resolvedRuntime) {
        await this.loadSkillsFromDirectory(workspaceSkillsDir, 'workspace', context);
      }

      await this.loadSkillsFromDirectory(runtimeSkillsDir, 'runtime', context);

      let configList: Array<{ id: string; enabled: boolean }> = [];
      try {
        const raw = await fs.readFile(configSkillsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          configList = parsed;
        }
      } catch {
        configList = [];
      }

      const configMap = new Map<string, boolean>();
      for (const item of configList) {
        if (item && typeof item.id === 'string' && typeof item.enabled === 'boolean') {
          configMap.set(item.id, item.enabled);
        }
      }

      let configChanged = false;
      for (const skill of this.skills.values()) {
        if (configMap.has(skill.id)) {
          skill.enabled = configMap.get(skill.id)!;
        } else {
          configChanged = true;
        }
      }

      if (configChanged || configList.length !== this.skills.size) {
        await this.persistSkillsConfig(configSkillsPath);
      }

      const enabledCount = Array.from(this.skills.values()).filter((s) => s.enabled).length;
      context.logger.info(`动态技能扫描完成。共加载 ${this.skills.size} 个物理技能 (已启用: ${enabledCount})。`);
    } catch (err: any) {
      context.logger.error('扫描物理技能 skills 目录遭遇故障:', err);
    }
  }

  /** 从指定目录加载技能到内存注册表中 */
  private async loadSkillsFromDirectory(dirPath: string, source: 'builtin' | 'workspace' | 'runtime', context: FreyaContext): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const rawContent = await fs.readFile(path.join(dirPath, file), 'utf-8');
          const { metadata, content } = this.parseFrontmatter(rawContent);
          if (metadata.id) {
            const defaultEnabled = metadata.defaultEnabled !== undefined
              ? metadata.defaultEnabled !== 'false'
              : source !== 'runtime';

            const existing = this.skills.get(metadata.id);
            const finalSource = existing?.source === 'builtin' ? 'builtin' : source;
            const finalEnabled = existing !== undefined ? existing.enabled : defaultEnabled;

            this.skills.set(metadata.id, {
              id: metadata.id,
              name: metadata.name || file.replace('.md', ''),
              description: metadata.description || '',
              content: content.trim(),
              enabled: finalEnabled,
              source: finalSource
            });
          }
        }
      }
    } catch (err) {
      context.logger.warn(`扫描技能目录失败: ${dirPath}`, err);
    }
  }

  /** 获取技能列表（默认只返回启用状态的技能） */
  getSkills(onlyEnabled: boolean = true): Map<string, FreyaSkill> {
    if (!onlyEnabled) {
      return this.skills;
    }
    const filtered = new Map<string, FreyaSkill>();
    for (const [id, skill] of this.skills.entries()) {
      if (skill.enabled) {
        filtered.set(id, skill);
      }
    }
    return filtered;
  }

  /** 获取全量技能数组（供管理控制台使用） */
  getAllSkills(): FreyaSkill[] {
    return Array.from(this.skills.values());
  }

  /** 切换技能的启用/禁用状态并持久化 */
  async toggleSkill(skillId: string, enabled: boolean): Promise<string> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return `❌ 未找到 ID 为 "${skillId}" 的技能，请检查名称是否正确。`;
    }

    if (skill.enabled === enabled) {
      return `ℹ️ 技能 "${skill.name || skillId}" 状态已是 ${enabled ? '启用' : '禁用'}。`;
    }

    skill.enabled = enabled;
    const configSkillsPath = path.join(FREYA_HOME, 'config', 'skills.json');
    try {
      await this.persistSkillsConfig(configSkillsPath);
      this.context?.logger.info(`技能 "${skill.name || skillId}" 已切换为: ${enabled ? '启用' : '禁用'}`);
      return `✅ 技能 "${skill.name || skillId}" 已成功${enabled ? '启用' : '禁用'}。`;
    } catch (err: any) {
      return `❌ 技能状态变更成功，但写入 skills.json 失败: ${err.message}`;
    }
  }

  /** 持久化当前所有技能启停状态至 skills.json */
  private async persistSkillsConfig(configSkillsPath: string): Promise<void> {
    await fs.mkdir(path.dirname(configSkillsPath), { recursive: true });
    const payload = Array.from(this.skills.values()).map((s) => ({
      id: s.id,
      enabled: s.enabled
    }));
    await fs.writeFile(configSkillsPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
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
