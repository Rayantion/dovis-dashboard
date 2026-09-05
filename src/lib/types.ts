/*
  These types mirror supabase/schema.sql exactly. If you change one, change both —
  the CHECK constraints in the database are the real enforcement, and a type that
  drifts from them will let you write code the database then rejects at runtime.
*/

// Type-only, so it is erased at compile time and this module stays free of any
// runtime import — `i18n.ts` is a client module and this file is read by server
// routes too. One definition of the pair, matching one CHECK constraint.
import type { Lang } from "@/lib/i18n";

/** The queue lifecycle. `executing` is a claim the executor sets BEFORE acting. */
export type TodoStatus =
  | "proposed"
  | "modifying"
  | "confirmed"
  | "executing"
  | "done"
  | "rejected"
  | "failed";

/**
 * What Dovis is permitted to actually do.
 *
 * There is no `send_email` and there must never be one: `gmail_reply` is excluded
 * from the agent's tool allowlist and GMAIL_ALLOW_SENDING is unset, so no tool on
 * the box can send mail. `draft_email` means a draft lands in Gmail and the
 * principal presses send.
 */
export type ActionType = "draft_email" | "manual";

/** Widgets are rows in the database, never generated code. */
export type WidgetType = "metric" | "chart" | "list" | "checklist" | "approval";

export type Role = "owner" | "admin";

export type AccountStatus = "active" | "paused";

/**
 * How much of the principal's attention an item is asking for.
 *
 * A closed set, ours, matching the CHECK on `todos.attention`. The words a boss
 * reads come from ATTENTION_LABELS in i18n.ts and are looked up by key, so a
 * sender cannot author their own headline — the same containment the flag
 * vocabulary in EMAIL-INTELLIGENCE-DESIGN.md relies on.
 *
 * Adding a sixth level means: the CHECK in schema.sql, this union, and
 * ATTENTION_LABELS in BOTH languages. Miss any and the build or the insert
 * fails, which is the intended failure.
 *
 * This is NOT `priority`. Priority answers "what order do I work through the
 * queue in"; this answers "how much is at stake here". The two disagree
 * constantly — a low-priority note about a lapsing insurance policy is
 * critical — and deriving one from the other would file judgements nothing made.
 */
export type AttentionLevel =
  | "informational"
  | "attention"
  | "action_soon"
  | "urgent"
  | "critical";

/** Calmest first. Display order in the guide, and nothing else depends on it. */
export const ATTENTION_LEVELS: AttentionLevel[] = [
  "informational",
  "attention",
  "action_soon",
  "urgent",
  "critical",
];

/**
 * Default-deny, because rows arrive from PostgREST untyped and through a blind
 * `as` cast.
 *
 * Three things land here and all three must render as no block: null from a row
 * nothing has judged, undefined from a database where this file has not been
 * re-run, and a string outside the union. An unrecognised level has no
 * dictionary entry and would otherwise paint a coloured block with no name — a
 * warning that cannot say what it is warning about.
 */
export function isAttentionLevel(value: unknown): value is AttentionLevel {
  return (
    typeof value === "string" &&
    (ATTENTION_LEVELS as string[]).includes(value)
  );
}

/**
 * The reason is written by an analyser reading somebody else's mail, so it is
 * untrusted on the way in and bounded on the way out — the `MAX_KEY_CHARS`
 * argument in queue.tsx, applied to a field that is prose rather than a key.
 *
 * The clamp is a layout defence: a 4,000-character reason on a 375px screen
 * pushes Confirm, Modify and Reject off the card, which is a denial of service
 * delivered by email. Escaping is React's job and the render path adds no
 * markup, no linkification and no HTML.
 */
const MAX_REASON_CHARS = 180;

export function clampAttentionReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  return text.length <= MAX_REASON_CHARS
    ? text
    : `${text.slice(0, MAX_REASON_CHARS)}…`;
}

export interface Todo {
  id: string;
  title: string;
  action_type: ActionType;
  status: TodoStatus;
  priority: "low" | "normal" | "high";
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  /**
   * Null when nothing has judged this item — an older row, or one the box chose
   * not to rate. It renders as no block, never as the calmest level: absence of
   * a judgement is not a judgement that everything is fine.
   */
  attention: AttentionLevel | null;
  /** Optional even when a level is present. Untrusted; see clampAttentionReason. */
  attention_reason: string | null;
}

/**
 * Never reaches the browser through Supabase. `todo_payloads` has RLS on and no
 * anon policy, and is deliberately absent from the realtime publication. The only
 * way this arrives client-side is the server route, after a session check.
 */
export interface TodoPayload {
  todo_id: string;
  payload_proposed: DraftEmailPayload | ManualPayload;
  payload_current: DraftEmailPayload | ManualPayload;
  modify_note: string | null;
  reject_reason: string | null;
}

export interface DraftEmailPayload {
  to: string;
  subject: string;
  body: string;
}

/**
 * A manual item, as the box actually writes it.
 *
 * Every field is optional and unknown keys are representable on purpose. This
 * shape is produced on the box by an agent this repo never compiles against,
 * stored in a `jsonb` column Postgres enforces no shape on, and read back through
 * a blind `as` cast. That is three places a drift can hide, and it did: this
 * interface said `{ detail: string }` while a real row carried seven keys and no
 * `detail` at all, so the panel rendered empty and nothing — not the database, not
 * the compiler — was in a position to complain.
 *
 * So the rule here is describe, never require. A renderer that trusts this list to
 * be complete reproduces the same bug the day the box writes an eighth key, which
 * is why `queue.tsx` also renders whatever it finds that is not named below.
 */
export interface ManualPayload {
  /** The primary content: what the principal is being asked to actually do. */
  task?: string;
  /** Legacy. Older rows carry the whole item in this one string. Never assume it. */
  detail?: string;
  from?: string;
  subject?: string;
  event?: string;
  deadline?: string;
  location?: string;
  /** A Gmail message id. A reference to show, not a link — nothing can open it. */
  email_id?: string;
  /**
   * Factual observations about the message this item came out of: which flag
   * codes the box recorded, the attachment metadata, and the links.
   *
   * They live HERE, in the payload jsonb, and not on `todos`. `todos` is
   * `replica identity full` and is in the realtime publication, so every column
   * on it is broadcast in full to every subscribed browser — including a
   * read-only assistant's. This row reaches the browser only through
   * /api/payload/[id], behind `permissionsFor().canModify`, which is the gate
   * the draft bodies already ride. No migration is needed for any of this: the
   * column is jsonb and this interface has an index signature.
   *
   * All three are typed `unknown` rather than as arrays, deliberately. The value
   * crosses jsonb, a box this repo never compiles against, and a blind `as`
   * cast, so an array type here would be a claim this file cannot back — the
   * exact drift `detail: string` already caused once. Narrow them with
   * parseFlagCodes / parseAttachments / parseLinks below, which default-deny.
   */
  email_flags?: unknown;
  attachments?: unknown;
  links?: unknown;
  /** jsonb holds anything, so a value is `unknown` until the renderer narrows it. */
  [key: string]: unknown;
}

/* ========================================================================== */
/*  Email facts — what the message CONTAINED, never what it means             */
/* ========================================================================== */

/**
 * The closed vocabulary, and every code in it is a FACT.
 *
 * Each one is established by reading a header or walking the MIME tree. None is
 * a model's reading of prose a stranger wrote: there is no `possible_phishing`
 * here, no `suspicious_sender`, and nothing that scores or clears a message.
 * `EMAIL-INTELLIGENCE-DESIGN.md` specifies sixteen codes across two tiers; this
 * build ships only the observed tier, so the whole inferred apparatus — hedged
 * wording, the coloured chip, the evidence disclosure — is deliberately absent
 * rather than half-present.
 *
 * Two departures from that document's vocabulary, both because the deployment
 * owner's own list calls these FACTUAL and the document's versions are not:
 *
 *   `sender_domain_mismatch` there means "the body signs off as Acme but the
 *   mail came from gmail.com", whose only evidence is the attacker's own prose.
 *   Here it means the Reply-To domain differs from the From domain, which is
 *   two header fields and a string comparison.
 *
 *   `external_sender` is new. The document has no code for it; the owner asked
 *   for an external-sender indicator, and it is a header fact.
 *
 * Closed, not free text. The words a reader sees come from FLAG_LABELS in
 * i18n.ts, looked up by code, so a sender who influences the box still cannot
 * author their own headline on the boss's dashboard. Adding a code means: this
 * union, FLAG_BASIS below, and FLAG_LABELS in BOTH languages. Miss one and the
 * build fails, which is the intended failure.
 *
 * Order here is display order.
 */
export type EmailFlagCode =
  | "attachment_received"
  | "pdf_attachment"
  | "image_attachment"
  | "external_links"
  | "external_sender"
  | "free_mailbox_sender"
  | "sender_domain_mismatch";

/**
 * Which mechanical source established the fact. `mime` walked the message
 * structure, `header` read a header field.
 *
 * There is no `model` member, and that absence is load-bearing: it makes an
 * inferred flag unrepresentable rather than merely unused, so nobody can add
 * one without also deciding how it is worded and drawn. `Record<EmailFlagCode,
 * FlagBasis>` below makes a missing entry a compile error.
 */
export type FlagBasis = "header" | "mime";

export const FLAG_BASIS: Record<EmailFlagCode, FlagBasis> = {
  attachment_received: "mime",
  pdf_attachment: "mime",
  image_attachment: "mime",
  external_links: "mime",
  external_sender: "header",
  free_mailbox_sender: "header",
  sender_domain_mismatch: "header",
};

/** Declaration order of FLAG_BASIS, which is display order. */
export const EMAIL_FLAG_CODES = Object.keys(FLAG_BASIS) as EmailFlagCode[];

export function isEmailFlagCode(value: unknown): value is EmailFlagCode {
  return typeof value === "string" && value in FLAG_BASIS;
}

/**
 * Split an untrusted list into the codes this build can name and the ones it
 * cannot.
 *
 * The split is the containment. A code with no dictionary entry has no label
 * and no meaning, so rendering it as a flag would paint a chip with no words —
 * a warning that cannot say what it is warning about — or worse, print a string
 * a sender influenced into the row where a warning belongs. So it renders
 * nothing as a flag. It is returned separately rather than dropped because it
 * is still data that arrived, and `ManualView` surfaces it in the unknown-key
 * sweep, which is where anything nobody has a label for belongs.
 *
 * Duplicates collapse and the result is in FLAG_BASIS order, so the reader's
 * eye lands in an order this repo chose rather than one the sender did.
 */
export function parseFlagCodes(raw: unknown): {
  known: EmailFlagCode[];
  unknown: string[];
} {
  if (!Array.isArray(raw)) return { known: [], unknown: [] };
  const seen = new Set<string>();
  const known = new Set<EmailFlagCode>();
  const unknown: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || seen.has(entry)) continue;
    seen.add(entry);
    if (isEmailFlagCode(entry)) known.add(entry);
    else unknown.push(entry);
  }
  return { known: EMAIL_FLAG_CODES.filter((c) => known.has(c)), unknown };
}

/* ------------------------------------------------------------ attachments */

/** What the box measured from the leading bytes — never from the filename. */
export type AttachmentKind = "pdf" | "image" | "other";

/**
 * An attachment as this build can honestly describe it: a name, a declared
 * type, a size, and whether the record itself is broken.
 *
 * Note what is absent and must stay absent: no URL, no Gmail id, no path, no
 * bytes. `/api/google/*` is connect, callback and status — there is no route on
 * this app that fetches a message or an attachment — so there is nothing to
 * open and the card says so in words instead of offering a control that does
 * nothing.
 */
export interface EmailAttachment {
  /** SENDER-CHOSEN, therefore hostile: double extensions, bidi overrides, 4KB
   *  of padding. Stored verbatim, sanitized at render by sanitizeDisplay(). */
  filename: string;
  /** What the message part DECLARED. Untrusted, shown so a disagreement with
   *  the name is inspectable, and never used to choose a renderer or an icon. */
  mimeType: string;
  sizeBytes: number | null;
  /** From the box's own classification. Absent or unrecognised lands on
   *  `other`, so a .exe calling itself invoice.pdf is a generic file. */
  kind: AttachmentKind;
  /** The box saw a part and could not record it. Shown, never hidden: an
   *  attachment that failed is information about what the message contained. */
  unavailable: boolean;
}

const ATTACHMENT_KINDS = new Set<string>(["pdf", "image", "other"]);

/**
 * `max` bounds a layout attack, not a data one. A message carrying 500 parts
 * would push Confirm, Modify and Reject off the bottom of a 375px card, which
 * is the same denial of service `clampAttentionReason` closes for one long
 * string. The count of what was dropped is reported to the reader rather than
 * swallowed — see `moreNotShown` in i18n.ts.
 */
export const MAX_RENDERED_ROWS = 20;

export function parseAttachments(raw: unknown): EmailAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailAttachment[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const size = row.size_bytes;
    const kind = row.kind;
    out.push({
      filename: typeof row.filename === "string" ? row.filename : "",
      mimeType: typeof row.mime_type === "string" ? row.mime_type : "",
      sizeBytes:
        typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null,
      kind:
        typeof kind === "string" && ATTACHMENT_KINDS.has(kind)
          ? (kind as AttachmentKind)
          : "other",
      unavailable: row.unavailable === true,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ links */

export interface EmailLink {
  /** The most attacker-controlled string in the payload. Safe as text; an href
   *  only after checkLink() and only after the reader asks. */
  url: string;
  /** The sender-chosen anchor text. NEVER shown without the parsed host above
   *  it — a title is how a link lies about where it goes. */
  title: string;
}

export function parseLinks(raw: unknown): EmailLink[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailLink[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.url !== "string" || row.url.trim().length === 0) continue;
    out.push({
      url: row.url,
      title: typeof row.title === "string" ? row.title : "",
    });
  }
  return out;
}

/** Why a link may not become an anchor. Each has its own sentence in i18n.ts. */
export type LinkRejection = "scheme" | "userinfo" | "idn" | "unparseable";

export type LinkCheck =
  | { ok: true; href: string; host: string }
  | { ok: false; host: string | null; reason: LinkRejection };

const OPENABLE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * The gate between "a string an email contained" and "an address this app is
 * willing to put in an href". It is a NECESSARY condition, never a sufficient
 * one: passing means only that the address is well formed and unambiguous about
 * where it goes, and the reader still has to press a second control before an
 * anchor exists at all.
 *
 * The href returned is the PARSER'S OWN output, so what was validated is what
 * would be navigated to. Returning the raw string would leave room for the two
 * to disagree, which is the whole trick.
 *
 * What it refuses, and why each one:
 *
 *   scheme — anything but http and https. React 19.2.8 rewrites `javascript:`
 *   hrefs in production but does nothing to `data:text/html`, `vbscript:`,
 *   `blob:` or `file:`, so this allowlist is load-bearing for every scheme
 *   React does not touch. The deployment owner's spec allows http as well as
 *   https; EMAIL-INTELLIGENCE-DESIGN.md argues for https alone on the grounds
 *   that a boss following unencrypted HTTP out of a suspicious mail is the
 *   phishing path itself. Tightening this to https is one line, here.
 *
 *   userinfo — `https://accounts.google.com@evil.tld/reset` lands on evil.tld.
 *   Everything before the @ is a username, and this is the one case where
 *   showing a hostname would actively help the phish.
 *
 *   idn — a host whose punycode form is present is an internationalised name,
 *   and its readable form can be built to imitate another domain glyph for
 *   glyph. It is refused rather than merely flagged, and the punycode is what
 *   the card displays: `xn--pypal-4ve.example` is ugly, and it is exactly the
 *   right ugly. Never prettify it back to Unicode.
 */
export function checkLink(url: string): LinkCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, host: null, reason: "unparseable" };
  }
  // Read the host once, before any refusal: a rejected link still shows where
  // it goes, because that is the entire reason for showing it at all.
  const host = parsed.hostname || null;
  if (!OPENABLE_PROTOCOLS.has(parsed.protocol))
    return { ok: false, host, reason: "scheme" };
  if (parsed.username || parsed.password)
    return { ok: false, host, reason: "userinfo" };
  // URL.hostname normalises IDN to punycode in both Node and the browser, so
  // this catches the Unicode spelling and the already-encoded one alike.
  if (!host || host.split(".").some((part) => part.startsWith("xn--")))
    return { ok: false, host, reason: "idn" };
  return { ok: true, href: parsed.toString(), host };
}

export interface DashboardWidget {
  id: string;
  widget_type: WidgetType;
  title: string;
  config: WidgetConfig;
  position: number;
}

export type WidgetConfig =
  | { kind: "metric"; value: string; caption?: string; delta?: string }
  | { kind: "chart"; series: { label: string; value: number }[]; unit?: string }
  | { kind: "list"; items: { label: string; meta?: string }[] }
  | { kind: "checklist"; items: { label: string; done: boolean }[] }
  | { kind: "approval"; note: string };

export interface Profile {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  role: Role;
  status: AccountStatus;
  /**
   * Owner-granted. Lets an admin confirm, modify and reject queue items.
   * Never grants deletion — that is owner-only in every code path and in RLS.
   */
  can_modify: boolean;
  must_change_password: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  /**
   * The language this account reads in, or null when it has never been set.
   *
   * Null is not a default of English — it means nobody has said, so the browser
   * seeds it once from its own toggle. After that this is authoritative, which
   * is what lets the choice follow a person to a second device and what gives
   * the server a language it can act on rather than one it has to be told.
   */
  lang: Lang | null;
}

/** What the UI is allowed to render for the current session. */
export interface Permissions {
  canModify: boolean;
  canDelete: boolean;
  canManageTeam: boolean;
}

export function permissionsFor(profile: Pick<Profile, "role" | "can_modify">): Permissions {
  const isOwner = profile.role === "owner";
  return {
    // The owner always decides. An admin decides only if the owner ticked the box.
    canModify: isOwner || profile.can_modify,
    // Deletion is owner-only, unconditionally. `can_modify` never widens this.
    canDelete: isOwner,
    canManageTeam: isOwner,
  };
}
