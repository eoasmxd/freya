import fs from 'node:fs/promises';
import path from 'node:path';
import type { FreyaContext, LocalizedText } from '@eoasmxd/freya-sdk';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from '../utils/paths.js';


export interface FreyaPrompt {
  key: string;
  content: string;
  defaultPath: string;
  configFileName?: string;
}

/**
 * 提示词内存注册表，管理所有系统及插件级提示词的分类检索
 * In-memory prompt registry managing classified retrieval of system and plugin prompts
 */
export class FreyaPromptRegistry {
  private prompts = new Map<string, FreyaPrompt>();
  private readonly i18n: I18n;

  constructor(private ctx?: FreyaContext) {
    this.i18n = new I18n({ zh, en }, ctx);
  }


  private resolveProbePaths(prompt: Omit<FreyaPrompt, 'content'>): string[] {
    const baseName = path.basename(prompt.defaultPath);
    const rawPaths: string[] = [];

    if (prompt.configFileName) {
      rawPaths.push(path.join(FREYA_HOME, 'config', prompt.configFileName));
      rawPaths.push(path.join(FREYA_LAUNCH, 'config', prompt.configFileName));
    }

    rawPaths.push(path.join(FREYA_HOME, 'config', 'prompts', baseName));
    rawPaths.push(path.join(FREYA_LAUNCH, 'config', 'prompts', baseName));
    rawPaths.push(prompt.defaultPath);

    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const rawPath of rawPaths) {
      const normalized = path.resolve(rawPath);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        candidates.push(normalized);
      }
    }
    return candidates;
  }

  /**
   * 注册提示词元数据声明并执行三层级联探针载入
   * Register prompt metadata declaration and perform three-tier cascading probe loading
   */
  async register(prompt: Omit<FreyaPrompt, 'content'>): Promise<void> {
    const probePaths = this.resolveProbePaths(prompt);
    let content = '';

    for (const filePath of probePaths) {
      try {
        const text = await fs.readFile(filePath, 'utf-8');
        if (text.trim().length > 0) {
          content = text;
          break;
        }
      } catch {}
    }

    this.prompts.set(prompt.key, {
      key: prompt.key,
      content: content.trim(),
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
      existing.content = content.trim();
    }
  }

  /**
   * 注销指定 Key 的内存提示词
   * Unregister in-memory prompt by specified key
   */
  unregister(key: string): void {
    this.prompts.delete(key);
  }

  get(key: string): string {
    return this.prompts.get(key)?.content || '';
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
      const corePrompts = ['identity', 'soul', 'tools', 'agents', 'user', 'memory'];
      for (const name of corePrompts) {
        await this.register({
          key: `core.prompt.${name}`,
          defaultPath: path.join(defaultDirPath, `core.prompt.${name}.md`),
          configFileName: `${name.toUpperCase()}.md`
        });
      }

      try {
        const defaultFiles = await fs.readdir(defaultDirPath);
        for (const file of defaultFiles) {
          if (file.endsWith('.md')) {
            const key = file.slice(0, -3);
            const baseName = key.replace('core.prompt.', '');
            if (corePrompts.includes(baseName)) {
              continue;
            }

            await this.register({
              key,
              defaultPath: path.join(defaultDirPath, file)
            });
          }
        }
      } catch {}
    } catch {}
  }

  /**
   * 获取并拼装完整的核心 System Prompt
   * Retrieve and assemble full core System Prompt
   */
  getSystemPrompt(): string {
    const identity = this.get('core.prompt.identity');
    const soul = this.get('core.prompt.soul');
    const user = this.get('core.prompt.user');
    const memory = this.get('core.prompt.memory');
    const tools = this.get('core.prompt.tools');
    const agents = this.get('core.prompt.agents');

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

    const rawLang = this.ctx?.getLanguage('en');
    const isZh = rawLang?.toLowerCase().startsWith('zh');
    const langName = isZh ? 'Chinese' : 'English';
    const langCode = isZh ? 'zh' : 'en';
    // 动态语言引导指令
    const langDirective = `The user's preferred language is ${langName} ("${langCode}"). Please interact and respond in ${langName} unless the user explicitly requests another language.`;

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
    toolInstructions: string[] = [],
    availableSkills: { id: string; name: LocalizedText; description?: LocalizedText }[] = []
  ): string {
    let systemPrompt = this.getSystemPrompt();

    if (toolInstructions.length > 0) {
      systemPrompt += `\n\n# TOOLS ADDITIONAL INSTRUCTIONS\n${toolInstructions.join('\n\n')}`;
    }

    if (availableSkills && availableSkills.length > 0) {
      const listLines = availableSkills
        .map((s) => {
          const name = this.i18n.resolve(s.name);
          const desc = this.i18n.resolve(s.description) || 'No description';
          return `- **${name}** (Skill ID: \`${s.id}\`)\n  ${desc}`;
        })
        .join('\n');

      systemPrompt += `\n\n# AVAILABLE SKILLS\nThe system has detected the following available skills (activate via \`activate_skill("skill_id")\`):\n\n${listLines}`;
    }

    if (activeSkill && activeSkill.content) {
      systemPrompt += `\n\n# PLUGIN PROMPT [${activeSkill.id}]\n${activeSkill.content}`;
    }

    return systemPrompt;
  }
}



