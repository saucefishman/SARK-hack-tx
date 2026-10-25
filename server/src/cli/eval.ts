// `pnpm eval` (BUILDPLAN Phase 7): run the pipeline in replay on a fresh seed, compare with ground truth
// (attendee accuracy, payer accuracy, per-friend balance error). Exits 1 if any friend total differs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../db/migrate";
import { createDb } from "../db/pool";
import { getFriendSummaries } from "../db/queries";
import { formatCents } from "../domain/money";
import { runPipeline } from "../pipeline/run";
import { writeSeed } from "../seed/write";
import { sourcesFromDir } from "../sources";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sark-eval-"));
const { seed } = writeSeed(tmp);
const truth = seed.truth;

const db = createDb("pglite://memory");
await migrate(db);
await runPipeline(db, { llmMode: "replay", sources: sourcesFromDir(path.join(tmp, "generated")) });

// ---- attendees + payers: match each truth event to the pipeline event on the same day with the best attendee overlap
const { rows: events } = await db.query<{ id: string; d: string; attendee_ids: string[] }>(
  "SELECT id, to_char(date,'YYYY-MM-DD') AS d, attendee_ids FROM event",
);
const { rows: payers } = await db.query<{ event_id: string; person_id: string; amount_cents: number | null; basis: string }>(
  "SELECT event_id, person_id, amount_cents, basis FROM event_payer",
);
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  return [...A].filter((x) => B.has(x)).length / new Set([...A, ...B]).size;
};
const sameSet = (a: string[], b: string[]) => a.length === new Set(b).size && a.every((x) => b.includes(x));
let attendeeOk = 0, payerOk = 0, matched = 0;
const misses: string[] = [];
for (const te of truth.events) {
  const cands = events.filter((e) => e.d === te.date).sort((a, b) => jaccard(b.attendee_ids, te.attendeeIds) - jaccard(a.attendee_ids, te.attendeeIds));
  const e = cands[0];
  if (!e) { misses.push(`${te.key}: no pipeline event on ${te.date}`); continue; }
  matched++;
  const attendeesOk = sameSet([...te.attendeeIds].sort(), [...e.attendee_ids].sort());
  const got = payers.filter((p) => p.event_id === e.id).map((p) => `${p.person_id}:${p.amount_cents}`).sort();
  const want = te.payers.map((p) => `${p.personId}:${p.amountCents}`).sort();
  const pOk = JSON.stringify(got) === JSON.stringify(want);
  if (attendeesOk) attendeeOk++; else misses.push(`${te.key}: attendees ${e.attendee_ids} != ${te.attendeeIds}`);
  if (pOk) payerOk++; else misses.push(`${te.key}: payers ${got} != ${want}`);
}
const pct = (n: number) => `${n}/${truth.events.length} (${Math.round((100 * n) / truth.events.length)}%)`;
console.log(`events matched   ${pct(matched)}`);
console.log(`attendee accuracy ${pct(attendeeOk)}`);
console.log(`payer accuracy    ${pct(payerOk)}`);
for (const m of misses) console.log(`  miss: ${m}`);

// ---- per-friend totals
const friends = await getFriendSummaries(db);
let bad = 0;
const fields = ["spentOnYouCents", "youSpentOnThemCents", "balanceCents", "possibleCents"] as const;
console.log("\nfriend     spentOnYou (got/truth)   youSpent (got/truth)   balance (got/truth)   possible (got/truth)   balance err");
for (const f of friends.sort((a, b) => a.personId.localeCompare(b.personId))) {
  const t = truth.friends[f.personId];
  const diffs = fields.filter((k) => !t || f[k] !== t[k]);
  if (diffs.length) bad++;
  const cell = (k: (typeof fields)[number]) => `${formatCents(f[k])}/${t ? formatCents(t[k]) : "?"}`.padEnd(20);
  console.log(
    `${f.name.padEnd(9)}  ${cell("spentOnYouCents")}   ${cell("youSpentOnThemCents")}   ${cell("balanceCents")}  ${cell("possibleCents")}   ${t ? formatCents(f.balanceCents - t.balanceCents) : "?"} ${diffs.length ? "MISMATCH" : "ok"}`,
  );
}
for (const id of Object.keys(truth.friends)) if (!friends.some((f) => f.personId === id)) { bad++; console.log(`${id}: missing`); }
await db.end();
fs.rmSync(tmp, { recursive: true, force: true });
if (bad) {
  console.error(`\neval FAILED: ${bad} friend(s) differ from truth`);
  process.exit(1);
}
console.log("\neval OK: every friend total equals truth exactly");
