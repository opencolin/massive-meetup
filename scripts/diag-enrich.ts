import { fetchPage, groupByCalendar, enrichOrganizer } from "../src/lib/enrich";
import type { SearchInput } from "../src/lib/types";

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: tsx scripts/diag-enrich.ts <url1> <url2> ...");
    process.exit(1);
  }
  const input: SearchInput = {
    city: "London",
    country: "GB",
    topic: "AI engineers, AI agents, hackathons",
  };
  console.log(`fetching ${urls.length} pages...`);
  const t0 = Date.now();
  const pages = [];
  for (const url of urls) {
    const t = Date.now();
    const p = await fetchPage(url, input);
    if (!p) {
      console.log(`  SKIP ${url} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
      continue;
    }
    console.log(
      `  ${p.pageType.padEnd(8)} ${url}  → calendar=${p.calendarUrl} (hosts=${p.organizers.length}, evts=${p.pastEvents.length}p+${p.upcomingEvents.length}u, ${((Date.now() - t) / 1000).toFixed(1)}s)`,
    );
    pages.push(p);
  }
  console.log(`fetched ${pages.length} pages in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const records = groupByCalendar(pages, input);
  console.log(`=== ${records.length} unique calendars ===`);
  for (const r of records) {
    console.log(`\n${r.name}  (${r.url})`);
    console.log(`  recurrence=${r.recurrenceScore} topic=${r.topicScore}`);
    console.log(`  events: ${r.pastEvents.length}p + ${r.upcomingEvents.length}u`);
    if (r.organizer) console.log(`  organizer: ${r.organizer.name} @${r.organizer.handle}`);
    if (r.description) console.log(`  desc: ${r.description.slice(0, 120)}`);
  }

  // Enrich the top 1 organizer for a quick sanity check
  const top = records.find((r) => r.organizer);
  if (top && top.organizer) {
    console.log(`\n=== enriching organizer for ${top.name} ===`);
    const org = await enrichOrganizer(top.organizer, top.name, input);
    console.log(`  name: ${org.name}`);
    console.log(`  bio: ${org.bio?.slice(0, 120) ?? "-"}`);
    console.log(`  twitter: ${org.twitter ?? "-"}`);
    console.log(`  linkedin: ${org.linkedin ?? "-"}`);
    console.log(`  website: ${org.website ?? "-"}`);
    console.log(`  email: ${org.email ?? "-"} (${org.emailSource ?? "-"}, ${org.emailConfidence ?? "-"})`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
