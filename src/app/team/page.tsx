"use client";

import { Suspense } from "react";
import { Header } from "@/components/chrome";
import { Gate } from "@/components/gate";
import { TeamTable } from "@/components/team-table";
import { GoogleConnect } from "@/components/google-connect";

export default function TeamPage() {
  return (
    <Gate requireOwner>
      <Header />
      <main className="flex-1 w-full mx-auto max-w-5xl px-5 py-10 space-y-8">
        {/* useSearchParams needs a Suspense boundary or the page cannot prerender. */}
        <Suspense fallback={null}>
          <GoogleConnect />
        </Suspense>
        <TeamTable />
      </main>
    </Gate>
  );
}
