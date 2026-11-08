// Kid screens and the family wall in other languages (dictionaries in shared/i18n.ts).
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { LANGUAGES, isLang, type Lang } from '../../shared/languages.ts';
import { translate } from '../../shared/i18n.ts';
export { translate, type T } from '../../shared/i18n.ts';
import type { T } from '../../shared/i18n.ts';
import { setSpeechLang } from './components/Speak.tsx';
import { setDateLocale } from './components/Bits.tsx';

const LangCtx = createContext<Lang>('en');

/** Puts a part of the app in a language: text, day names and read-aloud. */
export function LangProvider({ lang, children }: { lang: string | null | undefined; children: ReactNode }) {
  const l: Lang = isLang(lang) ? lang : 'en';
  // Set during render so the very first paint already has the right day names and voice.
  setDateLocale(l);
  setSpeechLang(LANGUAGES.find((x) => x.id === l)!.speech);
  useEffect(() => () => { setDateLocale('en'); setSpeechLang('en-US'); }, []);
  return <LangCtx.Provider value={l}>{children}</LangCtx.Provider>;
}

export function useLang(): Lang { return useContext(LangCtx); }

export function useT(): T {
  const lang = useContext(LangCtx);
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

