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
