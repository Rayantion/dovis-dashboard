"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun, Users, LayoutList, LogOut, Languages } from "lucide-react";
import { useI18n, type Lang } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";
import { StaleBanner } from "@/components/refresh-control";
import { cn } from "@/lib/utils";

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { session, perms, signOut, demo } = useDovis();
  /*
    `resolvedTheme`, not `theme`. With the system preference enabled, `theme` is
    the literal string "system" until someone touches the toggle — so keying the
    icon or the toggle off it would show a moon to a boss already in dark mode,
    and the first click would appear to do nothing.
  */
  const { resolvedTheme, setTheme } = useTheme();
  const pathname = usePathname();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!session) return null;

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-30">
      {demo ? (
        <div className="bg-secondary text-secondary-foreground text-center text-xs py-1.5 px-4 font-medium">
          {t.demoBanner}
        </div>
      ) : null}

      {/*
        At 375px the brand, both nav labels and three icon buttons came to 406px
        and pushed a horizontal scrollbar onto the whole page. Below `sm` the nav
        drops to icons only, which is the ~90px that makes it fit.
      */}
      <div className="mx-auto max-w-5xl px-4 sm:px-5 h-14 flex items-center gap-2 sm:gap-4">
        <Link href="/" className="flex items-baseline gap-2.5 group">
          <span className="font-heading text-xl tracking-tight text-primary">
            {t.brand}
          </span>
          <span className="hidden sm:inline text-[11px] text-muted-foreground">
            {session.profile.display_name ?? session.profile.username}
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/" active={pathname === "/"} icon={<LayoutList className="size-3.5" />}>
            {t.briefing}
          </NavLink>
          {perms.canManageTeam ? (
            <NavLink
              href="/team"
              active={pathname === "/team"}
              icon={<Users className="size-3.5" />}
            >
              {t.team}
            </NavLink>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <LanguageChip
            lang={lang}
            label={t.language}
            onToggle={() => setLang(lang === "en" ? "zh-TW" : "en")}
          />

          <ThemePill
            label={t.theme}
            isDark={mounted && resolvedTheme === "dark"}
            onPick={setTheme}
          />

          <button
            type="button"
            aria-label={t.signOut}
            onClick={() => void signOut()}
            className="squircle grid size-8 place-items-center border border-border bg-card text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/25"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>

      {/*
        Inside the sticky header rather than floating over the page: it stays
        visible while scrolling without ever covering the row someone is about to
        act on, and it needs no magic offset to clear the demo strip above.
      */}
      <StaleBanner />
    </header>
  );
}

/**
 * Shows the language you are IN, not the one you would switch to.
 *
 * Those two conventions look interchangeable and are not: a button reading 繁中
 * while the page is in English is ambiguous — it could equally mean "you are in
 * Chinese" — and the reader cannot tell without looking at the rest of the page.
 * Showing current state is unambiguous; the icon and the hover carry the
 * affordance instead.
 */
function LanguageChip({
  lang,
  label,
  onToggle,
}: {
  lang: Lang;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="squircle inline-flex h-8 items-center gap-1.5 border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/25 hover:bg-muted"
    >
      <Languages className="size-3.5 text-muted-foreground" />
      {lang === "en" ? "EN" : "繁中"}
    </button>
  );
}

/**
 * Two-state pill. Both destinations are visible at once and the thumb marks which
 * one is active, so the control states the current theme rather than only hinting
 * at the next one — the same reasoning as the language chip.
 */
function ThemePill({
  isDark,
  label,
  onPick,
}: {
  isDark: boolean;
  label: string;
  onPick: (t: "light" | "dark") => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="relative inline-flex h-8 items-center rounded-full border border-border bg-muted p-0.5"
    >
      {/*
        The thumb is a sibling behind both buttons rather than a background on the
        active one, so it can slide between them instead of blinking.
      */}
      <span
        aria-hidden
        className="absolute left-0.5 top-0.5 size-7 rounded-full bg-card shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: isDark ? "translateX(1.75rem)" : "translateX(0)" }}
      />
      <button
        type="button"
        onClick={() => onPick("light")}
        aria-pressed={!isDark}
        aria-label="Light"
        className={cn(
          "relative z-10 grid size-7 place-items-center rounded-full transition-colors",
          isDark ? "text-muted-foreground hover:text-foreground" : "text-foreground",
        )}
      >
        <Sun className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onPick("dark")}
        aria-pressed={isDark}
        aria-label="Dark"
        className={cn(
          "relative z-10 grid size-7 place-items-center rounded-full transition-colors",
          isDark ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Moon className="size-3.5" />
      </button>
    </div>
  );
}

function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 sm:px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}
