"use client";

import * as React from "react";
import { ThemeProvider as NextThemes } from "next-themes";
import { dict, Lang, LangContext, LANG_STORAGE_KEY } from "@/lib/i18n";
import { isDemoMode } from "@/lib/config";

/**
 * Records the choice against the account, so it follows the person to their
 * next device instead of living in one browser.
 *
 * Deliberately unawaited and silent. A language preference is not worth a toast,
 * and the viewer's own session is already correct by the time this runs — the
 * only thing a failure costs is that the next device starts on the old answer.
 * The server takes the account from the session; nothing here identifies anyone.
 */
async function persistLang(lang: Lang) {
  try {
    await fetch("/api/account/language", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang }),
    });
  } catch {
    // Offline, or signed out. The local choice stands either way.
  }
}

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

  /*
    The toggle writes three places, and the order matters. State first so the UI
    turns over immediately, localStorage second so a reload before the request
    lands is still correct, and the profile last because it is the only one that
    can fail. A rejected write leaves the viewer's own browser right and the row
    stale — the honest direction, since the alternative is a control that appears
    not to work.

    `setLangState` on mount deliberately does NOT come through here: seeding from
    localStorage must not write back to a profile that may already hold a
    different, more recent answer from another device.
  */
  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem(LANG_STORAGE_KEY, l);
    document.documentElement.lang = l;
    if (!isDemoMode) void persistLang(l);
  }, []);

  /*
    Adopting the profile's answer. Same two local writes as the toggle, minus the
    third: this value came FROM the server, so sending it back would be an echo.
  */
  const adoptLang = React.useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem(LANG_STORAGE_KEY, l);
    document.documentElement.lang = l;
  }, []);

  const value = React.useMemo(
    () => ({ lang, setLang, adoptLang, t: dict[lang] }),
    [lang, setLang, adoptLang],
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
