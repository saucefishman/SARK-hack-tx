// `pnpm demo`: migrate -> seed (generate files) -> reset pipeline tables -> pipeline (replay) -> start the API.
// Works on the default DATABASE_URL (pglite://./.pgdata) and is safe to rerun on an existing database.
import { migrate } from "../db/migrate";
import { getDb } from "../db/pool";
import { startServer } from "../api/server";
import { resetPipelineTables, runPipeline } from "../pipeline/run";
import { writeSeed } from "../seed/write";

const db = getDb();
console.log("demo: migrate");
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "migrations up to date");

console.log("demo: seed");
const { files, events } = writeSeed();
console.log(`seed: ${Object.keys(files).length} files, ${events} events`);

console.log("demo: pipeline (replay)");
await resetPipelineTables(db);
await runPipeline(db, { llmMode: "replay", log: console.log });

const app = await startServer(db, { llmMode: "replay" });
const stop = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
