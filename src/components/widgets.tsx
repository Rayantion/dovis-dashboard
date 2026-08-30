"use client";

import { Check } from "lucide-react";
import type { DashboardWidget } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
  Widgets are rows in `dashboard_widgets`. The agent adds one by INSERTing, never
  by writing code — so this renderer must handle any valid row without a deploy,
  and must ignore an invalid one rather than crash the briefing.

  Adding a sixth type means: a value in the widget_type CHECK constraint, a variant
  on WidgetConfig, and a case here. Three places, all of them typed.
*/

export function MetricBand({ widgets }: { widgets: DashboardWidget[] }) {
  const metrics = widgets.filter((w) => w.widget_type === "metric");
  if (metrics.length === 0) return null;

  return (
    <div className="flex flex-wrap items-stretch divide-x divide-border border-y border-border">
      {metrics.map((w) => {
        const c = w.config;
        if (c?.kind !== "metric") return null;
        return (
          <div key={w.id} className="flex-1 min-w-[9rem] px-5 py-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {w.title}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-heading text-3xl leading-none text-foreground tabular-nums">
                {c.value}
              </span>
              {c.delta ? (
                <span className="text-xs font-medium text-primary tabular-nums">
                  {c.delta}
                </span>
              ) : null}
            </div>
            {c.caption ? (
              <div className="mt-1.5 text-xs text-muted-foreground">{c.caption}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function WidgetCard({ widget }: { widget: DashboardWidget }) {
  const body = renderBody(widget);
  if (!body) return null;

  return (
    <section className="paper rounded-lg p-4">
      <h3 className="font-heading text-sm text-foreground mb-3">{widget.title}</h3>
      {body}
    </section>
  );
}

function renderBody(widget: DashboardWidget) {
  const c = widget.config;
  if (!c) return null;

  switch (c.kind) {
    case "chart": {
      const max = Math.max(...c.series.map((s) => s.value), 1);
      return (
        <div className="flex items-stretch gap-2 h-24" role="img" aria-label={widget.title}>
          {c.series.map((s) => (
            <div key={s.label} className="flex-1 flex flex-col gap-1.5">
              {/*
                The bar's percentage height needs a parent with a DEFINITE height
                to resolve against. This wrapper gets one from the flex layout;
                putting the bar directly in the column made every bar collapse to
                nothing, because a column sized by its content has no height to
                take a percentage of.
              */}
              <div className="flex-1 flex items-end">
                <div
                  className="w-full rounded-sm bg-chart-1/85 transition-[height]"
                  style={{ height: `${Math.max((s.value / max) * 100, 4)}%` }}
                  title={`${s.label}: ${s.value}${c.unit ? ` ${c.unit}` : ""}`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground text-center">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      );
    }

    case "list":
      return (
        <ul className="space-y-2">
          {c.items.map((i) => (
            <li key={i.label} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-foreground">{i.label}</span>
              {i.meta ? (
                <span className="text-xs text-muted-foreground shrink-0">{i.meta}</span>
              ) : null}
            </li>
          ))}
        </ul>
      );

    case "checklist":
      return (
        <ul className="space-y-2">
          {c.items.map((i) => (
            <li key={i.label} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "size-4 rounded border grid place-items-center shrink-0",
                  i.done
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-border",
                )}
              >
                {i.done ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              <span
                className={cn(
                  i.done && "line-through text-muted-foreground",
                  "text-foreground",
                )}
              >
                {i.label}
              </span>
            </li>
          ))}
        </ul>
      );

    case "approval":
      return <p className="text-sm text-muted-foreground leading-relaxed">{c.note}</p>;

    // `metric` renders in the band above, not as a card.
    case "metric":
      return null;

    // An unrecognised widget_type renders as nothing. A malformed row must never
    // be able to take the briefing offline.
    default:
      return null;
  }
}
