import { createContext, useContext } from "react";
import { translate } from "./locale";
import type { Locale, LocaleKeyType } from "./locale";

type Translator = (key: LocaleKeyType, values?: Record<string, string | number>) => string;
export type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translator };

export const LocaleContext = createContext<LocaleContextValue | null>(null);
const englishFallback: LocaleContextValue = {
  locale: "en",
  setLocale: () => {},
  t: (key, values) => translate("en", key, values),
};

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext) ?? englishFallback;
}
