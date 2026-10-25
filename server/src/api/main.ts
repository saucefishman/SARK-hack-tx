// Server entrypoint: migrate, then listen on PORT.
import { getDb } from "../db/pool";
import { migrate } from "../db/migrate";
import { startServer } from "./server";

const db = getDb();
await migrate(db);
await startServer(db);
