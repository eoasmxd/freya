import type { FreyaContext, LocalizedText } from '@eoasmxd/freya-sdk';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from '../utils/paths.js';

export interface FreyaSkill {
  id: string;
  name: LocalizedText;
  description?: LocalizedText;
  content: string;
  enabled: boolean;
  source: 'builtin' | 'launch' | 'runtime';
}

/**
 * 技能注册表，从 skills/ 目录加载 Markdown 格式技能并管理软开关状态
 * Skill registry that loads Markdown skills from skills/ directory and manages toggle states
 */
export class FreyaSkillRegistry {
  private skills = new Map<string, FreyaSkill>();
  private context?: FreyaContext;

  async loadSkills(context: FreyaContext): Promise<void> {
    this.context = context;
    const defaultSkillsDir = path.join(FREYA_APP, 'skills');
    const launchSkillsDir = path.join(FREYA_LAUNCH, 'skills');
    const runtimeSkillsDir = path.join(FREYA_HOME, 'skills');
    const configSkillsPath = path.join(FREYA_HOME, 'config', 'skills.json');

    try {
      await fs.mkdir(runtimeSkillsDir, { recursive: true });
      await this.loadSkillsFromDirectory(defaultSkillsDir, 'builtin', context);

      const resolvedDefault = path.resolve(defaultSkillsDir);
      const resolvedLaunch = path.resolve(launchSkillsDir);
      const resolvedRuntime = path.resolve(runtimeSkillsDir);

      if (resolvedLaunch !== resolvedDefault && resolvedLaunch !== resolvedRuntime) {
        await this.loadSkillsFromDirectory(launchSkillsDir, 'launch', context);
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
      context.logger.info(`Dynamic skill scan completed. Loaded ${this.skills.size} physical skills (${enabledCount} enabled).`);
    } catch (err: any) {
      context.logger.error('Failed to scan physical skills directory:', err);
    }
  }

  /**
   * 从指定目录加载技能到内存注册表中
   * Load skills from specified directory into in-memory registry
   */
  private async loadSkillsFromDirectory(dirPath: string, source: 'builtin' | 'launch' | 'runtime', context: FreyaContext): Promise<void> {
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

            const name = metadata.name && (typeof metadata.name !== 'object' || Object.keys(metadata.name).length > 0)
              ? metadata.name
              : file.replace('.md', '');

            this.skills.set(metadata.id, {
              id: metadata.id,
              name,
              description: metadata.description || '',
              content: content.trim(),
              enabled: finalEnabled,
              source: finalSource
            });
          }
        }
      }
    } catch (err) {
      context.logger.warn(`Failed to scan skill directory: ${dirPath}`, err);
    }
  }

  /**
   * 获取技能列表（默认只返回启用状态的技能）
   * Get skill list (returns only enabled skills by default)
   */
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

  /**
   * 获取全量技能数组（供管理控制台使用）
   * Get all skills array (for management console)
   */
  getAllSkills(): FreyaSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 切换技能的启用/禁用状态并持久化
   * Toggle skill enabled/disabled status and persist
   */
  async toggleSkill(skillId: string, enabled: boolean): Promise<string> {
    const i18n = new I18n({ zh, en }, this.context);
    const skill = this.skills.get(skillId);
    if (!skill) {
      return i18n.t('skill.toggle.notFound', '❌ Skill with ID "{id}" not found. Please verify the name.', { id: skillId });
    }

    const displayName = i18n.resolve(skill.name) || skillId;
    const state = enabled
      ? i18n.t('skill.toggle.stateEnabled', 'enabled')
      : i18n.t('skill.toggle.stateDisabled', 'disabled');

    if (skill.enabled === enabled) {
      return i18n.t('skill.toggle.alreadyInState', 'ℹ️ Skill "{name}" is already {state}.', { name: displayName, state });
    }

    skill.enabled = enabled;
    const configSkillsPath = path.join(FREYA_HOME, 'config', 'skills.json');
    try {
      await this.persistSkillsConfig(configSkillsPath);
      this.context?.logger.info(`Skill "${displayName}" status changed to: ${enabled ? 'enabled' : 'disabled'}`);
      return i18n.t('skill.toggle.success', '✅ Skill "{name}" has been successfully {state}.', { name: displayName, state });
    } catch (err: any) {
      return i18n.t('skill.toggle.writeFailed', '❌ Skill state changed, but failed to write skills.json: {message}', { message: err.message });
    }
  }

  /**
   * 持久化当前所有技能启停状态至 skills.json
   * Persist current enabled states of all skills to skills.json
   */
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

  /**
   * 解析技能文件的 YAML Frontmatter
   * Parse YAML Frontmatter of skill files
   */
  private parseFrontmatter(rawContent: string): { metadata: Record<string, any>; content: string } {
    const metadata: Record<string, any> = {};
    let content = rawContent;

    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      return { metadata, content };
    }

    const yamlBlock = match[1];
    content = match[2];
    let activeKey: string | null = null;

    for (const rawLine of yamlBlock.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.trim() || line.trim().startsWith('#')) continue;

      if (/^\s+/.test(line) && activeKey) {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          const subKey = line.slice(0, colonIndex).trim();
          const subValue = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
          if (typeof metadata[activeKey] !== 'object' || metadata[activeKey] === null) {
            metadata[activeKey] = {};
          }
          metadata[activeKey][subKey] = subValue;
        }
        continue;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (value === '') {
          metadata[key] = {};
          activeKey = key;
        } else {
          metadata[key] = value;
          activeKey = null;
        }
      }
    }

    return { metadata, content };
  }
}
