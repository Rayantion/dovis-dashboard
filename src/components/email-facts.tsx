"use client";

import * as React from "react";
import { ExternalLink, File, FileText, FileX, Image as ImageIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FLAG_LABELS, useI18n } from "@/lib/i18n";
import {
  checkLink,
  MAX_RENDERED_ROWS,
  type AttachmentKind,
  type EmailAttachment,
  type EmailFlagCode,
  type EmailLink,
} from "@/lib/types";
import { sanitizeDisplay } from "@/lib/untrusted";
import { cn, formatBytes } from "@/lib/utils";

/*
  What the message CONTAINED — rendered by ManualView, and only by ManualView.

  This is the factual register, and its whole job is to not look like the other
  one. `AttentionBlock` is the judgement surface: a tinted block, a coloured
  glyph in a chip, a level and a sentence saying how much of you an item is
  asking for. Nothing here has a tint, a level or a colour. A fact is quieter
  than a judgement because it is a smaller claim, and if a filename could dress
  itself as a warning then a sender would get to set the alarm.

  So: no destructive red, no amber, no status token, no icon on a flag chip, and
  no animation. Read this section in greyscale beside an attention block and the
  two are still obviously different kinds of thing — one is bordered and tinted
  and sits above the panel, this one is a hairline rule and muted type inside it.

  What it also never does is report an absence. There is no "nothing found",
  no tick and no green: this build has no analysis-state field, so it cannot
  tell "checked and found nothing" apart from "never checked", and inventing a
  reassuring sentence across that gap is the one mistake this feature exists to
  not make. Nothing to show means nothing renders.
*/

/** Shape-distinct, so the kinds separate without colour — the attention.tsx
 *  rule applied to a colourless surface. */
const KIND_ICON: Record<AttachmentKind, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  image: ImageIcon,
  other: File,
};

export function EmailFacts({
  flags,
  attachments,
  links,
  className,
}: {
  flags: EmailFlagCode[];
  attachments: EmailAttachment[];
  links: EmailLink[];
  className?: string;
}) {
  const { t, lang } = useI18n();
  const headingId = React.useId();

  if (flags.length === 0 && attachments.length === 0 && links.length === 0) return null;

  const shownAttachments = attachments.slice(0, MAX_RENDERED_ROWS);
  const shownLinks = links.slice(0, MAX_RENDERED_ROWS);

  return (
    /*
      A plain section, not role="alert" and not role="status". Both interrupt
      the reader, and interrupting IS a claim of urgency — which is precisely
      the claim this section is not entitled to make. These facts also arrive
      with the row and never change under the reader, so they are not a live
      region either.
    */
    <section
      aria-labelledby={headingId}
      className={cn("border-t border-border pt-2.5", className)}
    >
      <h4
        id={headingId}
        className="text-[11px] uppercase tracking-wider text-muted-foreground"
      >
        {t.emailFacts.heading}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {t.emailFacts.disclaimer}
      </p>

      {flags.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {flags.map((code) => (
            <li
              key={code}
              className="inline-flex items-center rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium leading-tight text-muted-foreground"
            >
              {/* Looked up by code. Never a string from the row. */}
              {FLAG_LABELS[lang][code]}
            </li>
          ))}
        </ul>
      ) : null}

      {shownAttachments.length > 0 ? (
        <div className="mt-3">
          <h5 className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t.emailFacts.attachments}
          </h5>
          <ul className="mt-1.5 space-y-2">
            {shownAttachments.map((attachment, i) => (
              <AttachmentRow key={i} attachment={attachment} />
            ))}
          </ul>
          <Truncated shown={shownAttachments.length} total={attachments.length} />
        </div>
      ) : null}

      {shownLinks.length > 0 ? (
        <div className="mt-3">
          <h5 className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t.emailFacts.links}
          </h5>
          {/*
            Stated once, above the list, rather than repeated on every row: it
            is a property of the whole surface, and a sentence a reader meets
            five times is a sentence they stop reading.
          */}
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t.emailFacts.linkNeverAuto}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {shownLinks.map((link, i) => (
              <LinkRow key={i} link={link} />
            ))}
          </ul>
          <Truncated shown={shownLinks.length} total={links.length} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * What a cap dropped, said out loud.
 *
 * The cap is a layout defence, but a silent one would rewrite what the message
 * contained — which is the same failure as hiding an attachment that could not
 * be fetched.
 */
function Truncated({ shown, total }: { shown: number; total: number }) {
  const { t } = useI18n();
  if (total <= shown) return null;
  return (
    <p className="mt-1.5 text-[11px] text-muted-foreground">
      {t.emailFacts.moreNotShown.replace("{n}", String(total - shown))}
    </p>
  );
}

/**
 * One attachment: what it is called, what it claims to be, how big it is, and
 * the plain statement that it cannot be opened.
 *
 * There is no disabled button here, and that is deliberate. A greyed control
 * with no explanation reads as a bug in Dovis, and a control that opens nothing
 * is the theatre `docs/ADDING-FEATURES.md` forbids. `/api/google/*` is connect,
 * callback and status — nothing on this app fetches a message or an attachment
 * — so the row says so in words instead, in both languages, and the buttons
 * arrive with the route that makes them true.
 */
function AttachmentRow({ attachment }: { attachment: EmailAttachment }) {
  const { t } = useI18n();

  const name = sanitizeDisplay(attachment.filename);
  // The DECLARED type, shown as text beside the name so a disagreement between
  // the two is inspectable. It never picks the icon: `kind` comes from what the
  // box measured, so a .exe calling itself invoice.pdf stays a generic file.
  const mime = sanitizeDisplay(attachment.mimeType, 60);
  const size = formatBytes(attachment.sizeBytes);
  const Icon = attachment.unavailable ? FileX : KIND_ICON[attachment.kind];

  return (
    <li className={cn("flex items-start gap-2.5", attachment.unavailable && "opacity-60")}>
      {/*
        The 40px tile is the shape a thumbnail will occupy, held at a fixed size
        so rows do not jitter when previews eventually resolve. It stays empty
        today because there are no bytes to draw: the only honest fill is a
        same-origin, re-encoded preview served by an authenticated route this
        app does not have. It must NEVER become an <img> pointed at a URL from
        the mail — that is a tracking pixel firing the moment the card opens,
        and a server-side version of it is SSRF.

        aria-hidden throughout: the filename sits beside it as real text, and an
        alt derived from an attacker-chosen filename would read the same hostile
        string twice, to the one reader who has none of the visual defences.
      */}
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground"
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        {/*
          dir="ltr" on every element holding a sanitized string. sanitizeDisplay
          strips the bidi overrides; this contains anything that survives it to
          its own element, so it cannot reorder the metadata beside it.
        */}
        <p dir="ltr" className="break-all text-xs text-foreground">
          {name || t.emailFacts.attachmentUnnamed}
        </p>

        {mime || size ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {mime ? (
              <span dir="ltr" className="font-mono break-all">
                {mime}
              </span>
            ) : null}
            {mime && size ? " · " : null}
            {size}
          </p>
        ) : null}

        <p className="mt-0.5 text-[11px] italic leading-relaxed text-muted-foreground">
          {attachment.unavailable
            ? t.emailFacts.attachmentUnavailable
            : attachment.kind === "image"
              ? `${t.emailFacts.attachmentNoPreview} · ${t.emailFacts.attachmentCannotOpen}`
              : t.emailFacts.attachmentCannotOpen}
        </p>
      </div>
    </li>
  );
}

/**
 * One link, headed by where it actually goes.
 *
 * The hostname is the headline and the sender's own link text is a subtitle
 * beneath it, never shown alone. That ordering is the entire defence: the title
 * is whatever the sender typed, so `Your DocuSign document` over
 * `pay.evil.example` is not an edge case, it is the attack, and the hostname is
 * the only string on screen that determines where a tap would land. It comes
 * from `new URL().hostname`, never from a substring of the raw address.
 *
 * Nothing is clickable on arrival. A validated address still renders as text
 * until the reader presses a button, and only then does an anchor exist in the
 * DOM. A rejected one never becomes an anchor at all — not a disabled one,
 * because a disabled anchor still carries an href that is middle-clickable,
 * copyable from the context menu and visible in the status bar, which is three
 * routes to a place this card has just said it would not send anyone.
 */
function LinkRow({ link }: { link: EmailLink }) {
  const { t } = useI18n();
  const [armed, setArmed] = React.useState(false);

  const check = React.useMemo(() => checkLink(link.url), [link.url]);
  const host = sanitizeDisplay(check.host, 80);
  const title = sanitizeDisplay(link.title, 80);
  // Longer than a filename on purpose: the address is the thing the reader is
  // being asked to inspect, and a clamp in the middle of a path can hide the
  // part that gives it away.
  const address = sanitizeDisplay(link.url, 300);

  const rejection: Record<string, string> = {
    scheme: t.emailFacts.linkRejectedScheme,
    userinfo: t.emailFacts.linkRejectedUserinfo,
    idn: t.emailFacts.linkRejectedIdn,
    unparseable: t.emailFacts.linkRejectedUnparseable,
  };

  return (
    <li className="rounded-md border border-border bg-card px-2.5 py-2">
      {/*
        <details>, the idiom queue.tsx already uses for "Original proposal":
        zero JS, keyboard operation and the expanded state announced for free.
        It also keeps the row one line tall at 375px, with the full address one
        tap away rather than wrapped across four lines of every card.
      */}
      <details>
        <summary className="cursor-pointer list-none">
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span
                dir="ltr"
                className="block break-all font-mono text-xs text-foreground"
              >
                {host || t.emailFacts.linkHostUnreadable}
              </span>
              {title ? (
                <span
                  dir="ltr"
                  className="mt-0.5 block break-words text-[11px] text-muted-foreground"
                >
                  {t.emailFacts.linkText}: {title}
                </span>
              ) : null}
            </span>
            {/*
              Every address here came out of a third party's message and leaves
              this app, which is what external means on this surface. There is
              no configured own-domain to compare against, so nothing here
              pretends to tell an internal link from an external one.
            */}
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium leading-tight text-muted-foreground">
              <ExternalLink className="size-3" aria-hidden />
              {t.emailFacts.linkExternal}
            </span>
          </span>
        </summary>

        <div className="mt-2 ml-2 border-l-2 border-border pl-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t.emailFacts.linkFullAddress}
          </p>
          {/*
            select-all so one tap copies the whole address into a checker,
            rather than dragging a selection across a wrapped string on a phone.
          */}
          <p
            dir="ltr"
            className="mt-0.5 select-all break-all font-mono text-[11px] text-muted-foreground"
          >
            {address}
          </p>

          {check.ok ? (
            armed ? (
              /*
                A plain <a>, never next/link, so nothing prefetches this address
                the moment it renders. noopener closes reverse tabnabbing, where
                the opened page rewrites this tab into a fake sign-in; noreferrer
                stops the dashboard's own URL reaching the destination's server;
                nofollow because this is content a stranger supplied.
              */
              <a
                href={check.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 h-8")}
              >
                {t.emailFacts.linkOpen}
                {/* In the anchor rather than a title attribute, which is
                    unreachable on touch and announced inconsistently. */}
                <span className="sr-only"> — {t.emailFacts.linkNewTab}</span>
              </a>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-8"
                onClick={() => setArmed(true)}
              >
                {t.emailFacts.linkArm}
              </Button>
            )
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {rejection[check.reason]}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
