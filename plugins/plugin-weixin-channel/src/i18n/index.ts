import type { FreyaContext, LocalizedText } from "@eoasmxd/freya-sdk";

export type TranslateParams = Record<string, string | number | boolean>;
export type LocaleDictionaries = Record<string, Record<string, string>>;

/**
 * 微信通道插件轻量 I18n 管理类
 * WeChat channel plugin lightweight I18n management class
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
    const lang = (this.ctx?.getLanguage(defaultLang) ?? defaultLang ?? "en").toLowerCase();
    const shortLang = lang.split("-")[0];

    const dict = this.dicts[lang] || this.dicts[shortLang];
    const template = dict?.[key] ?? defaultEn;

    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  }

  all(key: string, defaultEn: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [lang, dict] of Object.entries(this.dicts)) {
      result[lang] = dict[key] ?? defaultEn;
    }
    if (!result["en"]) {
      result["en"] = defaultEn;
    }
    return result;
  }

  resolve(text?: LocalizedText, defaultLang?: string): string {
    if (!text) return "";
    if (typeof text === "string") return text;
    const lang = (this.ctx?.getLanguage(defaultLang) ?? defaultLang ?? "en").toLowerCase();
    const shortLang = lang.split("-")[0];
    return text[lang] ?? text[shortLang] ?? text["en"] ?? Object.values(text)[0] ?? "";
  }

}


