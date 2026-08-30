"use client";

import * as React from "react";
import { ThemeProvider as NextThemes } from "next-themes";
import { dict, Lang, LangContext, LANG_STORAGE_KEY } from "@/lib/i18n";

/**
 * Light is the default and the designed-for case — this is read in daylight, and a
 * dark admin theme would make it feel like a tool rather than a briefing. Dark is a
 * real palette for late reading, not an afterthought inversion.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>("en");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "en" || stored === "zh-TW") setLangState(stored);
  }, []);

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem(LANG_STORAGE_KEY, l);
    document.documentElement.lang = l;
  }, []);

  const value = React.useMemo(
    () => ({ lang, setLang, t: dict[lang] }),
    [lang, setLang],
  );

  return (
    <NextThemes
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <LangContext.Provider value={value}>{children}</LangContext.Provider>
    </NextThemes>
  );
}
