import { discoverUrls } from "../src/lib/discovery";
import { enrichAll } from "../src/lib/enrich";
import type { SearchInput } from "../src/lib/types";

async function main() {
  const city = process.argv[2] ?? "London";
  const country = process.argv[3] ?? "GB";
  const topic = process.argv[4] ?? "AI engineers, AI agents, hackathons";
  const cap = Number(process.argv[5] ?? "12");
  const input: SearchInput = { city, country, topic };

  console.log(`[full] ${city}/${country} topic="${topic}" cap=${cap}`);
  const t0 = Date.now();

  const urls = await discoverUrls(input, (m) => console.log(`  [discover] ${m}`));
  console.log(`[full] discovered ${urls.length} URLs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const candidates = urls
    .filter((u) => u.kind === "event" || u.kind === "calendar")
    .sort((a, b) => b.hits - a.hits)
    .slice(0, cap)
    .map((u) => u.url);

  console.log(`[full] enriching ${candidates.length} candidates`);
  const t1 = Date.now();
  const calendars = await enrichAll(candidates, input, (m) => console.log(`  [enrich] ${m}`));
  console.log(`[full] enriched in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  calendars.sort((a, b) => b.recurrenceScore + b.topicScore - (a.recurrenceScore + a.topicScore));

  console.log(`\n=== ${calendars.length} unique calendars ===`);
  for (const c of calendars) {
    console.log(`\n${c.name}  (${c.url})`);
    console.log(`  recur=${c.recurrenceScore} topic=${c.topicScore} events=${c.pastEvents.length}p+${c.upcomingEvents.length}u`);
    if (c.organizer) {
      const o = c.organizer;
      console.log(
        `  org: ${o.name ?? o.handle}` +
          (o.email ? ` <${o.email}>(${o.emailSource ?? ""}, ${o.emailConfidence ?? ""})` : "") +
          (o.twitter ? ` | tw:${o.twitter.replace(/^https?:\/\/(www\.)?/, "")}` : "") +
          (o.linkedin ? ` | li:${o.linkedin.replace(/^https?:\/\/(www\.)?/, "")}` : "") +
          (o.website ? ` | web:${o.website.replace(/^https?:\/\/(www\.)?/, "")}` : ""),
      );
    }
    if (c.description) console.log(`  desc: ${c.description.slice(0, 140)}`);
  }
  console.log(`\n[full] total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
