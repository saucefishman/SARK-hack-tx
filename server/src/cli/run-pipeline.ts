// `pnpm pipeline [--from <stage>] [--llm replay|live]`: migrate, then run the pipeline and log counts per stage.
import { getConfig } from "../config";
import { migrate } from "../db/migrate";
import { getDb } from "../db/pool";
import { runPipeline, STAGES, type Stage } from "../pipeline/run";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const from = arg("from") as Stage | undefined;
const llm = arg("llm");
if (from && !STAGES.includes(from)) throw new Error(`--from must be one of ${STAGES.join(", ")}`);
if (llm && llm !== "replay" && llm !== "live") throw new Error("--llm must be replay or live");

const db = getDb();
await migrate(db);
const llmMode = (llm as "live" | "replay" | undefined) ?? getConfig().LLM_MODE;
console.log(`pipeline: from=${from ?? "ingest"} llm=${llmMode}`);
await runPipeline(db, { from, llmMode, log: console.log });
await db.end();
