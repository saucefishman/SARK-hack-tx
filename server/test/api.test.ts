import { FriendDetailResponse, FriendsResponse, HealthResponse, ReviewAnswerResponse, ReviewListResponse } from "@sark/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app";
import type { Db } from "../src/db/pool";
import { sourcesFromDir } from "../src/sources";
import { testDb } from "./helpers";
import { writeTempSeed } from "./tempSeed";

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await testDb();
  await db.exec(`
    INSERT INTO person (id, display_name, is_user) VALUES ('p_me','Me',true),('p_alex','Alex',false),('p_sam','Sam',false);
    INSERT INTO message (id, thread_id, sender_id, sender_name, sent_at, body) VALUES
      ('m1','t1','p_me','Me','2026-01-10T20:00:00Z','thanks for dinner'),
      ('m2','t1','p_alex','Alex','2026-01-20T12:00:00Z','sent you $30'),
      ('m3','t2','p_sam','Sam','2026-02-05T09:00:00Z','${"x".repeat(200)}');
    INSERT INTO event (id, date, description, attendee_ids, context_message_ids, is_relevant) VALUES
      ('e1','2026-01-10','Dinner','{p_me,p_alex,p_sam}','{m1}',true),
      ('e2','2026-02-05','Concert','{p_me,p_alex,p_sam}','{m3}',true);
    INSERT INTO ledger_entry (id, event_id, payer_id, beneficiary_id, amount_cents, kind, basis, evidence_message_id) VALUES
      ('l1','e1','p_me','p_alex',4000,'covered','confirmed','m1'),
      ('l2','e1','p_me','p_sam',4000,'covered','confirmed','m1'),
      ('l3',NULL,'p_alex','p_me',3000,'repayment','confirmed','m2'),
      ('l4','e2','p_sam','p_me',2500,'covered','estimated',NULL),
      ('l5','e2','p_alex','p_me',1000,'covered','assumed',NULL);
    INSERT INTO review_item (id, kind, event_id, question, option_ids, status) VALUES
      ('r1','attendees','e2','Who came to the concert?','{p_alex,p_sam}','open'),
      ('r2','payer','e1','Who paid?','{}','answered');
  `);
  app = await buildApp({ db, llmMode: "replay" });
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe("api", () => {
  it("GET /health", async () => {
    const res = await app.inject("/health");
    expect(HealthResponse.parse(res.json())).toEqual({ ok: true, llmMode: "replay" });
  });

  it("GET /friends sorted with correct totals", async () => {
    const res = await app.inject("/friends");
    const rows = FriendsResponse.parse(res.json());
    expect(rows.map((r) => r.name)).toEqual(["Sam", "Alex"]);
    expect(rows[0]).toMatchObject({ spentOnYouCents: 2500, youSpentOnThemCents: 4000, balanceCents: 1500, possibleCents: 0, eventCount: 2 });
    expect(rows[1]).toMatchObject({ spentOnYouCents: 0, youSpentOnThemCents: 4000, balanceCents: 1000, possibleCents: 1000, eventCount: 2 });
  });

  it("GET /friends/:id returns entries newest first with evidence", async () => {
    const res = await app.inject("/friends/p_alex");
    const d = FriendDetailResponse.parse(res.json());
    expect(d.friend.name).toBe("Alex");
    expect(d.entries.map((e) => e.id)).toEqual(["l5", "l1", "l3"]);
    const l1 = d.entries.find((e) => e.id === "l1")!;
    expect(l1.event?.date).toBe("2026-01-10");
    expect(l1.event?.attendees.map((a) => a.name)).toEqual(["Me", "Alex", "Sam"]);
    expect(l1.payerName).toBe("Me");
    expect(l1.beneficiaryName).toBe("Alex");
    expect(l1.evidence.map((e) => e.messageId)).toEqual(["m1"]);
    expect(l1.evidence[0].sentAt).toBe("2026-01-10T20:00:00.000Z");
    const l3 = d.entries.find((e) => e.id === "l3")!;
    expect(l3.event).toBeNull();
    expect(l3.evidence.map((e) => e.messageId)).toEqual(["m2"]);
    // context message from event, snippet truncated
    const l5 = d.entries.find((e) => e.id === "l5")!;
    expect(l5.evidence[0].snippet.length).toBeLessThanOrEqual(140);
  });

  it("GET /friends/:id 404 for unknown and for the user", async () => {
    expect((await app.inject("/friends/nope")).statusCode).toBe(404);
    expect((await app.inject("/friends/p_me")).statusCode).toBe(404);
  });

  it("GET /review lists open items only", async () => {
    const items = ReviewListResponse.parse((await app.inject("/review")).json());
    expect(items).toHaveLength(1);
    expect(items[0].options).toEqual([
      { personId: "p_alex", name: "Alex" },
      { personId: "p_sam", name: "Sam" },
    ]);
    expect(items[0].eventSummary).toContain("2026-02-05");
    expect(items[0].eventSummary).toContain("Concert");
  });

  it("POST /review/:id/answer validates, 404s, 409s, then answers", async () => {
    const post = (id: string, payload: unknown) => app.inject({ method: "POST", url: `/review/${id}/answer`, payload: payload as object });
    expect((await post("r1", { personIds: "bad" })).statusCode).toBe(400);
    expect((await post("zzz", { dismiss: true })).statusCode).toBe(404);
    expect((await post("r2", { dismiss: true })).statusCode).toBe(409);

    const res = await post("r1", { personIds: ["p_alex"] });
    expect(res.statusCode).toBe(200);
    const rows = ReviewAnswerResponse.parse(res.json());
    expect(rows.map((r) => r.personId).sort()).toEqual(["p_alex", "p_sam"]);
    const { rows: st } = await db.query<{ status: string }>("SELECT status FROM review_item WHERE id='r1'");
    expect(st[0].status).toBe("answered");
    expect((await app.inject("/review")).json()).toEqual([]);
    expect((await post("r1", { dismiss: true })).statusCode).toBe(409);
  });

  it("POST /dev/rerun runs the pipeline (replay) and returns stage counts", async () => {
    const fresh = await testDb();
    const rerunApp = await buildApp({ db: fresh, llmMode: "replay", sources: sourcesFromDir(writeTempSeed()) });
    const res = await rerunApp.inject({ method: "POST", url: "/dev/rerun" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ "ingest.persons": 5, "merge.events": 20, "ledger.repayments": 4 });
    await rerunApp.close();
    await fresh.end();
  });
});
