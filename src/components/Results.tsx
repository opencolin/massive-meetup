"use client";

import type { CalendarRecord, SearchResult } from "@/lib/types";

function csvEscape(v: string | undefined | null): string {
  if (!v) return "";
  if (/["\n,]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(calendars: CalendarRecord[]): string {
  const header = [
    "calendar_name",
    "calendar_url",
    "organizer_name",
    "organizer_handle",
    "email",
    "email_source",
    "twitter",
    "linkedin",
    "website",
    "past_events",
    "upcoming_events",
    "recurrence_score",
    "topic_score",
  ].join(",");
  const rows = calendars.map((c) =>
    [
      c.name,
      c.url,
      c.organizer?.name ?? "",
      c.organizer?.handle ?? "",
      c.organizer?.email ?? "",
      c.organizer?.emailSource ?? "",
      c.organizer?.twitter ?? "",
      c.organizer?.linkedin ?? "",
      c.organizer?.website ?? "",
      String(c.pastEvents.length),
      String(c.upcomingEvents.length),
      String(c.recurrenceScore),
      String(c.topicScore),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function downloadCsv(calendars: CalendarRecord[], filename: string) {
  const blob = new Blob([toCsv(calendars)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function Results({ result }: { result: SearchResult }) {
  const elapsed = Math.round((result.finishedAt - result.startedAt) / 1000);
  const csvName = `massive-meetup-${result.input.city.toLowerCase().replace(/\s+/g, "-")}-${result.searchId}.csv`;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {result.calendars.length} calendars · {elapsed}s · search #{result.searchId}
        </div>
        {result.calendars.length > 0 ? (
          <button
            onClick={() => downloadCsv(result.calendars, csvName)}
            className="text-sm rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            Export CSV
          </button>
        ) : null}
      </div>

      {result.calendars.length === 0 ? (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
          No matching calendars found. Check the search log below for clues.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Calendar</th>
                <th className="px-3 py-2 font-medium">Organizer</th>
                <th className="px-3 py-2 font-medium">Events</th>
                <th className="px-3 py-2 font-medium">Recur</th>
                <th className="px-3 py-2 font-medium">Topic</th>
                <th className="px-3 py-2 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody>
              {result.calendars.map((c) => (
                <tr key={c.url} className="border-t border-zinc-200 dark:border-zinc-800 align-top">
                  <td className="px-3 py-2">
                    <a href={c.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {c.name}
                    </a>
                    {c.description ? (
                      <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2 max-w-md">{c.description}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {c.organizer ? (
                      <div>
                        <div className="font-medium">{c.organizer.name ?? c.organizer.handle}</div>
                        <a
                          href={`https://lu.ma/u/${c.organizer.handle}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-zinc-500 hover:underline"
                        >
                          @{c.organizer.handle}
                        </a>
                      </div>
                    ) : (
                      <span className="text-zinc-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    <span title="past">{c.pastEvents.length}p</span> ·{" "}
                    <span title="upcoming">{c.upcomingEvents.length}u</span>
                  </td>
                  <td className="px-3 py-2">{c.recurrenceScore}</td>
                  <td className="px-3 py-2">{c.topicScore}</td>
                  <td className="px-3 py-2 text-xs space-y-0.5">
                    {c.organizer?.email ? (
                      <div>
                        <a href={`mailto:${c.organizer.email}`} className="hover:underline">
                          {c.organizer.email}
                        </a>
                        <span className="text-zinc-400 ml-1">
                          ({c.organizer.emailSource}
                          {c.organizer.emailConfidence === "low" ? ", low conf" : ""})
                        </span>
                      </div>
                    ) : null}
                    {c.organizer?.twitter ? (
                      <a href={c.organizer.twitter} target="_blank" rel="noreferrer" className="hover:underline block">
                        {c.organizer.twitter.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ) : null}
                    {c.organizer?.linkedin ? (
                      <a href={c.organizer.linkedin} target="_blank" rel="noreferrer" className="hover:underline block">
                        {c.organizer.linkedin.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ) : null}
                    {c.organizer?.website ? (
                      <a href={c.organizer.website} target="_blank" rel="noreferrer" className="hover:underline block">
                        {c.organizer.website.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer">Search log ({result.log.length} events)</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-zinc-50 dark:bg-zinc-900 p-3 leading-relaxed">
          {result.log.map((e, i) => `[${e.phase}] ${e.message}`).join("\n")}
        </pre>
      </details>
    </section>
  );
}
