"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useDovis } from "@/lib/dovis-provider";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Client-side routing gate.
 *
 * This is convenience, NOT security. Every real protection lives in RLS and in
 * the server routes, which check the session and role again on every call. If
 * this component were deleted the data would still be safe; the user would just
 * see an empty page instead of a redirect.
 */
export function Gate({
  children,
  requireOwner = false,
}: {
  children: React.ReactNode;
  requireOwner?: boolean;
}) {
  const { ready, session, perms } = useDovis();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    // A temporary password unlocks exactly one page: the one that replaces it.
    if (session.profile.must_change_password && pathname !== "/set-password") {
      router.replace("/set-password");
      return;
    }
    if (requireOwner && !perms.canManageTeam) router.replace("/");
  }, [ready, session, perms, requireOwner, router, pathname]);

  if (!ready || !session) return <LoadingShell />;
  if (session.profile.must_change_password && pathname !== "/set-password")
    return <LoadingShell />;
  if (requireOwner && !perms.canManageTeam) return <LoadingShell />;

  return <>{children}</>;
}

function LoadingShell() {
  return (
    <div className="mx-auto max-w-5xl w-full px-5 py-12 space-y-4">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
