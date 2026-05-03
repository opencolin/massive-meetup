export type Geo = {
  city: string;
  country: string;
};

export type SearchInput = {
  city: string;
  country: string;
  topic: string;
};

export type LumaUrlKind = "calendar" | "event" | "user" | "discover" | "unknown";

export type DiscoveredUrl = {
  url: string;
  kind: LumaUrlKind;
  source: "ai" | "search";
  prompt?: string;
  query?: string;
  citedFrom?: string;
  hits: number;
};

export type Organizer = {
  handle: string;
  name?: string;
  bio?: string;
  twitter?: string;
  linkedin?: string;
  website?: string;
  email?: string;
  emailSource?: "luma" | "ai" | "website";
  emailConfidence?: "high" | "low";
};

export type LumaEvent = {
  url: string;
  title: string;
  date?: string;
};

export type CalendarRecord = {
  url: string;
  name: string;
  description?: string;
  organizer?: Organizer;
  organizers?: Organizer[];
  pastEvents: LumaEvent[];
  upcomingEvents: LumaEvent[];
  /** Original candidate URLs from discovery that resolved to this calendar — strongest recurrence signal. */
  discoveredFrom: string[];
  recurrenceScore: number;
  topicScore: number;
  rawMarkdown?: string;
};

export type ProgressEvent = {
  ts: number;
  phase: "discover" | "classify" | "enrich-calendar" | "enrich-organizer" | "score" | "done";
  message: string;
};

export type SearchResult = {
  searchId: number;
  input: SearchInput;
  calendars: CalendarRecord[];
  log: ProgressEvent[];
  startedAt: number;
  finishedAt: number;
};
