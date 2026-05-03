import { browserFetch } from "../src/lib/massive";

async function main() {
  const url = process.argv[2] ?? "https://lu.ma/agentworldtourlondon";
  const md = await browserFetch(url, {
    format: "markdown",
    city: "London",
    country: "GB",
    readiness: "domcontentloaded",
    delay: 1.5,
  });
  console.log(`LENGTH: ${md.length}`);
  console.log(md);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
