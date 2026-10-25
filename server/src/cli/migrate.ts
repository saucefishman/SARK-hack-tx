import { migrate } from "../db/migrate";
import { getDb } from "../db/pool";

const db = getDb();
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "migrations up to date");
await db.end();
