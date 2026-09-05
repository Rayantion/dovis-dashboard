import { describe, expect, it } from "vitest";
import { FLAG_LABELS, languages } from "@/lib/i18n";
import {
  checkLink,
  EMAIL_FLAG_CODES,
  FLAG_BASIS,
  isEmailFlagCode,
  parseAttachments,
  parseFlagCodes,
  parseLinks,
} from "@/lib/types";
import { sanitizeDisplay } from "@/lib/untrusted";
import { formatBytes } from "@/lib/utils";
import { demoPayloads } from "@/lib/demo-data";

/*
  Everything under test here is a decision made about a string a stranger wrote,
  before any of it reaches the DOM. Rendering is not asserted — the environment
  is node — but the four things that actually protect the reader are pure and
  are all here: the closed flag vocabulary, the bidi strip, the link validator,
  and the default-deny in each parser.
*/

describe("flag vocabulary is closed", () => {
  it("recognises exactly the seven factual codes", () => {
    expect(EMAIL_FLAG_CODES).toHaveLength(7);
    for (const code of EMAIL_FLAG_CODES) expect(isEmailFlagCode(code)).toBe(true);
  });

  it("carries no inferred basis — this build ships facts only", () => {
    // A `model` basis would mean a code whose evidence is a stranger's prose,
    // and none of the hedged wording or coloured treatment that needs exists.
    expect(Object.values(FLAG_BASIS).every((b) => b === "header" || b === "mime")).toBe(true);
  });

  it("has a label in both languages for every code", () => {
    for (const lang of Object.keys(languages) as (keyof typeof FLAG_LABELS)[])
      for (const code of EMAIL_FLAG_CODES)
        expect(FLAG_LABELS[lang][code]).toBeTruthy();
  });

  it("never labels a fact as a verdict", () => {
    // The words this surface is forbidden to say, in either direction: no
    // accusation the box cannot support, and no clearance at all.
    const banned = /scam|phish|suspicious|malicious|danger|safe|secure|verified|clean|trusted/i;
    for (const lang of ["en", "zh-TW"] as const)
      for (const code of EMAIL_FLAG_CODES)
        expect(FLAG_LABELS[lang][code]).not.toMatch(banned);
  });
});

describe("parseFlagCodes", () => {
  it("keeps known codes and separates the ones this build cannot name", () => {
    const out = parseFlagCodes(["pdf_attachment", "possible_phishing", "external_sender"]);
    expect(out.known).toEqual(["pdf_attachment", "external_sender"]);
    expect(out.unknown).toEqual(["possible_phishing"]);
  });

  it("orders known codes by FLAG_BASIS declaration, not by the sender's order", () => {
    const out = parseFlagCodes(["sender_domain_mismatch", "attachment_received"]);
    expect(out.known).toEqual(["attachment_received", "sender_domain_mismatch"]);
  });

  it("default-denies anything that is not an array of strings", () => {
    for (const bad of [null, undefined, "pdf_attachment", 7, {}, [1, null, {}]])
      expect(parseFlagCodes(bad)).toEqual({ known: [], unknown: [] });
  });

  it("collapses duplicates", () => {
    expect(parseFlagCodes(["pdf_attachment", "pdf_attachment"]).known).toHaveLength(1);
  });
});

describe("sanitizeDisplay", () => {
  it("strips the right-to-left override that makes an .exe read as a .pdf", () => {
    const rlo = String.fromCharCode(0x202e);
    const hostile = `INV-4471-remittance${rlo}fdp.exe`;
    const shown = sanitizeDisplay(hostile);
    expect(shown).toBe("INV-4471-remittancefdp.exe");
    expect(shown).not.toContain(rlo);
    expect(shown.endsWith(".exe")).toBe(true);
  });

  it("strips the isolate family, the zero-width splitters and C0 controls", () => {
    const codes = [0x202a, 0x2066, 0x2069, 0x200b, 0x200d, 0xfeff, 0x061c, 0x007f, 0x0001];
    const raw = `a${codes.map((c) => String.fromCharCode(c)).join("")}b`;
    expect(sanitizeDisplay(raw)).toBe("ab");
  });

  it("clamps in the middle so the extension survives", () => {
    const long = `${"a".repeat(400)}.exe`;
    const shown = sanitizeDisplay(long);
    expect(shown.length).toBeLessThanOrEqual(100);
    expect(shown).toContain("…");
    expect(shown.endsWith(".exe")).toBe(true);
  });

  it("returns empty for anything that is not a string", () => {
    for (const bad of [null, undefined, 7, {}, []]) expect(sanitizeDisplay(bad)).toBe("");
  });
});

describe("checkLink", () => {
  it("accepts http and https and returns the parser's own href", () => {
    const https = checkLink("https://example.com/a?b=1");
    expect(https).toEqual({ ok: true, href: "https://example.com/a?b=1", host: "example.com" });
    expect(checkLink("http://example.com/").ok).toBe(true);
  });

  it("refuses every scheme that is not http or https", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/abc",
    ]) {
      const out = checkLink(url);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe("scheme");
    }
  });

  it("refuses userinfo, where the readable half is not the destination", () => {
    const out = checkLink("https://accounts.example.com@pay-verify.example/reset");
    expect(out.ok).toBe(false);
    // And it still reports the REAL host, because a link nobody can inspect is
    // worse than a link nobody can click.
    if (!out.ok) {
      expect(out.reason).toBe("userinfo");
      expect(out.host).toBe("pay-verify.example");
    }
  });

  it("refuses an internationalised host and never prettifies the punycode", () => {
    for (const url of ["https://xn--pypal-4ve.example/x", "https://pаypal.example/x"]) {
      const out = checkLink(url);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.reason).toBe("idn");
        expect(out.host).toContain("xn--");
      }
    }
  });

  it("refuses what it cannot parse, with no host to show", () => {
    const out = checkLink("not a url at all");
    expect(out).toEqual({ ok: false, host: null, reason: "unparseable" });
  });
});

describe("parseAttachments", () => {
  it("keeps the metadata the payload carried", () => {
    const [a] = parseAttachments([
      { filename: "q.pdf", mime_type: "application/pdf", size_bytes: 240, kind: "pdf" },
    ]);
    expect(a).toEqual({
      filename: "q.pdf",
      mimeType: "application/pdf",
      sizeBytes: 240,
      kind: "pdf",
      unavailable: false,
    });
  });

  it("falls back to `other` rather than trusting the name or the declared type", () => {
    const [a] = parseAttachments([{ filename: "invoice.pdf", mime_type: "application/pdf" }]);
    expect(a.kind).toBe("other");
  });

  it("default-denies malformed rows and negative sizes", () => {
    expect(parseAttachments("nope")).toEqual([]);
    expect(parseAttachments([null, 4, "x"])).toEqual([]);
    expect(parseAttachments([{ size_bytes: -1 }])[0].sizeBytes).toBeNull();
  });
});

describe("parseLinks", () => {
  it("drops rows with no usable url and defaults a missing title to empty", () => {
    expect(parseLinks([{ url: "https://a.example" }])).toEqual([
      { url: "https://a.example", title: "" },
    ]);
    expect(parseLinks([{ url: "   " }, { title: "no url" }, 7, null])).toEqual([]);
    expect(parseLinks(undefined)).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("renders absence as nothing rather than as an empty file", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(-1)).toBe("");
  });

  it("uses the 1024 base every mail client shows", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(245_760)).toBe("240 KB");
    expect(formatBytes(1_468_006)).toBe("1.4 MB");
  });
});

describe("the demo fixtures still demonstrate what they are for", () => {
  const hostile = demoPayloads.t12.payload_current as Record<string, unknown>;

  it("carries an unrecognised code that renders as no flag", () => {
    const out = parseFlagCodes(hostile.email_flags);
    expect(out.unknown).toContain("possible_invoice_fraud");
    expect(out.known).not.toContain("possible_invoice_fraud" as never);
  });

  it("carries a filename whose override survives to be stripped at render", () => {
    const [first] = parseAttachments(hostile.attachments);
    expect(first.filename).toContain(String.fromCharCode(0x202e));
    expect(sanitizeDisplay(first.filename)).toBe("INV-4471-remittancefdp.exe");
  });

  it("carries one link of each refusal plus one that passes", () => {
    const reasons = parseLinks(hostile.links).map((l) => {
      const c = checkLink(l.url);
      return c.ok ? "ok" : c.reason;
    });
    expect(new Set(reasons)).toEqual(new Set(["ok", "scheme", "userinfo", "idn"]));
  });
});
