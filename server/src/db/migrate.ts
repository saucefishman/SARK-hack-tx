// Applies server/migrations/*.sql in filename order; tracks them in schema_migrations.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./pool";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, f), "utf8");
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}
