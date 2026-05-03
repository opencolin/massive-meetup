# Massive Web Render — Builder Feedback

Notes captured while building `massive-meetup` against the Web Render API. Goal: actionable feedback for the Massive team. Each item is dated and tagged.

Tags: `[docs]` documentation, `[dx]` developer experience, `[api]` API design, `[mcp]` MCP server, `[bug]` suspected bug, `[wish]` feature request.

---

## 2026-05-02 — initial impressions (pre-build)

### `[docs]` Discoverability of endpoints is uneven
The `/ai` endpoint is the most prominent in docs, but `/search` and `/browser` are arguably the more general-purpose primitives. A first-time reader landing on `docs.joinmassive.com/web-render/ai` could easily miss them. Suggest: a top-level "Web Render endpoints at a glance" table on the landing page comparing `/ai`, `/search`, `/browser` (input → output → when to use).

### `[docs]` `/search` returns HTML, not JSON
This is a meaningful gotcha for anyone expecting a search API. The docs mention it in passing but don't explain *why* (presumably: full SERP fidelity, AI overviews, etc.). Suggest: call this out prominently with a note on parsing strategy, or add an opt-in `format=json` mode that returns parsed `{title, url, snippet}` objects.

### `[api]` Async pattern is well-designed but underdocumented
The `200 vs 202+UUID` pattern with poll-back endpoints (`/ai/completions`, `/search/results`, `/browser/content`) is great — clean, standard. But the `mode` parameter (presumably `sync`/`async`?) isn't explained on the per-endpoint pages I reviewed. Suggest: an "Async basics" page covering the pattern once, then linked from each endpoint.

### `[wish]` URL-rendering with structured extraction
For our use case (Luma calendar → organizer + event list), `format=markdown` is great, but we still write our own parser. A `selectors` or `schema` parameter (CSS selectors → JSON keys, à la Browse.ai / Firecrawl `extract`) would make `/browser` 10× more useful. Even just "give me the og: tags + JSON-LD as structured" would help.

### `[mcp]` MCP server has zero presence in public docs
The MCP server (`massive-mcp-0.1.0.mcpb`) is shipped via a Slack/Discord file drop, not the docs site. `docs.joinmassive.com/llms.txt` does not mention MCP. For a Claude-Desktop-first audience this is a missed opportunity — suggest a `/mcp` doc page with: tool list, install steps, example prompts, and a "what can I build with it" section.

### `[wish]` Bulk endpoints
For lead-enrichment workflows like ours, we'll fire 50+ `/browser` calls per search. A `POST /browser/bulk` taking `[{url, ...}]` and returning a job ID would simplify both client code and (presumably) backend scheduling.

### `[wish]` Pricing/credits visibility
Docs don't surface per-call cost or how `expiration` interacts with billing (does a cache hit cost zero? a fraction?). Surfacing this in headers (`X-Massive-Credits-Remaining`, `X-Massive-Cache-Hit`) would let us tune cache aggressiveness.

---

<!-- New entries appended below as we build. Format: ## YYYY-MM-DD — phase or feature. -->

## 2026-05-03 — observations from real runs (London + SF)

Concrete numbers from end-to-end runs against `AI engineers, AI agents, hackathons`:

| Run | Candidates enriched | Calendars surfaced | With real organizer | Time (cold cache) |
|---|---|---|---|---|
| London / GB | 12 | 11 | 8 (Twitter+LinkedIn+website each) | 4.5 min |
| SF / US | 10 | 8 | 4 (incl. 1 verified email via /ai fallback) | 2.5 min |

Subsequent runs against the same params are sub-second on cache hits.

### `[bug]` `/ai` `model=perplexity` invents plausible-but-fake `lu.ma` URLs
Real cases observed: Perplexity returned `lu.ma/mlops-community-london` (real calendar is `london-mlops`) and `lu.ma/ai-builders-london` (real is `ai-builders`). Both URLs return Luma's 404 page (with HTTP 200, not 404 status — see next item). I had to add a content-level 404 detector. Mitigation idea: Massive could surface a `confidence` or `verified` flag on each grounding source, or strip sources that 404 before returning. Even just URL-existence checking on the source list pre-return would dramatically improve reliability for downstream parsers.

### `[bug]` Luma serves 404s as HTTP 200
Not Massive's bug, but a real footgun: `/browser` returns the 404 markdown body with status 200. Builders parsing the response have to grep the body for "404" or "Page Not Found". Suggestion: `/browser` could expose a `pageStatus` / `httpStatusFromTarget` field in the response when it's clear the target server returned an error code or rendered a known error template.

### `[wish]` `/browser?format=markdown` keeps relative URLs
Luma uses relative URLs throughout (`[Name](/user/handle)`, `[Calendar](/slug?k=c)`). My parser had to special-case relative resolution against the page's origin. A `format=markdown&absolutize=true` (or default behavior) would make output portable across consumers.

### `[wish]` `/browser?readability=true`
Every Luma page in our corpus had ~30% boilerplate noise (nav, footer, "Sign In", "Explore Events", duplicated "Presented by" sections). A reader-mode flag that strips chrome would eliminate a lot of regex defensiveness on the consumer side. The current `format=markdown` is a clean conversion but the *content selection* is the missing primitive.

### `[bug]` `/ai` returned status=500 once during a 9-call fan-out (~11% rate)
Body: `Unknown error occurred`. Pipeline retried gracefully and the rest succeeded, so this was a survivable hiccup, but the error message provided no actionable detail. Suggestion: typed error envelopes (e.g. `{ error: "upstream_timeout" | "rate_limited" | "model_unavailable" }`) so clients can tune retry/backoff per cause.

### `[dx]` Polling timeouts can compound badly
On one early run the script reported `enriched in 9810.8s` (~2.7 hours wall-clock) — almost certainly because several calls returned `202 → 3-min poll → final non-200`. Three concurrent enrichment calls each maxing out their 180s poll window can stall a workflow for many minutes. Suggestions: (a) lower the default `MAX_POLL_MS` and let the user opt up; (b) emit a `Retry-After` header on `202` so clients can poll smarter; (c) document the worst-case latency clearly. Subsequent runs (warmer Massive backend?) completed in 2–4 min, so this is variance not constant — but variance is its own problem.

### `[wish]` Massive should expose Luma's "Presented by" mechanism as a primitive
Insight discovered by reverse-engineering: every Luma event page links to its parent calendar via `[Name](/<slug>?k=c)` — the `?k=c` query string is the unambiguous calendar marker. Massive could ship a domain-aware `/extract?provider=luma&type=calendar-from-event` (or just include known patterns in the `/browser` response). For builders doing lead-enrichment on Luma, this single mechanism unlocked the entire pipeline; it's just buried in markup.

### `[ok]` What worked great with zero friction
- `/ai?model=perplexity&city=...&country=...` returning grounded `sources[]`: this is the reason this app exists. Replacing it would mean building Perplexity + a city-targeting proxy ourselves.
- `/browser?format=markdown` cleanliness: I never needed `cheerio` for Luma pages, only for `/search` SERP HTML.
- Async `200 / 202+UUID` pattern: poll-back endpoint names (`/ai/completions`, `/browser/content`, `/search/results`) are predictable and consistent.
- Bearer-token auth: zero friction; works in any HTTP client.

### Final summary for Massive's PM (post-real-run, replaces conversational summary)

The platform is genuinely useful for an AI-engineer-finding-leads workflow — we shipped a working app in one session against the live API, and it produces real, actionable contact info. Three concrete asks to invest in:

1. **Source-quality on `/ai`**: hallucinated URLs in `sources[]` cost the most builder pain. Add URL-existence verification or a confidence field.
2. **Structured extraction on `/browser`**: `?schema=` or `?selectors=` would eliminate ~half the parser code in this app and is the obvious feature parity gap vs. Firecrawl/Browse.ai.
3. **Public MCP docs + a typed `npm` SDK**: the MCP install lives in Slack file-drops, and there's no `@joinmassive/web-render` package yet. Both are high-leverage, low-effort.
