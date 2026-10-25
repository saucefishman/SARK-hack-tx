// Server entrypoint: migrate, then listen on PORT.
import { getConfig } from "../config";
import { getDb } from "../db/pool";
import { migrate } from "../db/migrate";
import { buildApp } from "./app";

const db = getDb();
await migrate(db);
const app = await buildApp({ db });
const { PORT } = getConfig();
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`API listening on :${PORT}`);
