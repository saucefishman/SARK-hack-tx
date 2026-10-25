import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate";
import { testDb } from "./helpers";

describe("migrate", () => {
  it("applies all tables and is idempotent", async () => {
    const db = await testDb();
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["person", "event", "ledger_entry", "review_item", "llm_cache", "canonical_event"]),
    );
    expect(await migrate(db)).toEqual([]);
    await db.end();
  });
});
