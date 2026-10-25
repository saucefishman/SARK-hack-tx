// Main correctness gate (BUILDPLAN Phase 4/9): seed -> pipeline (replay fixtures) -> equals seed/truth.json in cents.
import { USER_ID } from "@sark/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSeed } from "../src/seed/generate";
import { getFriendSummaries, listLedgerEntries, listOpenReviewItems } from "../src/db/queries";
import type { Db } from "../src/db/pool";
import { applyReviewAnswer } from "../src/pipeline/review";
import { runPipeline } from "../src/pipeline/run";
import { loadScenario } from "../src/seed/write";
import { sourcesFromDir } from "../src/sources";
import { testDb } from "./helpers";
import { writeTempSeed } from "./tempSeed";

const truth = generateSeed(loadScenario()).truth;
const dir = writeTempSeed();
const run = (db: Db, from?: "merge") => runPipeline(db, { llmMode: "replay", sources: sourcesFromDir(dir), from });
const totals = async (db: Db) =>
  Object.fromEntries((await getFriendSummaries(db)).map((f) => [f.personId, {
    spentOnYouCents: f.spentOnYouCents, youSpentOnThemCents: f.youSpentOnThemCents, balanceCents: f.balanceCents, possibleCents: f.possibleCents,
  }]));
const snapshot = async (db: Db) =>
  JSON.stringify({
    ledger: await listLedgerEntries(db),
    events: (await db.query("SELECT * FROM event ORDER BY id")).rows,
    payers: (await db.query("SELECT * FROM event_payer ORDER BY event_id, person_id")).rows,
    review: (await db.query("SELECT id, kind, status, event_id, txn_id FROM review_item ORDER BY id")).rows,
  });

describe("pipeline vs truth.json", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
    await run(db);
  });

  it("per-friend totals equal truth exactly (cents)", async () => {
    expect(await totals(db)).toEqual(truth.friends);
  });

  it("no unaccounted rows; relevant events match truth", async () => {
    expect(truth.unaccountedCents).toBe(0);
    expect((await listLedgerEntries(db)).filter((e) => e.kind === "unaccounted")).toEqual([]);
    const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM event WHERE is_relevant");
    expect(Number(rows[0].n)).toBe(truth.events.filter((e) => e.relevant).length);
  });

  it("open review items match truth.reviewItems", async () => {
    const open = await db.query<{ kind: string; txn_id: string | null; description: string; payer_basis: string | null }>(
      `SELECT r.kind, r.txn_id, e.description, (SELECT string_agg(basis, ',') FROM event_payer WHERE event_id = e.id) AS payer_basis
       FROM review_item r LEFT JOIN event e ON e.id = r.event_id WHERE r.status = 'open' ORDER BY r.kind`,
    );
    expect(open.rows.map((r) => r.kind).sort()).toEqual(truth.reviewItems.map((r) => r.kind).sort());
    const att = open.rows.find((r) => r.kind === "attendees")!;
    expect(att.txn_id).toBe(`txn_${truth.reviewItems.find((r) => r.kind === "attendees")!.nessieId}`);
    expect(open.rows.find((r) => r.kind === "payer")!.payer_basis).toBe("assumed");
    expect(await listOpenReviewItems(db)).toHaveLength(2);
  });

  it("explicit amounts are confirmed, no-amount payer is estimated from history, concert is assumed", async () => {
    const { rows } = await db.query<{ description: string; person_id: string; amount_cents: number; basis: string }>(
      `SELECT e.description, p.person_id, p.amount_cents, p.basis FROM event_payer p JOIN event e ON e.id = p.event_id
       WHERE p.person_id <> 'p_me' ORDER BY e.date, p.person_id`,
    );
    const by = (d: string) => rows.filter((r) => r.description.includes(d));
    expect(by("Ember")).toEqual([expect.objectContaining({ person_id: "p_jordan", amount_cents: 7200, basis: "estimated" })]);
    expect(by("concert")).toEqual([expect.objectContaining({ person_id: "p_alex", amount_cents: 30000, basis: "assumed" })]);
    expect(by("Lenoir")).toEqual([expect.objectContaining({ person_id: "p_sam", amount_cents: 8400, basis: "confirmed" })]);
  });

  it("no-amount payers with no purchase history: RAG price message (Sam) and web fixture (Alex) give estimated totals", async () => {
    const { rows } = await db.query<{ description: string; person_id: string; amount_cents: number; basis: string; evidence_message_id: string | null }>(
      `SELECT e.description, p.person_id, p.amount_cents, p.basis, p.evidence_message_id FROM event_payer p JOIN event e ON e.id = p.event_id
       WHERE e.description LIKE 'Karaoke%' OR e.description LIKE 'Kayaking%' ORDER BY e.date`,
    );
    // $20 a head (Alex, earlier thread) x 3 attendees; the cited receipt is that price message, not the "on me" message
    expect(rows[0]).toMatchObject({ person_id: "p_sam", amount_cents: 6000, basis: "estimated", evidence_message_id: "weekendcrew_weekend1:1789995840000:1" });
    // $25 per person (webCost fixture) x 2 attendees
    expect(rows[1]).toMatchObject({ person_id: "p_alex", amount_cents: 5000, basis: "estimated" });
    expect(rows).toHaveLength(2);
    const led = await db.query<{ amount_cents: number; basis: string; evidence_message_id: string | null }>(
      "SELECT amount_cents, basis, evidence_message_id FROM ledger_entry WHERE payer_id = 'p_sam' AND beneficiary_id = 'p_me' AND basis = 'estimated'",
    );
    expect(led.rows).toEqual([{ amount_cents: 2000, basis: "estimated", evidence_message_id: "weekendcrew_weekend1:1789995840000:1" }]);
  });

  it("scenario 11 distractor amounts do not change the taco night total; lunch and dinner stay separate", async () => {
    const { rows } = await db.query<{ description: string; total_cents: number }>(
      "SELECT description, total_cents FROM event WHERE date IN ('2026-08-09','2026-08-01') ORDER BY date, description",
    );
    expect(Object.fromEntries(rows.map((r) => [r.description, r.total_cents]))).toEqual({
      "Lunch at Torchy's Tacos": 4500,
      "Dinner at Franklin BBQ": 6000,
      "Tacos at Torchy's": 4800,
    });
  });

  it("repayments: message and Nessie transfer each counted once", async () => {
    const reps = (await listLedgerEntries(db)).filter((e) => e.kind === "repayment");
    expect(reps).toHaveLength(truth.repayments.length);
    const sum = (via: "message" | "nessie") =>
      reps.filter((r) => (via === "nessie") === !!r.txnId).reduce((s, r) => s + r.amountCents, 0);
    expect(sum("message")).toBe(truth.repayments.filter((r) => r.via === "message").reduce((s, r) => s + r.amountCents, 0));
    expect(sum("nessie")).toBe(truth.repayments.filter((r) => r.via === "nessie").reduce((s, r) => s + r.amountCents, 0));
  });

  it("rerunning the pipeline is idempotent (and so is rerunning from merge)", async () => {
    const before = await snapshot(db);
    await run(db);
    expect(await snapshot(db)).toBe(before);
    await run(db, "merge");
    expect(await snapshot(db)).toBe(before);
  });
});

describe("review answers re-run only the affected event", () => {
  it("confirming the concert payer moves possible into spentOnYou and balance", async () => {
    const db = await testDb();
    await run(db);
    const before = (await totals(db)) as Record<string, { spentOnYouCents: number; balanceCents: number; possibleCents: number }>;
    expect(before.p_alex.possibleCents).toBe(7500);
    const item = (await listOpenReviewItems(db)).find((r) => r.kind === "payer")!;
    expect(item.question).toContain("Alex");
    const affected = await applyReviewAnswer(db, item.id, { payerId: "p_alex" });
    expect(affected).toContain("p_alex");
    const after = (await totals(db)) as typeof before;
    expect(after.p_alex.possibleCents).toBe(0);
    expect(after.p_alex.spentOnYouCents).toBe(before.p_alex.spentOnYouCents + 7500);
    expect(after.p_alex.balanceCents).toBe(before.p_alex.balanceCents - 7500);
    expect(after.p_sam).toEqual(before.p_sam);
    expect(await listOpenReviewItems(db).then((r) => r.some((x) => x.kind === "payer"))).toBe(false);
    // survives a pipeline rerun
    const snap = await snapshot(db);
    await run(db);
    expect(await snapshot(db)).toBe(snap);
  });

  it("a different payer replaces the assumed rows", async () => {
    const db = await testDb();
    await run(db);
    const item = (await listOpenReviewItems(db)).find((r) => r.kind === "payer")!;
    await applyReviewAnswer(db, item.id, { payerId: "p_riley" });
    const t = (await totals(db)) as Record<string, { spentOnYouCents: number; possibleCents: number }>;
    expect(t.p_alex.possibleCents).toBe(0);
    expect(t.p_alex.spentOnYouCents).toBe(truth.friends.p_alex.spentOnYouCents);
    expect(t.p_riley.spentOnYouCents).toBe(truth.friends.p_riley.spentOnYouCents + 7500);
    const { rows } = await db.query("SELECT 1 FROM ledger_entry WHERE basis = 'assumed'");
    expect(rows).toHaveLength(0);
  });

  it("answering the s10 attendees item adds ledger rows (equal split, user paid)", async () => {
    const db = await testDb();
    await run(db);
    const item = (await listOpenReviewItems(db)).find((r) => r.kind === "attendees")!;
    expect(item.question).toContain("$70.00");
    const affected = await applyReviewAnswer(db, item.id, { personIds: ["p_alex", "p_sam"] });
    expect(affected.sort()).toEqual(["p_alex", "p_sam"]);
    const { rows } = await db.query<{ beneficiary_id: string; amount_cents: number; basis: string }>(
      `SELECT l.beneficiary_id, l.amount_cents, l.basis FROM ledger_entry l JOIN event e ON e.id = l.event_id
       WHERE e.description LIKE 'Kemuri%' ORDER BY l.beneficiary_id`,
    );
    // 7000 / 3 -> 2334 + 2333 + 2333, largest remainder, ties by id: alex gets the extra cent
    expect(rows).toEqual([
      { beneficiary_id: "p_alex", amount_cents: 2334, basis: "confirmed" },
      { beneficiary_id: "p_sam", amount_cents: 2333, basis: "confirmed" },
    ]);
    const t = (await totals(db)) as Record<string, { youSpentOnThemCents: number }>;
    expect(t.p_alex.youSpentOnThemCents).toBe(truth.friends.p_alex.youSpentOnThemCents + 2334);
    expect(t.p_riley.youSpentOnThemCents).toBe(truth.friends.p_riley.youSpentOnThemCents);
    const snap = await snapshot(db);
    await run(db);
    expect(await snapshot(db)).toBe(snap);
  });

  it("dismissing attendees keeps the event out of the ledger; dismissing payer drops the guess", async () => {
    const db = await testDb();
    await run(db);
    for (const kind of ["attendees", "payer"] as const) {
      const item = (await listOpenReviewItems(db)).find((r) => r.kind === kind)!;
      await applyReviewAnswer(db, item.id, { dismiss: true });
    }
    const t = (await totals(db)) as Record<string, { possibleCents: number; youSpentOnThemCents: number }>;
    expect(t.p_alex.possibleCents).toBe(0);
    expect(t.p_alex.youSpentOnThemCents).toBe(truth.friends.p_alex.youSpentOnThemCents);
    expect(await listOpenReviewItems(db)).toEqual([]);
  });

  it("alias answer attaches the candidate alias to the person", async () => {
    const db = await testDb();
    await run(db);
    await db.query("INSERT INTO person_alias (person_id, kind, value, status) VALUES (NULL, 'display_name', 'jt reyes', 'candidate')");
    await db.query("INSERT INTO message (id, thread_id, sender_id, sender_name, sent_at, body) VALUES ('mx','t',NULL,'JT Reyes','2026-09-01T00:00:00Z','hi')");
    await db.query(
      "INSERT INTO review_item (id, kind, question, option_ids) VALUES ('rv_a','alias','Who is \"JT Reyes\"? Seen as a sender.','{p_jordan}')",
    );
    const affected = await applyReviewAnswer(db, "rv_a", { payerId: "p_jordan" });
    expect(affected).toEqual(["p_jordan"]);
    expect((await db.query("SELECT person_id, status FROM person_alias WHERE value = 'jt reyes'")).rows).toEqual([{ person_id: "p_jordan", status: "confirmed" }]);
    expect((await db.query("SELECT sender_id FROM message WHERE id = 'mx'")).rows).toEqual([{ sender_id: "p_jordan" }]);
    expect(USER_ID).toBe("p_me");
  });
});
