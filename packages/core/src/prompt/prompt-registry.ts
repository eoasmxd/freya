import fs from 'node:fs/promises';
import path from 'node:path';
import { FREYA_APP, FREYA_HOME, FREYA_LAUNCH } from '../utils/paths.js';

export interface FreyaPrompt {
  key: string;
  content: string;
  defaultPath: string;
  configFileName?: string;
}

/** 提示词内存注册表，管理所有系统及插件级提示词的分类检索 */
export class FreyaPromptRegistry {
  private prompts = new Map<string, FreyaPrompt>();

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

  /** 注册提示词元数据声明并执行三层级联探针载入 */
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

  /** 更新内存中的提示词文本内容 */
  updateContent(key: string, content: string): void {
    const existing = this.prompts.get(key);
    if (existing) {
      existing.content = content.trim();
    }
  }

  /** 注销指定 Key 的内存提示词 */
  unregister(key: string): void {
    this.prompts.delete(key);
  }

  get(key: string): string {
    return this.prompts.get(key)?.content || '';
  }

  getPrompts(): Map<string, FreyaPrompt> {
    return this.prompts;
  }

  /** 扫描并装载所有内核提示词 */
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

  /** 获取并拼装完整的核心 System Prompt */
  getSystemPrompt(): string {
    const identity = this.get('core.prompt.identity');
    const soul = this.get('core.prompt.soul');
    const user = this.get('core.prompt.user');
    const memory = this.get('core.prompt.memory');
    const tools = this.get('core.prompt.tools');
    const agents = this.get('core.prompt.agents');

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    const now = new Date();
    const nowStr = now.toLocaleString('zh-CN', { timeZone });
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absHours = Math.floor(Math.abs(offsetMinutes) / 60);
    const absMins = Math.abs(offsetMinutes) % 60;
    const utcOffset = `UTC${sign}${absHours}${absMins > 0 ? `:${absMins.toString().padStart(2, '0')}` : ''}`;

    const timeStr = `${nowStr} (星期${weekday}, 时区: ${timeZone}, ${utcOffset})`;

    return `# IDENTITY (本体)\n${identity}\n\n` +
      `# SOUL (灵魂)\n${soul}\n\n` +
      `# USER INFO (用户画像)\n${user}\n\n` +
      `# MEMORY (长期记忆)\n${memory}\n\n` +
      `# TOOLS SPEC (工具指南)\n${tools}\n\n` +
      `# AGENT TOPOLOGY (拓扑模式)\n${agents}\n\n` +
      `# CURRENT TIME (当前时间)\n${timeStr}`;
  }

  /** 将核心 System Prompt 与当前激活的技能提示词、工具附加指示词及可用技能列表合成一个最终的系统提示词 */
  composeSystemPrompt(
    activeSkill?: { id: string; content: string },
    toolInstructions: string[] = [],
    availableSkills: { id: string; name: string; description?: string }[] = []
  ): string {
    let systemPrompt = this.getSystemPrompt();

    if (toolInstructions.length > 0) {
      systemPrompt += `\n\n# TOOLS ADDITIONAL INSTRUCTIONS\n${toolInstructions.join('\n\n')}`;
    }

    if (availableSkills && availableSkills.length > 0) {
      const listLines = availableSkills
        .map((s) => `- **${s.name}** (技能ID: \`${s.id}\`)\n  ${s.description || '无描述'}`)
        .join('\n');
      systemPrompt += `\n\n# AVAILABLE SKILLS (可用技能卡列表)\n本系统当前已物理安装并扫描到如下可用特长技能卡（你可通过调用 \`activate_skill("技能ID")\` 激活对应模式）：\n\n${listLines}`;
    }

    if (activeSkill && activeSkill.content) {
      systemPrompt += `\n\n# PLUGIN PROMPT [${activeSkill.id}]\n${activeSkill.content}`;
    }

    return systemPrompt;
  }
}
