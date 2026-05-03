import type { LumaUrlKind } from "./types";

const LUMA_HOSTS = new Set(["lu.ma", "www.lu.ma", "luma.com", "www.luma.com"]);

export function isLumaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return LUMA_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const BAD_PATH_RE = /%3[CE]|[<>\[\]{}|]/i;

export function normalizeLumaUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!LUMA_HOSTS.has(u.hostname.toLowerCase())) return null;
    if (BAD_PATH_RE.test(u.pathname)) return null;
    u.hostname = "lu.ma";
    u.protocol = "https:";
    u.search = "";
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function classifyLumaUrl(raw: string): LumaUrlKind {
  try {
    const u = new URL(raw);
    if (!LUMA_HOSTS.has(u.hostname.toLowerCase())) return "unknown";
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length === 0) return "discover";
    if (segs[0] === "discover" || segs[0] === "explore") return "discover";
    if (segs[0] === "u" || segs[0] === "user") return "user";
    if (segs[0] === "event" && segs.length >= 2) return "event";
    if (segs.length === 1) {
      const slug = segs[0];
      // Luma event IDs are exactly 8 lowercase alphanumeric chars (opaque random slugs).
      // Calendar/community pages are longer and/or contain hyphens/uppercase.
      if (slug.length === 8 && /^[a-z0-9]+$/.test(slug)) return "event";
      return "calendar";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function extractLumaUrls(text: string): string[] {
  const re = /https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\/[^\s<>()"'\[\]{}|`]*/gi;
  const matches = text.match(re) ?? [];
  const out = new Set<string>();
  for (const m of matches) {
    let cleaned = m.replace(/[.,);\]>'"`]+$/, "");
    // Cut at percent-encoded HTML tags (`%3C` = `<`, `%3E` = `>`) that AI completions sometimes embed.
    const tagIdx = cleaned.search(/%3[CE]/i);
    if (tagIdx !== -1) cleaned = cleaned.slice(0, tagIdx);
    const norm = normalizeLumaUrl(cleaned);
    if (norm) out.add(norm);
  }
  return [...out];
}

export function userHandleFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs[0] === "u" || segs[0] === "user") return segs[1] ?? null;
    return null;
  } catch {
    return null;
  }
}
