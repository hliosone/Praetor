// EN and 简体中文 (spec 07): strings live in en.json / zh-CN.json, the choice is remembered on this device.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import zh from './zh-CN.json';

export type Lang = 'en' | 'zh-CN';
const TABLES: Record<Lang, Record<string, string>> = { en, 'zh-CN': zh };
const KEY = 'praetor.lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch {
    // storage blocked: fall back to the browser language
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('zh') ? 'zh-CN' : 'en';
}

/** The string for a key in a language, with {name} placeholders filled; the key itself when it is missing. */
export function translate(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const s = TABLES[lang][key] ?? TABLES.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

type Ctx = { lang: Lang; setLang(l: Lang): void; t(key: string, vars?: Record<string, string | number>): string };
const I18n = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(initial);
  const value = useMemo<Ctx>(() => ({
    lang,
    setLang: (l) => {
      set(l);
      try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ }
      document.documentElement.lang = l;
    },
    t: (key, vars) => translate(lang, key, vars),
  }), [lang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
