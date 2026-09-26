import React, { createContext, useContext, useState, useMemo } from 'react';
import type { I18nContextValue, TranslateParams } from './types.js';
import { zh } from './locales/zh.js';
import { en } from './locales/en.js';

const dictionaries: Record<string, Record<string, string>> = { zh, en };

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocale] = useState<string>(() => {
    return (typeof window !== 'undefined' && (window as any).__FREYA_LANGUAGE__) || 'en';
  });

  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      setLocale,
      t: (key: string, defaultText: string, params?: TranslateParams) => {
        const dict = dictionaries[locale];
        const text = dict?.[key] ?? defaultText;
        return interpolate(text, params);
      }
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
