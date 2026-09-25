import type { FreyaContext, LocalizedText } from '@eoasmxd/freya-sdk';

export type TranslateParams = Record<string, string | number | boolean>;
export type LocaleDictionaries = Record<string, Record<string, string>>;

/**
 * 通用轻量 I18n 管理类
 * Universal lightweight I18n management class
 */
export class I18n {
  constructor(
    private readonly dicts: LocaleDictionaries = {},
    private ctx?: FreyaContext
  ) { }

  setContext(ctx: FreyaContext): void {
    this.ctx = ctx;
  }

  /**
   * 翻译文本并支持动态参数插值
   * Translate text with dynamic parameter interpolation
   */
  t(key: string, defaultEn: string, params?: TranslateParams, defaultLang?: string): string {
    const lang = (this.ctx?.getLanguage(defaultLang) ?? defaultLang ?? 'en').toLowerCase();
    const shortLang = lang.split('-')[0];

    const dict = this.dicts[lang] || this.dicts[shortLang];
    const template = dict?.[key] ?? defaultEn;

    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  }

  /**
   * 从所有已注册语言字典中构建完整的本地化映射，用于注册时提供 LocalizedText
   * Build a complete locale map from all registered language dictionaries, for use in LocalizedText at registration time
   */
  all(key: string, defaultEn: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [lang, dict] of Object.entries(this.dicts)) {
      result[lang] = dict[key] ?? defaultEn;
    }
    if (!result['en']) {
      result['en'] = defaultEn;
    }
    return result;
  }

  /**
   * 将 LocalizedText 解析为当前环境语言对应的文本
   * Resolve LocalizedText to display string for current language
   */
  resolve(text?: LocalizedText, defaultLang?: string): string {
    if (!text) return '';
    if (typeof text === 'string') return text;
    const lang = (this.ctx?.getLanguage(defaultLang) ?? defaultLang ?? 'en').toLowerCase();
    const shortLang = lang.split('-')[0];
    return text[lang] ?? text[shortLang] ?? text['en'] ?? Object.values(text)[0] ?? '';
  }
}



