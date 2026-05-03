# Massive Meetup — Plan

App that takes a city + topic and returns a ranked list of recurring Luma calendars matching the topic, with organizer contact info. Defaults: London / SF, "AI engineers, agents, hackathons". Built on Massive's Web Render API (`/ai`, `/search`, `/browser`) as a real-world test of the API; live feedback captured in `FEEDBACK.md`.

## Stack
- Next.js 16 (App Router, TypeScript, Tailwind, src/ layout)
- Server actions for the discovery pipeline (no client-side API key exposure)
- better-sqlite3 for response cache + result persistence (`data/cache.db`)
- zod for response validation, p-limit for concurrency, cheerio for SERP HTML parsing

## Massive endpoints used
| Endpoint | Use |
|---|---|
| `GET /ai` `model=perplexity, city, format=json` | Primary discovery — grounded sources contain lu.ma URLs |
| `GET /search` `terms=site:lu.ma ... {city}` | Backstop discovery — parse SERP HTML for lu.ma links |
| `GET /browser` `format=markdown` | Enrich lu.ma calendar + organizer pages |
| `GET /browser/devices`, `GET /ai/devices` | Reference only |

All three may return `200` (sync) or `202 + UUID` (async); the client polls `/{search,browser/content,ai/completions}` with the UUID until 200.

## Pipeline
1. **Discover URLs** — fan out 5 prompts via `/ai` (varied framings around the user's `topic`), plus 4 `/search` queries. Harvest every `lu.ma/*` URL and count how many sources cite each one (`hits`).
2. **Classify + rank** — bucket into `event` (`lu.ma/<id>` short slug) vs `calendar` (`lu.ma/<name>` longer slug). Sort calendar candidates by `hits` (number of sources that cited them) and keep the top 20. Single-event URLs are dropped in v1; walking events back to their parent calendar is a future enhancement once `/browser?schema=…` lands.
3. **Enrich calendars** — `/browser` each candidate. Parse: name, organizer handle, past events (count + dates), upcoming events (count + dates), topic keywords in titles/descriptions.
4. **Score recurrence + topic** — recurrence: `past>=3 || upcoming>=2 || /weekly|monthly|biweekly/i.test(name)`. Topic match: keyword overlap with `topic` filter terms.
5. **Enrich organizer** — `/browser` on `lu.ma/u/<handle>` for bio + linked socials. If no email, `/ai` prompt: "Public contact email for {name}, organizer of {calendar}". Cross-reference Twitter/LinkedIn URLs.
6. **Persist + render** — write to SQLite, return ranked list to UI.

## Data model (SQLite)
- `searches(id, city, topic, started_at, finished_at)`
- `calendars(id, search_id, url, name, organizer_handle, past_count, upcoming_count, recurrence_score, topic_score, raw_md)`
- `organizers(handle PRIMARY KEY, name, bio, twitter, linkedin, website, email, source)`
- `cache(key PRIMARY KEY, response_json, fetched_at)` — keyed by endpoint+params

## UI (single page)
- Form: city (default London), topic (default "AI engineers, agents, hackathons"), country (auto from city)
- Submit → server action streams progress events
- Results table: calendar name, organizer, cadence, past/upcoming counts, topic score, contact (email/Twitter/LinkedIn), open lu.ma button
- "Export CSV" button

## Out of scope (v1)
- Auth, multi-user
- Auto-refresh / scheduled re-runs
- Direct outreach (mailto links only)
- Generic calendar platforms beyond lu.ma

## Risks / open questions
- `/search` returns HTML, not structured JSON — SERP layout may shift; cheerio selectors may need updates
- `lu.ma` may rate-limit or rotate selectors; `/browser` `difficulty=medium` is the escalation
- Email finding via `/ai` will hallucinate; treat results as low-confidence and surface the source
- Per-call cost unknown; default to 1-day cache to limit re-runs
