export type TranslateParams = Record<string, string | number>;

export interface I18nContextValue {
  locale: string;
  setLocale: (lang: string) => void;
  t: (key: string, defaultText: string, params?: TranslateParams) => string;
}
