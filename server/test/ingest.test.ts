import path from "node:path";
import { describe, expect, it } from "vitest";
import { ingest, normAlias, resolvePerson, type IngestSources } from "../src/pipeline/ingest";
import { FileCalendarSource } from "../src/sources/calendar";
import { InstagramMessageSource } from "../src/sources/instagram";
import { NessieFileSource } from "../src/sources/nessie";
import { FilePeopleSource } from "../src/sources/people";
import type { MessageSource, RawMessage } from "../src/sources/types";
import { testDb } from "./helpers";
import { writeTempSeed } from "./tempSeed";

function fileSources(dir: string, messages?: MessageSource): IngestSources {
  return {
    people: new FilePeopleSource(path.join(dir, "people.json")),
    messages: messages ?? new InstagramMessageSource(path.join(dir, "instagram")),
    calendar: new FileCalendarSource(path.join(dir, "calendar.json")),
    nessie: new NessieFileSource(path.join(dir, "nessie.json")),
  };
}

const n = async (db: Awaited<ReturnType<typeof testDb>>, table: string) =>
  Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

describe("ingest", () => {
  const dir = writeTempSeed();

  it("loads the seed, counts match, and a rerun changes nothing", async () => {
    const db = await testDb();
    const counts = await ingest(db, fileSources(dir));
    expect(counts).toMatchObject({ persons: 5, calendarEvents: 12, txns: 15, aliasReviews: 0 });
    expect(await n(db, "person")).toBe(5);
    expect(await n(db, "calendar_event")).toBe(12);
    expect(await n(db, "txn")).toBe(15);
    expect(await n(db, "message")).toBe(counts.messages);
    expect(counts.messages).toBeGreaterThan(60);
    expect(await n(db, "review_item")).toBe(0);
    expect((await db.query("SELECT 1 FROM message WHERE sender_id IS NULL")).rows).toHaveLength(0);

    const snap = async () => JSON.stringify([
      (await db.query("SELECT * FROM message ORDER BY id")).rows,
      (await db.query("SELECT * FROM txn ORDER BY id")).rows,
      (await db.query("SELECT * FROM calendar_event ORDER BY id")).rows,
      (await db.query("SELECT * FROM person_alias ORDER BY kind, value")).rows,
    ]);
    const before = await snap();
    const again = await ingest(db, fileSources(dir));
    expect(again).toEqual(counts);
    expect(await snap()).toBe(before);
  });

  it("maps txns: dollars to cents, merchant joined, transfers keyed to sender", async () => {
    const db = await testDb();
    await ingest(db, fileSources(dir));
    const uchi = (await db.query<Record<string, unknown>>("SELECT * FROM txn WHERE nessie_id = 'pur_s01-uchi-dinner'")).rows[0];
    expect(uchi).toMatchObject({ kind: "purchase", amount_cents: 12000, merchant: "Uchi", merchant_category: "restaurant", payer_id: "p_me" });
    const rows = (await db.query<{ payer_id: string; description: string; amount_cents: number }>(
      "SELECT payer_id, description, amount_cents FROM txn WHERE kind = 'transfer' ORDER BY nessie_id")).rows;
    expect(rows).toEqual([
      { payer_id: "p_sam", description: "Sam - Uchi dinner", amount_cents: 3000 },
      { payer_id: "p_me", description: "Paying Sam back for Lenoir", amount_cents: 2800 },
    ]);
  });

  it("resolves calendar attendees by email and by name only, and nicknames in messages", async () => {
    const db = await testDb();
    await ingest(db, fileSources(dir));
    const cal = (await db.query<{ attendee_ids: string[] }>("SELECT attendee_ids FROM calendar_event WHERE id = 'cal_s12-nickname-burgers'")).rows[0];
    expect([...cal.attendee_ids].sort()).toEqual(["p_jordan", "p_me", "p_riley"]);
    const riles = (await db.query<{ sender_id: string }>("SELECT sender_id FROM message WHERE sender_name = 'Riles' LIMIT 1")).rows[0];
    expect(riles.sender_id).toBe("p_riley");
    expect(await resolvePerson(db, "nickname", "  RILES ")).toBe("p_riley");
    expect(await resolvePerson(db, ["email", "display_name"], "Alex")).toBe("p_alex");
    expect(await resolvePerson(db, "display_name", "Nobody")).toBeNull();
    expect(normAlias("  Riley   Nakamura ")).toBe("riley nakamura");
  });

  it("unknown sender becomes a candidate alias and one review item (idempotent)", async () => {
    const db = await testDb();
    const stranger: RawMessage = {
      id: "t:1:0", threadId: "t", threadTitle: "T", participants: ["Me", "Pat Quinn"], senderName: "Pat Quinn",
      timestampMs: Date.UTC(2026, 8, 1), content: "hello",
    };
    const msgs: MessageSource = { async *listMessages() { yield stranger; } };
    const counts = await ingest(db, fileSources(dir, msgs));
    expect(counts.aliasReviews).toBe(1);
    await ingest(db, fileSources(dir, msgs));
    const alias = (await db.query<{ person_id: string | null; status: string }>("SELECT person_id, status FROM person_alias WHERE value = 'pat quinn'")).rows;
    expect(alias).toEqual([{ person_id: null, status: "candidate" }]);
    const reviews = (await db.query<{ kind: string; status: string; option_ids: string[] }>("SELECT kind, status, option_ids FROM review_item")).rows;
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ kind: "alias", status: "open" });
    expect(reviews[0].option_ids).toContain("p_alex");
    expect((await db.query<{ sender_id: string | null }>("SELECT sender_id FROM message")).rows).toEqual([{ sender_id: null }]);
  });
});
