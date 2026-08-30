"use client";

import { Header } from "@/components/chrome";
import { Gate } from "@/components/gate";
import { QueueList } from "@/components/queue";
import { MetricBand, WidgetCard } from "@/components/widgets";
import { DangerZone } from "@/components/danger-zone";
import { useDovis } from "@/lib/dovis-provider";
import { useI18n } from "@/lib/i18n";

export default function BriefingPage() {
  return (
    <Gate>
      <Header />
      <Briefing />
    </Gate>
  );
}

function Briefing() {
  const { t, lang } = useI18n();
  const { todos, widgets, perms } = useDovis();

  const waiting = todos.filter((x) => x.status === "proposed").length;
  const cards = widgets.filter((w) => w.widget_type !== "metric");

  const headline =
    waiting === 0
      ? t.allClear
      : waiting === 1
        ? t.waitingHeadlineOne
        : t.waitingHeadline.replace("{n}", String(waiting));

  const today = new Date().toLocaleDateString(lang === "en" ? "en-GB" : "zh-TW", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <main className="flex-1 w-full">
      {/*
        The briefing opens like a document, not a dashboard: date, then a sentence
        that answers the only question the reader has on arrival.
      */}
      <section className="mx-auto max-w-5xl px-5 pt-10 pb-7">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {t.briefing} · {today}
        </p>
        <h1 className="mt-2 font-heading text-3xl sm:text-4xl leading-tight text-foreground">
          {headline}
        </h1>
        {!perms.canModify ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.readOnlyHint}</p>
        ) : null}
      </section>

      <div className="mx-auto max-w-5xl">
        <MetricBand widgets={widgets} />
      </div>

      <section className="mx-auto max-w-5xl px-5 py-8">
        <h2 className="font-heading text-sm uppercase tracking-wider text-muted-foreground mb-3">
          {t.queue}
        </h2>
        <div className="paper rounded-lg overflow-hidden">
          <QueueList todos={todos} />
        </div>
      </section>

      {cards.length > 0 ? (
        <section className="mx-auto max-w-5xl px-5 pb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((w) => (
            <WidgetCard key={w.id} widget={w} />
          ))}
        </section>
      ) : null}

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <DangerZone />
      </section>
    </main>
  );
}
