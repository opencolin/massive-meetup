"use client";

import { useActionState } from "react";
import { runSearch, type ActionState } from "@/app/actions";
import { Results } from "./Results";

const initial: ActionState = { status: "idle" };

const COUNTRIES = [
  { code: "GB", label: "United Kingdom" },
  { code: "US", label: "United States" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "NL", label: "Netherlands" },
  { code: "CA", label: "Canada" },
  { code: "IN", label: "India" },
  { code: "SG", label: "Singapore" },
  { code: "AU", label: "Australia" },
];

export function SearchForm() {
  const [state, formAction, pending] = useActionState(runSearch, initial);

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Massive Meetup</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Find recurring Luma calendars in a city + topic, with organizer contacts. Powered by Massive Web Render.
        </p>
      </header>

      <form action={formAction} className="grid gap-4 sm:grid-cols-[1fr_120px_2fr_auto] items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-700 dark:text-zinc-300">City</span>
          <input
            name="city"
            defaultValue="London"
            required
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-700 dark:text-zinc-300">Country</span>
          <select
            name="country"
            defaultValue="GB"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-700 dark:text-zinc-300">Topic</span>
          <input
            name="topic"
            defaultValue="AI engineers, AI agents, hackathons"
            required
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-black text-white dark:bg-white dark:text-black px-5 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Searching…" : "Find calendars"}
        </button>
      </form>

      {pending ? (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
          Running discovery + enrichment. This can take 1–3 minutes — fanning out across Massive&apos;s <code>/ai</code>, <code>/search</code>, and <code>/browser</code> endpoints.
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          {state.message}
        </div>
      ) : null}

      {state.status === "ok" ? <Results result={state.result} /> : null}
    </div>
  );
}
