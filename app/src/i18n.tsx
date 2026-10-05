import { useCallback, useMemo, useState, type ReactNode } from "react";
import { persistLocalePreference, resolveLocalePreference, translate } from "./locale";
import { LocaleContext, useLocale } from "./locale-context";
import type { Locale } from "./locale";

export type { Locale } from "./locale";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserPreference(): Locale {
  let storage: StorageLike | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }
  const languages = typeof navigator === "undefined" ? [] : [...navigator.languages, navigator.language];
  return resolveLocalePreference(storage, languages);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(browserPreference);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    let storage: StorageLike | null = null;
    try {
      storage = typeof window === "undefined" ? null : window.localStorage;
    } catch {
      storage = null;
    }
    persistLocalePreference(next, storage);
  }, []);
  const t = useCallback((key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function LanguagePicker({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return <label className={`locale-picker ${className}`.trim()}>
    <span className="sr-only">{t("language.label")}</span>
    <select aria-label={t("language.label")} value={locale} onChange={event => setLocale(event.target.value as Locale)}>
      <option value="en">{t("language.english")}</option>
      <option value="ko">{t("language.korean")}</option>
    </select>
  </label>;
}
