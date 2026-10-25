// Test helpers: fresh in-memory PGlite with migrations applied.
import { migrate } from "../src/db/migrate";
import { createDb, type Db } from "../src/db/pool";

export async function testDb(): Promise<Db> {
  const db = createDb("pglite://memory");
  await migrate(db);
  return db;
}
