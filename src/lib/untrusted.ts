/*
  Defences for strings a stranger wrote.

  React escapes `<`, `>`, `&` and quotes, which closes markup injection and is
  why `queue.tsx` can print a draft body straight into JSX. It does nothing at
  all about U+202E RIGHT-TO-LEFT OVERRIDE, because those bytes are innocent —
  the glyph ORDER is the payload. A filename spelled `INV-4471<RLO>fdp.exe`
  renders on the card as `INV-4471exe.pdf`, and the reader then decides about an
  executable he was shown as a PDF.

  So this file exists for the one class of attack escaping cannot reach, and it
  is applied at RENDER rather than only at write: rows already in the database
  predate it, and the box that writes them is a separate program this repo never
  compiles against.
*/

/**
 * Written as explicit escapes on purpose. A character class of literal
 * invisibles cannot be reviewed in a diff, does not survive a copy-paste, and
 * this is the one regex here that has to be provably right.
 *
 *   202A-202E  LRE RLE PDF LRO RLO   the classic report-<RLO>fdp.exe attack
 *   2066-2069  LRI RLI FSI PDI       the newer isolate family
 *   200E 200F  LRM RLM               directional marks
 *   061C       ALM                   Arabic letter mark
 *   200B-200D  ZWSP ZWNJ ZWJ         invisible splitters
 *   FEFF       BOM / ZWNBSP
 *   0000-001F, 007F                  C0 controls and DEL
 */
const UNSAFE_DISPLAY_CHARS =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\uFEFF\u0000-\u001F\u007F]/gu;

/**
 * Strip the invisibles, collapse the whitespace their removal leaves behind,
 * and clamp.
 *
 * `max` is a layout defence as much as a legibility one: a 4,000-character
 * filename at 375px pushes Confirm, Modify and Reject off the card, which is a
 * denial of service delivered by attachment.
 *
 * The clamp puts the ellipsis in the MIDDLE so the true extension survives it,
 * which is the entire reason a filename is shown to someone deciding whether to
 * trust a file. A tail clamp would hide the one part that decides it.
 *
 * Anything that is not a string returns "", so a caller can treat empty as
 * "render nothing" without a second null check — jsonb reaches here holding
 * numbers, arrays and nulls under keys whose names promise otherwise.
 */
export function sanitizeDisplay(raw: unknown, max = 100): string {
  if (typeof raw !== "string") return "";
  const clean = raw.replace(UNSAFE_DISPLAY_CHARS, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max - 12);
  const tail = clean.slice(-9);
  return `${head}…${tail}`;
}
