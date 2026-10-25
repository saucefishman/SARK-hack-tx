// `pnpm seed [--push-nessie]`: scenario.json -> seed/generated/* + seed/truth.json.
import fs from "node:fs";
import path from "node:path";
import { getConfig, REPO_ROOT } from "../config";
import { generateSeed, seedFiles } from "../seed/generate";
import { pushNessie } from "../seed/push";
import { NessieHttpClient } from "../sources/nessie";

const seedDir = path.join(REPO_ROOT, "seed");
const scenario = JSON.parse(fs.readFileSync(path.join(seedDir, "scenario.json"), "utf8"));
const seed = generateSeed(scenario);
const files = seedFiles(seed);

fs.rmSync(path.join(seedDir, "generated"), { recursive: true, force: true });
for (const [rel, content] of Object.entries(files)) {
  const full = path.join(seedDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
console.log(
  `seed: ${Object.keys(files).length} files, ${scenario.events.length} events, ` +
    `${seed.nessie.purchases.length} purchases, ${seed.nessie.transfers.length} transfers, ` +
    `${seed.instagramThreads.length} threads, ${seed.calendar.length} calendar events`,
);

if (process.argv.includes("--push-nessie")) {
  const cfg = getConfig();
  if (!cfg.NESSIE_API_KEY) {
    console.log("--push-nessie skipped: NESSIE_API_KEY not set (human task H2). Ingest reads seed/generated/nessie.json instead.");
  } else {
    const ids = await pushNessie(seed.nessie, new NessieHttpClient(cfg.NESSIE_BASE_URL, cfg.NESSIE_API_KEY));
    console.log(`pushed ${ids.size} objects to Nessie. Note: ids differ from nessie.json; use NESSIE_SOURCE=api.`);
  }
}
