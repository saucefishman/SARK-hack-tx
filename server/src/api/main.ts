// Server entrypoint: migrate, then listen on PORT.
import { getDb } from "../db/pool";
import { migrate } from "../db/migrate";
import { flushTraces } from "../obs/tracing";
import { startServer } from "./server";

const db = getDb();
await migrate(db);
const app = await startServer(db);
const stop = async () => {
  await app.close();
  await flushTraces();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
