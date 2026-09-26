import type { FreyaContext } from '@eoasmxd/freya-sdk';

export type TranslateParams = Record<string, string | number | boolean>;
export type LocaleDictionaries = Record<string, Record<string, string>>;

/**
 * Gemini 插件轻量 I18n 管理类
 * Gemini plugin lightweight I18n management class
 */
export class I18n {
  constructor(
    private readonly dicts: LocaleDictionaries = {},
    private ctx?: FreyaContext
  ) { }

  setContext(ctx: FreyaContext): void {
    this.ctx = ctx;
  }

  t(key: string, defaultEn: string, params?: TranslateParams, defaultLang?: string): string {
    const lang = (this.ctx?.getLanguage(defaultLang) ?? defaultLang ?? 'en').toLowerCase();
    const shortLang = lang.split('-')[0];

    const dict = this.dicts[lang] || this.dicts[shortLang];
    const template = dict?.[key] ?? defaultEn;

    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  }
}
