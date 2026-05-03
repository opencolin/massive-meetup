import type { CalendarRecord } from "./types";

const RECURRENCE_PATTERNS = /\b(weekly|biweekly|monthly|recurring|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|series)\b/i;

export function scoreRecurrence(
  c: Pick<CalendarRecord, "name" | "pastEvents" | "upcomingEvents" | "discoveredFrom">,
): number {
  // Primary signal: how many distinct event pages from discovery resolved to this calendar.
  // Two events sharing a parent = evidence of recurrence.
  const pageHits = c.discoveredFrom.length;
  const totalEvents = c.pastEvents.length + c.upcomingEvents.length;
  let score = 0;
  if (pageHits >= 3) score += 60;
  else if (pageHits >= 2) score += 35;
  else score += 10;
  if (totalEvents >= 5) score += 25;
  else if (totalEvents >= 3) score += 15;
  else if (totalEvents >= 1) score += 5;
  if (RECURRENCE_PATTERNS.test(c.name)) score += 15;
  return Math.min(score, 100);
}

export function topicTerms(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[,;/]|\band\b/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

export function scoreTopic(
  c: Pick<CalendarRecord, "name" | "description" | "pastEvents" | "upcomingEvents">,
  topic: string,
): number {
  const terms = topicTerms(topic);
  if (terms.length === 0) return 50;
  const haystack = [
    c.name,
    c.description ?? "",
    ...c.pastEvents.map((e) => e.title),
    ...c.upcomingEvents.map((e) => e.title),
  ]
    .join(" ")
    .toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (haystack.includes(t)) hits++;
  }
  return Math.round((hits / terms.length) * 100);
}
