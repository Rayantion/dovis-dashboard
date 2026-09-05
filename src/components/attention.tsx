"use client";

import * as React from "react";
import {
  ChevronDown,
  Flag,
  Hourglass,
  Info,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { ATTENTION_LABELS, useI18n } from "@/lib/i18n";
import {
  ATTENTION_LEVELS,
  clampAttentionReason,
  isAttentionLevel,
  type AttentionLevel,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/*
  How much of the reader an item is asking for, as a block rather than a badge.

  Three things carry the level and the colour is only one of them: an icon whose
  SILHOUETTE differs at every level (circle, flag, hourglass, triangle, octagon),
  a word, and a sentence saying what the word means. Read the five in greyscale
  and they still separate — which matters because hue is the channel a
  colour-blind reader does not have, and this is a warning surface.

  The chip carries a fourth, structural channel: the two calm levels are drawn as
  an outline and the three that want something from you are filled. That
  distinction survives greyscale too, and it groups the levels the way the reader
  actually uses them.
*/

const LEVEL_ICON: Record<
  AttentionLevel,
  React.ComponentType<{ className?: string }>
> = {
  informational: Info,
  attention: Flag,
  action_soon: Hourglass,
  urgent: TriangleAlert,
  critical: OctagonAlert,
};

/* The block itself: the level at 6% behind the text, edged in the same colour. */
const LEVEL_BLOCK: Record<AttentionLevel, string> = {
  informational: "border-attention-informational/35 bg-attention-informational/6",
  attention: "border-attention-attention/35 bg-attention-attention/6",
  action_soon: "border-attention-action-soon/35 bg-attention-action-soon/6",
  urgent: "border-attention-urgent/40 bg-attention-urgent/6",
  critical: "border-attention-critical/40 bg-attention-critical/6",
};

/*
  Outline for the two that need nothing from you, filled for the three that do.
  `border-transparent` on the filled ones keeps every chip exactly the same size,
  so the blocks line up in the guide instead of shifting by a pixel each.
*/
const LEVEL_CHIP: Record<AttentionLevel, string> = {
  informational:
    "border-attention-informational/50 text-attention-informational",
  attention: "border-attention-attention/55 text-attention-attention",
  action_soon:
    "border-transparent bg-attention-action-soon text-attention-action-soon-fg",
  urgent: "border-transparent bg-attention-urgent text-attention-urgent-fg",
  critical: "border-transparent bg-attention-critical text-attention-critical-fg",
};

/**
 * One block. Renders NOTHING when the level is absent or unrecognised.
 *
 * That is the whole contract: a row nobody has judged shows no block, never the
 * calmest one. Absence of a judgement is not a judgement that an item is fine,
 * and a level invented at render time would be exactly the fabrication this
 * feature exists to avoid.
 */
export function AttentionBlock({
  level,
  reason,
  className,
}: {
  level: AttentionLevel | null | undefined;
  reason?: string | null;
  className?: string;
}) {
  const { t, lang } = useI18n();

  /*
    A block animates when a judgement ARRIVES on a row that is already on the
    page — never when a card that always had one mounts.

    The difference is the whole point. Eight cards fading in on every load, and
    again on every refetch, would make work the reader dealt with yesterday
    look like it just came in; the animation would be saying something false.
    So the previous level is kept and compared, and it starts at the CURRENT
    level, which is what makes a mount count as "this was already here".

    Setting state during render rather than in an effect is deliberate: React
    re-runs this component before it commits, so the block's first appearance
    on screen already carries the class. From an effect it would paint once at
    full opacity and then jump back to zero to start the fade.
  */
  const [seen, setSeen] = React.useState(level);
  const [arrived, setArrived] = React.useState(false);
  if (level !== seen) {
    setSeen(level);
    setArrived(!isAttentionLevel(seen) && isAttentionLevel(level));
  }

  // The type says this cannot be a stray string. The row it came from went
  // through a blind `as` cast from PostgREST, so it can.
  if (!isAttentionLevel(level)) return null;

  const { label, meaning } = ATTENTION_LABELS[lang][level];
  const Icon = LEVEL_ICON[level];
  const why = clampAttentionReason(reason);

  return (
    <div
      className={cn(
        "squircle flex items-start gap-2.5 border px-3 py-2.5",
        arrived && "animate-appear",
        LEVEL_BLOCK[level],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "squircle grid size-6 shrink-0 place-items-center border",
          LEVEL_CHIP[level],
        )}
      >
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 text-xs leading-relaxed">
        <p>
          {/* So a screen reader hears what the word is, not just the word. */}
          <span className="sr-only">{t.attentionLevel}: </span>
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-muted-foreground"> · {meaning}</span>
        </p>

        {/*
          The reason came out of somebody else's mail, so it renders the way
          ManualView renders everything else that did: text React escapes, no
          markup path, no linkification. `clampAttentionReason` bounds the
          length, and there is deliberately no whitespace-pre-wrap — honouring
          newlines would let a hundred of them stretch the card off the screen,
          which is the same denial of service the length cap closes.
        */}
        {why ? (
          <p className="mt-0.5 break-words text-muted-foreground">{why}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What the five levels mean, always all five, never only the ones on screen.
 *
 * Reference material, not a control: nothing in here is clickable, nothing
 * filters the queue, and the blocks are the same component the cards use — so
 * the guide and a card cannot drift into describing the same level differently.
 *
 * On a laptop it is the right-hand column of the queue section, so it costs the
 * queue no vertical space at all. Below `lg` the grid collapses and it lands
 * underneath the queue, collapsed to its heading, because reference material
 * that pushes the actual work off a phone screen is worse than no reference
 * material.
 */
export function AttentionGuide() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);

  return (
    <aside
      aria-labelledby="attention-guide-heading"
      className="paper rounded-lg p-4"
    >
      <div className="flex items-center gap-2">
        <h2
          id="attention-guide-heading"
          className="font-heading text-sm uppercase tracking-wider text-muted-foreground"
        >
          {t.attentionGuide}
        </h2>
        {/*
          Hidden entirely at lg, where the panel is always open — so the control
          cannot claim on a laptop to collapse something that will not collapse.
        */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="attention-guide-body"
          aria-label={t.attentionGuide}
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          {/* Turns rather than flips, so the arrow reads as belonging to the
              panel it is opening — same treatment as the queue's own chevron. */}
          <ChevronDown
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      <div
        id="attention-guide-body"
        className={cn("mt-3 space-y-2", !open && "hidden lg:block")}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.attentionGuideHint}
        </p>
        {ATTENTION_LEVELS.map((level) => (
          <AttentionBlock key={level} level={level} />
        ))}
        {/*
          The panel has to say this. Four of the five levels are visibly worse
          than the one above, which makes a card with no block read as the level
          below the calmest — and there is no such level. It has not been judged.
        */}
        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
          {t.attentionNoneNote}
        </p>
      </div>
    </aside>
  );
}
