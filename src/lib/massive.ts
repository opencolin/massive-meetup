import { cacheGet, cacheSet, recordObservation } from "./db";

const BASE = process.env.MASSIVE_BASE_URL || "https://render.joinmassive.com";

function getToken(): string {
  const t = process.env.MASSIVE_API_KEY;
  if (!t) throw new Error("MASSIVE_API_KEY is not set. Add it to .env.local.");
  return t;
}

const POLL_INTERVAL_MS = 4_000;
const FIRST_POLL_MS = 1_500;
const MAX_POLL_MS = 180_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type Endpoint = "ai" | "search" | "browser";
type PollEndpoint = "ai/completions" | "search/results" | "browser/content";

const POLL_PATH: Record<Endpoint, PollEndpoint> = {
  ai: "ai/completions",
  search: "search/results",
  browser: "browser/content",
};

function buildKey(endpoint: Endpoint, params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${endpoint}?${entries}`;
}

function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fetchWithAuth(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
    cache: "no-store",
  });
}

async function pollUntilDone(endpoint: Endpoint, id: string): Promise<{ status: number; body: string }> {
  const pollPath = POLL_PATH[endpoint];
  const pollUrl = buildUrl(pollPath, { id });
  const start = Date.now();
  let firstPoll = true;
  while (Date.now() - start < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, firstPoll ? FIRST_POLL_MS : POLL_INTERVAL_MS));
    firstPoll = false;
    const res = await fetchWithAuth(pollUrl);
    if (res.status === 200) {
      return { status: 200, body: await res.text() };
    }
    if (res.status !== 202) {
      const body = await res.text();
      return { status: res.status, body };
    }
  }
  throw new Error(`Massive ${endpoint} polling timed out for id=${id}`);
}

async function callMassive(
  endpoint: Endpoint,
  params: Record<string, string | number | undefined>,
  opts: { ttlMs?: number; useCache?: boolean } = {},
): Promise<string> {
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;
  const cacheKey = buildKey(endpoint, params);
  if (opts.useCache !== false) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const url = buildUrl(endpoint, params);
  const startedAt = Date.now();
  const res = await fetchWithAuth(url);

  let body: string;
  let finalStatus = res.status;
  if (res.status === 200) {
    body = await res.text();
  } else if (res.status === 202) {
    const id = (await res.text()).trim().replace(/^"|"$/g, "");
    if (!id) throw new Error(`Massive ${endpoint} returned 202 without UUID`);
    recordObservation("api", `${endpoint} returned 202 — polling`, { id, params });
    const polled = await pollUntilDone(endpoint, id);
    finalStatus = polled.status;
    body = polled.body;
    if (finalStatus !== 200) {
      throw new Error(`Massive ${endpoint} polled status=${finalStatus}: ${body.slice(0, 200)}`);
    }
  } else {
    body = await res.text();
    recordObservation("api-error", `${endpoint} non-200`, {
      status: res.status,
      params,
      bodyPreview: body.slice(0, 200),
    });
    throw new Error(`Massive ${endpoint} status=${res.status}: ${body.slice(0, 300)}`);
  }

  const elapsed = Date.now() - startedAt;
  recordObservation("timing", `${endpoint} ${finalStatus} in ${elapsed}ms`, { params });
  if (ttl > 0) cacheSet(cacheKey, body, ttl);
  return body;
}

export type AiCompletion = {
  model?: string;
  query?: string;
  prompt?: string;
  completion?: string;
  html?: string;
  sources?: Array<{ url: string; title?: string; snippet?: string }> | string[];
  subqueries?: string[];
  device?: string;
  city?: string;
  country?: string;
};

export type AiOptions = {
  model?: "chatgpt" | "gemini" | "perplexity" | "copilot";
  city?: string;
  country?: string;
  format?: "json" | "rendered" | "raw";
  expiration?: number;
  ttlMs?: number;
  useCache?: boolean;
};

export async function aiAsk(prompt: string, opts: AiOptions = {}): Promise<AiCompletion> {
  const params = {
    prompt,
    model: opts.model ?? "perplexity",
    city: opts.city,
    country: opts.country,
    format: opts.format ?? "json",
    expiration: opts.expiration,
  };
  const body = await callMassive("ai", params, { ttlMs: opts.ttlMs, useCache: opts.useCache });
  try {
    return JSON.parse(body) as AiCompletion;
  } catch {
    recordObservation("api-quirk", "ai/format=json returned non-JSON; falling back", {
      preview: body.slice(0, 200),
    });
    return { completion: body };
  }
}

export type SearchOptions = {
  serps?: number;
  size?: number;
  offset?: number;
  city?: string;
  country?: string;
  language?: string;
  expiration?: number;
  ttlMs?: number;
  useCache?: boolean;
};

export async function searchSerp(terms: string, opts: SearchOptions = {}): Promise<string> {
  const params = {
    terms,
    serps: opts.serps,
    size: opts.size ?? 50,
    offset: opts.offset,
    city: opts.city,
    country: opts.country,
    language: opts.language,
    expiration: opts.expiration,
  };
  return callMassive("search", params, { ttlMs: opts.ttlMs, useCache: opts.useCache });
}

export type BrowserOptions = {
  difficulty?: "low" | "medium" | "high";
  speed?: "light" | "ridiculous" | "ludicrous";
  device?: string;
  readiness?: "load" | "domcontentloaded";
  delay?: number;
  format?: "rendered" | "raw" | "markdown";
  city?: string;
  country?: string;
  expiration?: number;
  ttlMs?: number;
  useCache?: boolean;
};

export async function browserFetch(url: string, opts: BrowserOptions = {}): Promise<string> {
  const params = {
    url,
    difficulty: opts.difficulty,
    speed: opts.speed,
    device: opts.device,
    readiness: opts.readiness ?? "domcontentloaded",
    delay: opts.delay,
    format: opts.format ?? "markdown",
    city: opts.city,
    country: opts.country,
    expiration: opts.expiration,
  };
  return callMassive("browser", params, { ttlMs: opts.ttlMs, useCache: opts.useCache });
}
