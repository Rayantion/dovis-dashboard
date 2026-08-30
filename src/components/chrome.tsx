"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun, Users, LayoutList, LogOut, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useDovis } from "@/lib/dovis-provider";
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

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs gap-1.5"
            onClick={() => setLang(lang === "en" ? "zh-TW" : "en")}
            aria-label={t.language}
          >
            <Languages className="size-3.5" />
            {lang === "en" ? "繁中" : "EN"}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t.theme}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {mounted && resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t.signOut}
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </header>
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
