import pLimit from "p-limit";
import { aiAsk, browserFetch } from "./massive";
import { normalizeLumaUrl } from "./luma";
import type { CalendarRecord, LumaEvent, Organizer, SearchInput } from "./types";
import { scoreRecurrence, scoreTopic } from "./score";

// "Presented by" → [Calendar Name](/<slug>?k=c). The ?k=c marker is Luma's unambiguous
// calendar-mode flag. Match relative or absolute URLs.
const CALENDAR_LINK_RE =
  /\[([^\]]+)\]\((?:https?:\/\/(?:www\.)?lu\.ma|https?:\/\/(?:www\.)?luma\.com)?(\/[^)]+\?k=c[^)]*)\)/i;

// User links — `[Name](/user/handle)` or absolute equivalents.
const USER_LINK_RE_G =
  /\[([^\]]+)\]\((?:https?:\/\/(?:www\.)?lu\.ma|https?:\/\/(?:www\.)?luma\.com)?\/(?:u|user)\/([A-Za-z0-9_.-]+)\)/g;

// Event links on a calendar page — `[Title](/<slug>)` (relative or absolute) where slug isn't reserved.
const EVENT_LINK_RE_G =
  /\[([^\]]+)\]\((?:https?:\/\/(?:www\.)?lu\.ma|https?:\/\/(?:www\.)?luma\.com)?\/([A-Za-z0-9][A-Za-z0-9_.-]*)\)/g;

const RESERVED_PATHS = new Set([
  "u",
  "user",
  "event",
  "signin",
  "signup",
  "signout",
  "discover",
  "explore",
  "ai",
  "home",
  "settings",
  "help",
  "calendars",
]);

const H1_RE = /^#\s+(.+?)\s*$/m;
const HEADING_RE = /^#{1,3}\s+(.+?)\s*$/m;
const PAST_HEADING_RE = /^#{1,4}\s+(past|previous|prior)\b/im;
const UPCOMING_HEADING_RE = /^#{1,4}\s+(upcoming|featured|future|next)\b/im;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IGNORED_EMAIL_DOMAINS = /@(?:lu\.ma|luma\.com|sentry\.io|google-analytics\.com|example\.com|sentry-next\.wixpress\.com)$/i;
const IGNORED_EMAIL_LOCALS = /^(?:no-?reply|do-?not-?reply|postmaster|mailer-daemon)@/i;

export type PageData = {
  pageUrl: string;
  pageType: "event" | "calendar";
  calendarUrl: string;
  calendarName: string;
  title: string;
  description?: string;
  pastEvents: LumaEvent[];
  upcomingEvents: LumaEvent[];
  organizers: { handle: string; name: string }[];
  rawMarkdown: string;
};

function parseTitle(md: string): string {
  const h1 = md.match(H1_RE);
  if (h1) return h1[1].trim();
  const m = md.match(HEADING_RE);
  return m ? m[1].trim() : "";
}

function parseDescription(md: string): string | undefined {
  const aboutIdx = md.search(/^About Event\s*$/m);
  const start = aboutIdx >= 0 ? aboutIdx + "About Event".length : 0;
  const lines = md.slice(start).split("\n");
  for (const raw of lines) {
    const line = raw.replace(/​/g, "").trim();
    if (line.length < 30) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("![")) continue;
    if (line.startsWith("[")) continue;
    return line.replace(/^\*+|\*+$/g, "").slice(0, 400);
  }
  return undefined;
}

function parseCalendarLink(md: string): { name: string; relPath: string } | null {
  const m = md.match(CALENDAR_LINK_RE);
  if (!m) return null;
  return { name: m[1].trim(), relPath: m[2] };
}

function calendarUrlFromRel(relPath: string): string | null {
  const cleanPath = relPath.split("?")[0].replace(/\/$/, "");
  // The "Presented by" link sometimes points to a sub-view like /<slug>/map or /<slug>/calendars.
  // Take just the first segment as the canonical calendar slug.
  const slug = cleanPath.split("/").filter(Boolean)[0];
  if (!slug) return null;
  return `https://lu.ma/${slug}`;
}

function parseAllUserLinks(text: string, limit: number): { handle: string; name: string }[] {
  const out: { handle: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(USER_LINK_RE_G)) {
    const name = m[1].trim();
    const handle = m[2];
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push({ name, handle });
    if (out.length >= limit) break;
  }
  return out;
}

function parseHostedBy(md: string): { handle: string; name: string }[] {
  const hostedByIdx = md.search(/^Hosted By\s*$/m);
  if (hostedByIdx === -1) return parseAllUserLinks(md, 4);
  const sectionStart = hostedByIdx;
  const tail = md.slice(sectionStart);
  const wentMatch = tail.search(/^[\d,]+\s+Went\s*$/m);
  const contactMatch = tail.search(/^Contact the Host\s*$/m);
  const headingMatch = tail.slice(10).search(/^#{1,3}\s/m);
  const ends = [
    wentMatch >= 0 ? wentMatch : -1,
    contactMatch >= 0 ? contactMatch : -1,
    headingMatch >= 0 ? headingMatch + 10 : -1,
  ].filter((i) => i > 0);
  const sectionEnd = ends.length > 0 ? sectionStart + Math.min(...ends) : md.length;
  const section = md.slice(sectionStart, sectionEnd);
  return parseAllUserLinks(section, 6);
}

function parseEvents(md: string): { past: LumaEvent[]; upcoming: LumaEvent[] } {
  const all: LumaEvent[] = [];
  const seen = new Set<string>();
  for (const m of md.matchAll(EVENT_LINK_RE_G)) {
    const title = m[1].trim();
    const slug = m[2];
    if (RESERVED_PATHS.has(slug)) continue;
    if (title.length < 3) continue;
    const norm = normalizeLumaUrl(`https://lu.ma/${slug}`);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    all.push({ title, url: norm });
  }
  const pastIdx = md.search(PAST_HEADING_RE);
  const upcomingIdx = md.search(UPCOMING_HEADING_RE);
  if (pastIdx === -1 && upcomingIdx === -1) {
    return { past: [], upcoming: all };
  }
  const past: LumaEvent[] = [];
  const upcoming: LumaEvent[] = [];
  for (const ev of all) {
    const slug = ev.url.replace(/^https?:\/\/(?:www\.)?lu\.ma\//, "");
    const pos = md.indexOf(`(/${slug})`);
    const prevPast = pastIdx !== -1 && pastIdx <= pos ? pastIdx : -1;
    const prevUpcoming = upcomingIdx !== -1 && upcomingIdx <= pos ? upcomingIdx : -1;
    if (prevPast === -1 && prevUpcoming === -1) upcoming.push(ev);
    else if (prevUpcoming > prevPast) upcoming.push(ev);
    else past.push(ev);
  }
  return { past, upcoming };
}

function detectPageType(md: string): "event" | "calendar" {
  const eventMarkers = /(Past Event|Get Tickets|Register to See Address|Add to Calendar|This event ended)/i;
  const calendarMarkers = /(Submit Event|Subscribers|Manage Calendar)/i;
  if (calendarMarkers.test(md)) return "calendar";
  if (eventMarkers.test(md)) return "event";
  if (CALENDAR_LINK_RE.test(md)) return "event";
  return "calendar";
}

function findEmail(text: string): string | null {
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0];
    if (IGNORED_EMAIL_DOMAINS.test(email)) continue;
    if (IGNORED_EMAIL_LOCALS.test(email)) continue;
    return email;
  }
  return null;
}

const SOCIAL_OR_LUMA =
  /lu\.ma|luma\.com|lumacdn\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|facebook\.com|github\.com|tiktok\.com|youtube\.com|google\.com\/maps/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|avif|ico)(?:\?|$)/i;

function findFirstUrl(md: string, re: RegExp): string | undefined {
  const m = md.match(re);
  return m ? m[0] : undefined;
}

function findExternalSite(md: string): string | undefined {
  const re = /https?:\/\/[^\s)\]>"']+/g;
  for (const m of md.matchAll(re)) {
    const url = m[0].replace(/[.,);\]>'"`]+$/, "");
    if (SOCIAL_OR_LUMA.test(url)) continue;
    if (IMAGE_EXT.test(url)) continue;
    return url
      .replace(/([?&])utm_source=luma(&|$)/, (_, p1, p2) => (p2 === "&" ? p1 : ""))
      .replace(/[?&]$/, "");
  }
  return undefined;
}

export async function fetchPage(url: string, input: SearchInput): Promise<PageData | null> {
  let md: string;
  try {
    md = await browserFetch(url, {
      format: "markdown",
      city: input.city,
      country: input.country,
      readiness: "domcontentloaded",
      delay: 1.5,
    });
  } catch {
    return null;
  }
  if (!md || md.length < 200) return null;
  // Reject 404 / "Page Not Found" pages — Luma serves these for hallucinated URLs from the
  // discovery step.
  if (/(?:^|\n)#\s+(?:404|Page Not Found)/i.test(md)) return null;
  if (/Sorry, the page you('re| are) looking for does(?:n't| not) exist/i.test(md)) return null;

  const pageType = detectPageType(md);
  const title = parseTitle(md) || new URL(url).pathname.replace(/^\//, "");
  const description = parseDescription(md);
  const calLink = parseCalendarLink(md);

  let calendarUrl: string;
  let calendarName: string;
  if (calLink) {
    const resolved = calendarUrlFromRel(calLink.relPath);
    calendarUrl = resolved ?? normalizeLumaUrl(url) ?? url;
    calendarName = calLink.name;
  } else {
    calendarUrl = normalizeLumaUrl(url) ?? url;
    calendarName = title;
  }

  const organizers = parseHostedBy(md);
  const { past, upcoming } = parseEvents(md);

  return {
    pageUrl: url,
    pageType,
    calendarUrl,
    calendarName,
    title,
    description,
    pastEvents: past,
    upcomingEvents: upcoming,
    organizers,
    rawMarkdown: md.slice(0, 10000),
  };
}

export async function enrichOrganizer(
  org: Organizer,
  calendarName: string,
  input: SearchInput,
): Promise<Organizer> {
  const url = `https://lu.ma/user/${org.handle}`;
  let md: string | null = null;
  try {
    md = await browserFetch(url, {
      format: "markdown",
      city: input.city,
      country: input.country,
      readiness: "domcontentloaded",
      delay: 1.5,
    });
  } catch {
    md = null;
  }

  const out: Organizer = { ...org };
  if (md && md.length > 50) {
    out.name = out.name || parseTitle(md) || out.handle;
    const bio = md
      .split("\n")
      .find((line) => {
        const t = line.replace(/​/g, "").trim();
        if (t.length < 30) return false;
        if (t.startsWith("#") || t.startsWith("[") || t.startsWith("![")) return false;
        // Skip "Hosted By" summary patterns ("By X, Y, Z & N other")
        if (/^By\s+.+&\s+\d+\s+other/i.test(t)) return false;
        if (/^\d[\d,]*\s+(Went|Going|Subscribers)\b/i.test(t)) return false;
        return true;
      })
      ?.replace(/​/g, "")
      .trim();
    out.bio = out.bio ?? bio;
    out.twitter =
      out.twitter ||
      findFirstUrl(md, /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+/i) ||
      undefined;
    out.linkedin =
      out.linkedin ||
      findFirstUrl(md, /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_-]+/i) ||
      undefined;
    out.website = out.website || findExternalSite(md) || undefined;
    const email = findEmail(md);
    if (email) {
      out.email = email;
      out.emailSource = "luma";
      out.emailConfidence = "high";
    }
  }

  if (!out.email) {
    try {
      const prompt = `Public contact email for ${out.name ?? out.handle}, the organizer of "${calendarName}" (lu.ma) in ${input.city}. Return only the email if you can verify it from a public source; if no verifiable email, return "unknown". Do not invent.`;
      const res = await aiAsk(prompt, {
        model: "perplexity",
        city: input.city,
        country: input.country,
        format: "json",
      });
      const text = (res.completion ?? "").trim();
      const m = findEmail(text);
      if (m && !/unknown/i.test(text)) {
        out.email = m;
        out.emailSource = "ai";
        out.emailConfidence = "low";
      }
    } catch {
      /* ignore */
    }
  }

  return out;
}

export async function fetchAllPages(
  candidateUrls: string[],
  input: SearchInput,
  log: (msg: string) => void,
): Promise<PageData[]> {
  const limit = pLimit(4);
  const results = await Promise.all(
    candidateUrls.map((url) =>
      limit(async () => {
        log(`fetch-page: ${url}`);
        const p = await fetchPage(url, input);
        if (!p) {
          log(`fetch-page: skipped ${url}`);
          return null;
        }
        log(`fetch-page: ${p.pageType} → calendar=${p.calendarUrl} hosts=${p.organizers.length}`);
        return p;
      }),
    ),
  );
  return results.filter((p): p is PageData => p !== null);
}

export function groupByCalendar(pages: PageData[], input: SearchInput): CalendarRecord[] {
  const groups = new Map<string, { name: string; pages: PageData[] }>();
  for (const p of pages) {
    const key = p.calendarUrl;
    let g = groups.get(key);
    if (!g) {
      g = { name: p.calendarName, pages: [] };
      groups.set(key, g);
    }
    g.pages.push(p);
  }

  const records: CalendarRecord[] = [];
  for (const [calendarUrl, g] of groups) {
    const past: LumaEvent[] = [];
    const upcoming: LumaEvent[] = [];
    const seenEvents = new Set<string>();
    const orgMap = new Map<string, Organizer>();
    const discoveredFrom: string[] = [];
    let bestDescription: string | undefined;

    for (const p of g.pages) {
      discoveredFrom.push(p.pageUrl);
      if (p.pageType === "event") {
        const ev: LumaEvent = { url: p.pageUrl, title: p.title };
        if (!seenEvents.has(ev.url)) {
          seenEvents.add(ev.url);
          past.push(ev);
        }
        if (!bestDescription) bestDescription = p.description;
      }
      for (const ev of p.pastEvents) {
        if (!seenEvents.has(ev.url)) {
          seenEvents.add(ev.url);
          past.push(ev);
        }
      }
      for (const ev of p.upcomingEvents) {
        if (!seenEvents.has(ev.url)) {
          seenEvents.add(ev.url);
          upcoming.push(ev);
        }
      }
      for (const o of p.organizers) {
        if (!orgMap.has(o.handle)) {
          orgMap.set(o.handle, { handle: o.handle, name: o.name });
        }
      }
    }

    const organizers = [...orgMap.values()];
    const partial: CalendarRecord = {
      url: calendarUrl,
      name: g.name,
      description: bestDescription,
      organizer: organizers[0],
      organizers,
      pastEvents: past,
      upcomingEvents: upcoming,
      discoveredFrom,
      recurrenceScore: 0,
      topicScore: 0,
    };
    partial.recurrenceScore = scoreRecurrence(partial);
    partial.topicScore = scoreTopic(partial, input.topic);
    records.push(partial);
  }
  return records;
}

export async function enrichAll(
  candidateUrls: string[],
  input: SearchInput,
  log: (msg: string) => void,
): Promise<CalendarRecord[]> {
  const pages = await fetchAllPages(candidateUrls, input, log);
  log(`grouping ${pages.length} pages by parent calendar`);
  const records = groupByCalendar(pages, input);
  log(`${records.length} unique calendars`);

  const orgLimit = pLimit(3);
  await Promise.all(
    records.map((r) =>
      orgLimit(async () => {
        if (!r.organizer) return;
        log(`enrich-organizer: ${r.organizer.handle}`);
        r.organizer = await enrichOrganizer(r.organizer, r.name, input);
      }),
    ),
  );
  return records;
}
