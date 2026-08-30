"use client";

import * as React from "react";
import { ThemeProvider as NextThemes } from "next-themes";
import { dict, Lang, LangContext, LANG_STORAGE_KEY } from "@/lib/i18n";

/**
 * The theme follows the boss's own browser. `defaultTheme="system"` means a device
 * set to dark opens dark and a device set to light opens light, with no choice to
 * make on first visit — and next-themes injects a blocking script so the correct
 * palette paints on the first frame rather than flashing the wrong one.
 *
 * The toggle still exists and, once used, wins over the system preference for that
 * browser. Both palettes are designed: light is warm paper with ink type, dark
 * makes the ink-teal the ground rather than inverting the light theme. Amber keeps
 * its meaning in both, because "a decision is waiting on you" must not change with
 * the time of day.
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
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <LangContext.Provider value={value}>{children}</LangContext.Provider>
    </NextThemes>
  );
}
