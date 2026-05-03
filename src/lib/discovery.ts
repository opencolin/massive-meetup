import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { aiAsk, searchSerp } from "./massive";
import { classifyLumaUrl, extractLumaUrls, normalizeLumaUrl } from "./luma";
import type { DiscoveredUrl, SearchInput } from "./types";

function topicTerms(topic: string): string[] {
  return topic
    .split(/[,;/]|\band\b/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function aiPrompts({ city, topic }: SearchInput): string[] {
  const terms = topicTerms(topic);
  const primary = terms[0] || topic;
  return [
    `List recurring meetups and event series in ${city} focused on ${topic}, that publish their schedule on lu.ma. For each, give the lu.ma URL of the calendar (the host's lu.ma page, not a single event), the organizer name, and a one-line description. Prioritize active hosts with multiple past or upcoming events.`,
    `What lu.ma calendars host monthly or weekly meetups in ${city} on the topic of ${topic}? List each with its full lu.ma URL.`,
    `Find lu.ma URLs for active ${topic} communities based in ${city}. I want the hub pages, not single events.`,
    `Find ${primary} hackathons, demo days, and builder events in ${city} that are hosted on lu.ma. List the lu.ma calendar URL and organizer for each.`,
    `Who are the most active organizers running ${topic} meetups in ${city} on lu.ma? Provide their lu.ma calendar URL and any contact info you can verify.`,
  ];
}

function searchQueries({ city, topic }: SearchInput): string[] {
  const terms = topicTerms(topic);
  const primary = terms[0] || topic;
  const secondary = terms[1] || primary;
  const tertiary = terms[2] || primary;
  return [
    `site:lu.ma "${city}" ${primary}`,
    `site:lu.ma "${city}" ${primary} meetup`,
    `site:lu.ma "${city}" ${secondary} hackathon`,
    `"lu.ma" "${city}" ${tertiary} recurring`,
  ];
}

function urlsFromAi(completion: string | undefined, sources: unknown): string[] {
  const out = new Set<string>();
  if (typeof completion === "string") {
    for (const u of extractLumaUrls(completion)) out.add(u);
  }
  if (Array.isArray(sources)) {
    for (const s of sources) {
      const url = typeof s === "string" ? s : (s as { url?: string })?.url;
      if (typeof url === "string") {
        const norm = normalizeLumaUrl(url);
        if (norm) out.add(norm);
        for (const u of extractLumaUrls(url)) out.add(u);
      }
    }
  }
  return [...out];
}

function urlsFromSerpHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let target = href;
    if (href.startsWith("/url?")) {
      try {
        const u = new URL(href, "https://www.google.com");
        target = u.searchParams.get("q") ?? href;
      } catch {
        return;
      }
    }
    const norm = normalizeLumaUrl(target);
    if (norm) urls.add(norm);
  });
  for (const u of extractLumaUrls($.text())) urls.add(u);
  return [...urls];
}

export async function discoverUrls(
  input: SearchInput,
  log: (msg: string) => void,
): Promise<DiscoveredUrl[]> {
  const limit = pLimit(3);
  const found = new Map<string, DiscoveredUrl>();

  const aiTasks = aiPrompts(input).map((prompt) =>
    limit(async () => {
      log(`ai: ${prompt.slice(0, 70)}…`);
      try {
        const res = await aiAsk(prompt, {
          model: "perplexity",
          city: input.city,
          country: input.country,
          format: "json",
        });
        const urls = urlsFromAi(res.completion, res.sources);
        log(`ai → ${urls.length} luma URLs`);
        for (const url of urls) {
          const existing = found.get(url);
          if (existing) {
            existing.hits++;
          } else {
            found.set(url, {
              url,
              kind: classifyLumaUrl(url),
              source: "ai",
              prompt,
              hits: 1,
            });
          }
        }
      } catch (err) {
        log(`ai failed: ${(err as Error).message.slice(0, 120)}`);
      }
    }),
  );

  const searchTasks = searchQueries(input).map((q) =>
    limit(async () => {
      log(`search: ${q}`);
      try {
        const html = await searchSerp(q, {
          city: input.city,
          country: input.country,
          size: 30,
        });
        const urls = urlsFromSerpHtml(html);
        log(`search → ${urls.length} luma URLs`);
        for (const url of urls) {
          const existing = found.get(url);
          if (existing) {
            existing.hits++;
          } else {
            found.set(url, {
              url,
              kind: classifyLumaUrl(url),
              source: "search",
              query: q,
              hits: 1,
            });
          }
        }
      } catch (err) {
        log(`search failed: ${(err as Error).message.slice(0, 120)}`);
      }
    }),
  );

  await Promise.all([...aiTasks, ...searchTasks]);
  return [...found.values()];
}
