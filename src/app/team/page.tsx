"use client";

import { Header } from "@/components/chrome";
import { Gate } from "@/components/gate";
import { TeamTable } from "@/components/team-table";

export default function TeamPage() {
  return (
    <Gate requireOwner>
      <Header />
      <main className="flex-1 w-full mx-auto max-w-5xl px-5 py-10">
        <TeamTable />
      </main>
    </Gate>
  );
}
