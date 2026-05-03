"use server";

import { z } from "zod";
import { discoverUrls } from "@/lib/discovery";
import { enrichAll } from "@/lib/enrich";
import { finishSearch, startSearch } from "@/lib/db";
import type { ProgressEvent, SearchInput, SearchResult } from "@/lib/types";

const Input = z.object({
  city: z.string().min(1).max(80),
  country: z.string().min(2).max(3),
  topic: z.string().min(1).max(200),
});

export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; result: SearchResult };

export async function runSearch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = Input.safeParse({
    city: formData.get("city") ?? "London",
    country: formData.get("country") ?? "GB",
    topic: formData.get("topic") ?? "AI engineers, AI agents, hackathons",
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues.map((e) => e.message).join("; ") };
  }
  const input: SearchInput = parsed.data;
  const startedAt = Date.now();
  const searchId = startSearch(input.city, input.country, input.topic);

  const log: ProgressEvent[] = [];
  const append = (phase: ProgressEvent["phase"], message: string) => {
    log.push({ ts: Date.now(), phase, message });
  };

  try {
    append("discover", `searching ${input.city} for "${input.topic}"`);
    const urls = await discoverUrls(input, (m) => append("discover", m));
    append("classify", `discovered ${urls.length} luma URLs`);

    // Both events and (slug-shaped) calendars become enrichment candidates — Luma allows custom
    // slugs for both, so URL-shape is unreliable. fetchPage classifies via page content and
    // groups events under their parent calendar via the "Presented by" link.
    const candidates = urls
      .filter((u) => u.kind === "event" || u.kind === "calendar")
      .sort((a, b) => b.hits - a.hits);
    const candidateUrls = candidates.slice(0, 25).map((u) => u.url);
    append("classify", `${candidateUrls.length} candidates (of ${candidates.length}) after rank+cap`);

    if (candidateUrls.length === 0) {
      const result: SearchResult = {
        searchId,
        input,
        calendars: [],
        log,
        startedAt,
        finishedAt: Date.now(),
      };
      finishSearch(searchId, JSON.stringify(result));
      return { status: "ok", result };
    }

    const calendars = await enrichAll(candidateUrls, input, (m) => append("enrich-calendar", m));
    append("score", `enriched ${calendars.length} calendars`);

    calendars.sort((a, b) => b.recurrenceScore + b.topicScore - (a.recurrenceScore + a.topicScore));

    append("done", "search complete");
    const result: SearchResult = {
      searchId,
      input,
      calendars,
      log,
      startedAt,
      finishedAt: Date.now(),
    };
    finishSearch(searchId, JSON.stringify(result));
    return { status: "ok", result };
  } catch (err) {
    const message = (err as Error).message ?? "unknown error";
    append("done", `failed: ${message}`);
    const partial: SearchResult = {
      searchId,
      input,
      calendars: [],
      log,
      startedAt,
      finishedAt: Date.now(),
    };
    finishSearch(searchId, JSON.stringify(partial));
    return { status: "error", message };
  }
}
