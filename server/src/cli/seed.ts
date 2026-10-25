// `pnpm seed [--push-nessie]`: scenario.json -> seed/generated/* + seed/truth.json.
import { getConfig } from "../config";
import { writeSeed } from "../seed/write";
import { pushNessie } from "../seed/push";
import { NessieHttpClient } from "../sources/nessie";

const { seed, files, events } = writeSeed();
console.log(
  `seed: ${Object.keys(files).length} files, ${events} events, ` +
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
