import { discoverUrls } from "../src/lib/discovery";

async function main() {
  const city = process.argv[2] ?? "London";
  const country = process.argv[3] ?? "GB";
  const topic = process.argv[4] ?? "AI engineers, AI agents, hackathons";

  console.log(`[diag] discover ${city}/${country} topic="${topic}"`);
  const start = Date.now();
  const urls = await discoverUrls({ city, country, topic }, (m) => {
    const dt = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[+${dt}s] ${m}`);
  });
  console.log("---");
  console.log(`FOUND ${urls.length} luma URLs in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  const byKind = urls.reduce<Record<string, number>>((acc, u) => {
    acc[u.kind] = (acc[u.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log("BY KIND:", byKind);
  console.log("---");
  for (const u of urls) {
    console.log(`  ${u.kind.padEnd(10)} ${u.url}  (${u.source})`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
