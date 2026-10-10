import fs from 'node:fs/promises';
import path from 'node:path';
import type { FreyaContext, LocalizedText } from '@eoasmxd/freya-sdk';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from '../utils/paths.js';


export interface FreyaPrompt {
  key: string;
  defaultPath: string;
  configFileName?: string;
}

interface PromptEntry extends FreyaPrompt {
  defaultContent: string;
  localizedContents: Map<string, string>;
}

interface ProbeDirectoryTarget {
  dir: string;
  stem: string;
  ext: string;
}

/**
 * 提示词内存注册表，管理所有系统及插件级提示词的分类检索
 * In-memory prompt registry managing classified retrieval of system and plugin prompts
 */
export class FreyaPromptRegistry {
  private prompts = new Map<string, PromptEntry>();
  private readonly i18n: I18n;

  constructor(private ctx?: FreyaContext) {
    this.i18n = new I18n({ zh, en }, ctx);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 注册提示词物理元数据声明并执行五层独立目录探针载入
   * Register prompt physical metadata descriptor and perform five-tier single-directory probe loading
   */
  async register(prompt: FreyaPrompt): Promise<void> {
    const defaultBaseName = path.basename(prompt.defaultPath);
    const defaultExt = path.extname(defaultBaseName);
    const defaultStem = defaultExt ? defaultBaseName.slice(0, -defaultExt.length) : defaultBaseName;

    const cfgExt = prompt.configFileName ? path.extname(prompt.configFileName) : '';
    const cfgStem = prompt.configFileName && cfgExt ? prompt.configFileName.slice(0, -cfgExt.length) : (prompt.configFileName || '');

    const targets: ProbeDirectoryTarget[] = [];

    if (cfgStem) {
      targets.push({ dir: path.join(FREYA_HOME, 'config'), stem: cfgStem, ext: cfgExt });
    }
    targets.push({ dir: path.join(FREYA_HOME, 'config', 'prompts'), stem: defaultStem, ext: defaultExt });

    if (cfgStem) {
      targets.push({ dir: path.join(FREYA_LAUNCH, 'config'), stem: cfgStem, ext: cfgExt });
    }
    targets.push({ dir: path.join(FREYA_LAUNCH, 'config', 'prompts'), stem: defaultStem, ext: defaultExt });

    targets.push({ dir: path.dirname(prompt.defaultPath), stem: defaultStem, ext: defaultExt });

    let defaultContent = '';
    const localizedContents = new Map<string, string>();
    const seenDirs = new Set<string>();

    for (const target of targets) {
      const normalizedDir = path.resolve(target.dir);
      const dirKey = `${normalizedDir}::${target.stem}`;
      if (seenDirs.has(dirKey)) continue;
      seenDirs.add(dirKey);

      let files: string[] = [];
      try {
        files = await fs.readdir(normalizedDir);
      } catch {
        continue;
      }

      const baseFileName = `${target.stem}${target.ext}`;
      const langRegex = new RegExp(`^${this.escapeRegex(target.stem)}\\.([a-zA-Z0-9_-]+)${this.escapeRegex(target.ext)}$`, 'i');

      const matchedLangFiles: { lang: string; fileName: string }[] = [];
      let matchedBaseFileName: string | null = null;

      for (const file of files) {
        if (file.toLowerCase() === baseFileName.toLowerCase()) {
          matchedBaseFileName = file;
          continue;
        }
        const match = file.match(langRegex);
        if (match) {
          const lang = match[1].toLowerCase().split('-')[0];
          matchedLangFiles.push({ lang, fileName: file });
        }
      }

      if (!matchedBaseFileName && matchedLangFiles.length === 0) {
        continue;
      }

      if (matchedBaseFileName) {
        try {
          const text = await fs.readFile(path.join(normalizedDir, matchedBaseFileName), 'utf-8');
          if (text.trim().length > 0) {
            defaultContent = text.trim();
          }
        } catch { }
      }

      for (const { lang, fileName } of matchedLangFiles) {
        try {
          const text = await fs.readFile(path.join(normalizedDir, fileName), 'utf-8');
          if (text.trim().length > 0) {
            localizedContents.set(lang, text.trim());
          }
        } catch { }
      }

      if (!defaultContent && localizedContents.size > 0) {
        defaultContent = localizedContents.values().next().value || '';
      }

      break;
    }

    this.prompts.set(prompt.key, {
      key: prompt.key,
      defaultContent,
      localizedContents,
      defaultPath: prompt.defaultPath,
      configFileName: prompt.configFileName
    });
  }

  /**
   * 更新内存中的提示词文本内容
   * Update prompt text content in memory
   */
  updateContent(key: string, content: string): void {
    const existing = this.prompts.get(key);
    if (existing) {
      const trimmed = content.trim();
      existing.defaultContent = trimmed;
      existing.localizedContents.clear();
    }
  }

  /**
   * 注销指定 Key 的内存提示词
   * Unregister in-memory prompt by specified key
   */
  unregister(key: string): void {
    this.prompts.delete(key);
  }

  get(key: string, lang?: string): string {
    const prompt = this.prompts.get(key);
    if (!prompt) return '';

    const targetLang = (this.ctx?.getLanguage(lang) ?? lang ?? 'en').toLowerCase().split('-')[0];
    const localized = prompt.localizedContents.get(targetLang);
    if (localized && localized.trim().length > 0) {
      return localized;
    }
    return prompt.defaultContent || '';
  }

  getPrompts(): Map<string, FreyaPrompt> {
    return this.prompts;
  }

  /**
   * 扫描并装载所有内核提示词
   * Scan and load all kernel prompts
   */
  async loadKernelPrompts(): Promise<void> {
    const defaultDirPath = path.join(FREYA_APP, 'config', 'prompts');
    try {
      const corePrompts = new Set(['identity', 'soul', 'tools', 'agents', 'user', 'memory']);
      for (const name of corePrompts) {
        await this.register({
          key: `core.prompt.${name}`,
          defaultPath: path.join(defaultDirPath, `core.prompt.${name}.md`),
          configFileName: `${name.toUpperCase()}.md`
        });
      }

      try {
        const rawFiles = await fs.readdir(defaultDirPath);

        const candidateFiles = rawFiles.filter((file) => {
          if (!file.endsWith('.md')) return false;
          if (/-guide\.md$|\.guide\.md$/i.test(file)) return false;
          return true;
        });

        const baseFileSet = new Set<string>();
        for (const file of candidateFiles) {
          const normalizedBase = file.replace(/\.[a-z]{2}(-[a-z]{2})?\.md$/i, '.md');
          baseFileSet.add(normalizedBase);
        }

        const targetFiles = Array.from(baseFileSet).filter((file) => {
          const key = file.slice(0, -3);
          const stem = key.replace('core.prompt.', '');
          return !corePrompts.has(stem);
        });

        for (const file of targetFiles) {
          await this.register({
            key: file.slice(0, -3),
            defaultPath: path.join(defaultDirPath, file)
          });
        }
      } catch { }
    } catch { }
  }

  /**
   * 获取并拼装完整的核心 System Prompt
   * Retrieve and assemble full core System Prompt
   */
  getSystemPrompt(lang?: string): string {
    const targetLang = (this.ctx?.getLanguage(lang) ?? lang ?? 'en').toLowerCase().split('-')[0];
    const identity = this.get('core.prompt.identity', targetLang);
    const soul = this.get('core.prompt.soul', targetLang);
    const user = this.get('core.prompt.user', targetLang);
    const memory = this.get('core.prompt.memory', targetLang);
    const tools = this.get('core.prompt.tools', targetLang);
    const agents = this.get('core.prompt.agents', targetLang);

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    const now = new Date();
    const nowStr = now.toLocaleString('en-US', { timeZone });
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const absMins = Math.abs(offsetMinutes) % 60;
    const utcOffset = `UTC${sign}${absHours}${absMins > 0 ? `:${absMins.toString().padStart(2, '0')}` : ''}`;

    // 当前系统时间
    const timeStr = `${nowStr} (${weekday}, TimeZone: ${timeZone}, ${utcOffset})`;
    const langDirective = `The user's preferred language is "${targetLang}". Please interact and respond in this language unless the user explicitly requests another language.`;

    return `# IDENTITY\n${identity}\n\n` + // 智能体本体定义
      `# SOUL\n${soul}\n\n` + // 智能体灵魂与行为风格
      `# USER INFO\n${user}\n\n` + // 用户画像信息
      `# MEMORY\n${memory}\n\n` + // 长期记忆
      `# TOOLS SPEC\n${tools}\n\n` + // 工具使用规范指南
      `# AGENT TOPOLOGY\n${agents}\n\n` + // 智能体拓扑模式
      `# CURRENT TIME\n${timeStr}\n\n` + // 当前系统时间
      `# LANGUAGE DIRECTIVE\n${langDirective}`; // 动态语言引导指令
  }

  /**
   * 将核心 System Prompt 与当前激活的技能提示词、工具附加指示词及可用技能列表合成一个最终的系统提示词
   * Compose core System Prompt with active skill, tool instructions, and available skills into final prompt
   */
  composeSystemPrompt(
    activeSkill?: { id: string; content: string },
    availableSkills: { id: string; name: LocalizedText; description?: LocalizedText }[] = [],
    activeToolboxIds: string[] = [],
    availableToolboxes: { id: string; instruction?: string }[] = [],
    lang?: string
  ): string {
    let systemPrompt = this.getSystemPrompt(lang);

    const toolBlocks: string[] = [];
    const metaPrompt = this.get('tool.prompt.meta', lang);
    if (metaPrompt) {
      toolBlocks.push(`### Core Meta Capabilities\n${metaPrompt}`);
    }

    const hasToolboxes = availableToolboxes.length > 0 || activeToolboxIds.length > 0;
    if (hasToolboxes) {
      const loadedBoxStr = activeToolboxIds.length > 0
        ? activeToolboxIds.map((id) => `\`${id}\``).join(', ')
        : 'None';
      const inactiveBoxes = availableToolboxes.filter((tb) => !activeToolboxIds.includes(tb.id));
      const onDemandBoxStr = inactiveBoxes.length > 0
        ? inactiveBoxes.map((tb) => `\`${tb.id}\``).join(', ')
        : 'None';

      toolBlocks.push([
        `- Loaded Toolboxes (In-Use): ${loadedBoxStr} (Tools are ready in your tools list. Do NOT call activate_toolbox)`,
        `- On-Demand Toolboxes (Available): ${onDemandBoxStr} (Call \`activate_toolbox(["id"])\` when needed)`
      ].join('\n'));

      for (const tb of availableToolboxes) {
        if (tb.instruction) {
          const isLoaded = activeToolboxIds.includes(tb.id);
          const statusTag = isLoaded
            ? '(Status: Loaded / In-Use)'
            : '(Status: Available On-Demand)';
          toolBlocks.push(`### Toolbox Capabilities [ID: "${tb.id}"] ${statusTag}\n${tb.instruction}`);
        }
      }
    }

    if (toolBlocks.length > 0) {
      systemPrompt += `\n\n# TOOLS ADDITIONAL INSTRUCTIONS\n${toolBlocks.join('\n\n')}`;
    }

    const pendingSkills = (availableSkills || []).filter((s) => s.id !== activeSkill?.id);
    if (pendingSkills.length > 0) {
      const listLines = pendingSkills
        .map((s) => {
          const name = this.i18n.resolve(s.name);
          const desc = this.i18n.resolve(s.description) || 'No description';
          return `- **${name}** (Skill ID: \`${s.id}\`)\n  ${desc}`;
        })
        .join('\n');

      systemPrompt += `\n\n# AVAILABLE SKILLS\nThe system has detected the following available skills (activate via \`activate_skill("skill_id")\`):\n\n${listLines}`;
    }

    if (activeSkill && activeSkill.content) {
      systemPrompt += `\n\n# ACTIVE SKILL [${activeSkill.id}]\n${activeSkill.content}`;
    }

    return systemPrompt;
  }
}



