# Massive Meetup

Find recurring Luma calendars in a city — with organizer contacts — for any topic. Defaults to **London / San Francisco** and **AI engineers, AI agents, hackathons**. Built end-to-end on [Massive](https://joinmassive.com)'s Web Render API as a real-world test of the platform; live builder feedback is captured in [`FEEDBACK.md`](./FEEDBACK.md).

> _v0.1 — built in a single session against the public HTTP API. The Massive MCP server review is in the [MCP Review](#mcp-server-review--feedback-for-massive) section below._

---

## What it does

You enter a city and a topic. The app:

1. **Discovers** lu.ma URLs via Massive — fan-out across the `/ai` (Perplexity, geo-targeted, returns grounded source URLs) and `/search` endpoints with 8+ varied queries per run.
2. **Classifies** each URL as calendar / event / user / discovery, dedupes, and keeps the calendars.
3. **Enriches** each candidate calendar by rendering the page through Massive's `/browser` endpoint with `format=markdown`, then parsing organizer, past + upcoming events, and the description.
4. **Scores** each calendar on **recurrence** (event count + name patterns like "weekly"/"monthly") and **topic match** (overlap with your topic terms in titles + descriptions).
5. **Enriches the organizer** by rendering `lu.ma/u/<handle>` for socials + email, falling back to a Perplexity `/ai` query if no email is on the public profile (clearly flagged as low-confidence).
6. **Renders** a sortable table you can export as CSV, plus a search log so you can see exactly what Massive returned for every step.

Result: a ranked list of "running events you can email about" for any city + topic, in 1–3 minutes.

---

## Getting started

```bash
npm install                     # already done if you cloned with deps
cp .env.example .env.local      # then paste your Massive token
npm run dev                     # http://localhost:3000
```

`.env.local`:

```env
MASSIVE_API_KEY=...   # from dashboard.joinmassive.com/developer/api-keys
MASSIVE_BASE_URL=https://render.joinmassive.com
```

Caches and search history land in `data/cache.db` (SQLite, 1-day TTL by default). Delete the file to flush the cache.

---

## Architecture

| Layer | File | What it does |
|---|---|---|
| API client | `src/lib/massive.ts` | Typed client for `/ai`, `/search`, `/browser` with retry, async-poll (`202 → /completions, /results, /content`), and SQLite response cache |
| Discovery | `src/lib/discovery.ts` | Fan-out across 5 AI prompt framings + 4 SERP queries; dedupes lu.ma URLs |
| Luma helpers | `src/lib/luma.ts` | URL normalize, classify (calendar vs event vs user), handle extraction |
| Enrichment | `src/lib/enrich.ts` | Fetches calendar + organizer pages via `/browser` markdown; parses events, socials, email |
| Scoring | `src/lib/score.ts` | Recurrence (event count + name patterns) and topic (term overlap) |
| Persistence | `src/lib/db.ts` | better-sqlite3: response cache, search history, builder observations |
| UI | `src/app/page.tsx`, `src/components/*` | Server action + `useActionState` form, results table, CSV export |

**Stack:** Next.js 16 (App Router, server actions) · TypeScript · Tailwind 4 · zod · better-sqlite3 · cheerio · p-limit.

---

## Execution notes

A few decisions worth flagging:

- **`/ai` is the workhorse for discovery, not `/search`.** Perplexity returns grounding sources — exactly the URLs we want — so we don't need to parse SERPs for the primary path. `/search` runs as a backstop to catch anything Perplexity missed.
- **`/browser` with `format=markdown` is great for parsing.** Massive does a clean HTML→Markdown pass that preserves headings, links, and structure — which made it possible to write a small, regex-driven parser in `enrich.ts` without spinning up a real DOM library on the server. (`format=raw` was the alternative and would have meant shipping a full HTML parser.)
- **Concurrency capped at 3–4** (via `p-limit`) so we don't smash Massive with 30+ parallel calls during a single search. Discovery runs 9 calls in flight; enrichment up to 20.
- **Organizer email is two-pass and clearly labeled.** First pass: parse the `lu.ma/u/<handle>` page for any visible email. Second pass (only if first fails): ask Perplexity. Email source + confidence are surfaced in the UI so you never confuse the two.
- **No streaming UI in v1.** The action runs sync and the user waits ~1–3 min on a spinner. The pipeline already builds a `log[]` of progress events server-side, so a streaming version is straightforward to bolt on later (server actions + `useOptimistic` or a poll endpoint).
- **Server-side only key.** `MASSIVE_API_KEY` is read in server-only modules (`src/lib/massive.ts`, only imported from `'use server'` files). No `NEXT_PUBLIC_` prefix means it can never reach the client bundle.

### What's deliberately out of scope (v1)

- Auth / multi-user
- Auto-refresh / scheduled re-runs
- Direct outreach (mailto links only)
- Generic event platforms beyond lu.ma (Meetup.com, Eventbrite, partiful, etc.)
- Real DOM-based extraction — happy to add a real parser if Massive ever ships `/browser?selectors=...`

---

## MCP server review + feedback for Massive

### Context

The user shipping this app uses the Massive MCP server in **Claude Desktop** (install: drag `massive-mcp-0.1.0.mcpb` into Settings → Extensions, paste a token from the dashboard). I built this Next.js app from inside **Claude Code** (terminal), where the MCP server isn't loaded for this project — so all calls in `src/lib/massive.ts` go directly to the HTTP API. That gives me three angles to comment on:

1. **MCP onboarding** — what it's like to discover and install the MCP
2. **Underlying HTTP API** — what the MCP wraps, since that's what an app like this actually calls
3. **Builder ergonomics** — what was friction when going from "interesting demo" to "shipped tool"

### What's working really well

- **`/ai` returning grounding sources** is a killer feature that I think is undersold. Most people will read "AI completions API" and reach for OpenAI's responses API or Perplexity directly. The differentiator is `sources[]` + geo-targeting in one call. **Lead with this.** A landing-page hero like "Perplexity-style answers + the URLs they came from + city-level geo, in one call" would land much harder than the current generic "frontier AI labs" framing.
- **`/browser` with `format=markdown`** is exactly the right primitive for builders. The output is clean enough to parse with regex; I never reached for cheerio on lu.ma pages.
- **The 200/202+UUID async pattern** is well-designed. Standard, predictable, and the poll-back endpoints are correctly named (`/ai/completions`, `/search/results`, `/browser/content`).
- **Geo-targeting baked into every endpoint** is the right call and a real differentiator vs. proxy-based scrapers (where you have to manage exit-IP yourself).

### Gotchas I hit (bug list for the team)

- **`/search` returns HTML, not JSON.** This is a meaningful gotcha — the docs mention it, but a builder coming from Serper / SerpAPI will assume structured results. Fix: either `format=json` opt-in returning `{title, url, snippet}[]`, or a louder warning at the top of `/search` docs.
- **No public `/mcp` documentation.** `docs.joinmassive.com/llms.txt` doesn't list MCP at all. The install instructions live in Slack/Discord file drops. For a Claude-Desktop-first audience this is the single highest-leverage doc to write — install steps, full tool list, sample prompts, "what should I build with this."
- **Discoverability of `/search` and `/browser`.** They're arguably more general than `/ai`, but `/ai` dominates the docs landing page. A top-level table comparing the three (input → output → when to use) would orient builders in 30 seconds.
- **The `mode` parameter is undocumented.** The OpenAPI mentions it on every endpoint but the per-endpoint docs don't explain it (presumably forces sync vs async?). Quick fix.
- **No headers for cost / cache visibility.** `X-Massive-Credits-Remaining` and `X-Massive-Cache-Hit` headers would let me tune `expiration` aggressively. Right now I cache at 24h by default and have no idea how many credits a typical search burned.
- **`/browser?format=markdown` includes some boilerplate.** Lu.ma's nav, footer, and "Sign in" links show up in the markdown. A `readability=true` mode (drop chrome, keep main content) would be a 10× quality win for parsing.

### Wishlist (highest-impact features for builders like us)

1. **`POST /browser/bulk`** — `[{url, ...}]` → job ID. For lead-enrichment flows we routinely fire 20–50 page renders per search; a bulk endpoint would simplify both client code and (presumably) backend scheduling.
2. **`/browser?schema={...}`** — pass CSS selectors or a JSON schema, get back structured JSON. Firecrawl's `extract` mode is the obvious comparable. With this, half of `enrich.ts` would disappear.
3. **An `npm` package: `@joinmassive/web-render`.** A typed client would lower friction for production builds even more than the MCP. Keep the MCP for ad-hoc Claude Desktop work; ship a typed client for builders. (I wrote ~120 lines of `src/lib/massive.ts` doing this manually; this is the SDK Massive should own.)
4. **A `/discover` endpoint** that combines search + AI + sources in one call ("find me X in Y city"). Save builders the orchestration we did in `discovery.ts`.
5. **Webhook callbacks for async jobs** as an alternative to polling. With 3-min ceilings on individual calls, webhooks would let us run 100-call batches without a long-lived process.
6. **MCP tool discoverability inside Claude Desktop.** When the user installs the MCP, the first thing they see should be a "try these prompts" message — `What can I do with this?` is a common opening question and the MCP should answer it itself.

### One-liner for Massive's PM

> The HTTP API is solid and the LLM-with-grounding-sources angle is the strongest moat. The biggest leverage is on **docs and packaging**: a comparison table of the three endpoints on the landing page, public MCP docs, an `npm` SDK, and a structured-extract mode on `/browser`. Half the build effort in this app went into glue Massive could ship as primitives.

---

## Files

```
src/
  app/
    actions.ts        # server action: runSearch
    layout.tsx
    page.tsx
    globals.css
  components/
    SearchForm.tsx    # client form (useActionState)
    Results.tsx       # results table + CSV export
  lib/
    types.ts
    luma.ts           # URL classify / normalize / handle parsing
    massive.ts        # HTTP client (/ai, /search, /browser + poll)
    db.ts             # SQLite cache + history
    discovery.ts      # fan-out URL discovery
    enrich.ts         # calendar + organizer enrichment
    score.ts          # recurrence + topic scoring
PLAN.md               # design notes
FEEDBACK.md           # running observations for Massive team
data/cache.db         # generated, gitignored
```
