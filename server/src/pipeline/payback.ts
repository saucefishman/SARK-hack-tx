// Payback stage (DESIGN §15/§16): for each friend the user owes, find ways to settle by spending on them.
//   P0 debts       ledger -> friends with balance < 0 (assumed/"possible" rows never count)
//   P1 plans       future events from the calendar AND from chat (planFinder), deduped -> future_event + planned candidates
//   P3 discover    SerpAPI search for new ideas, novel to the pair                       -> price_quote + discovered candidates
//   P2 patterns    past relevant events with the friend, recurring (the fallback)         -> recurring_pattern + recurring candidates
//   P4 price       every option becomes the FRIEND's share via splitEvent (hypothetical "user paid" event)
//   P5 solve       domain/payback.ts picks bundles                                        -> payback_suggestion
// Priority (DESIGN §15.3): planned and discovered share the top tier (new things to do together); recurring is the fallback.
// Reads the ledger, writes only its own tables, so it can never change a balance. The only LLM call is planFinder (cached, replayable).
// TODO(stub): interests-llm - new-idea queries come from merchant categories, not from Muse Spark reading the pair's messages.
// TODO(stub): activityLabel - activity keys are merchant names or normalized descriptions, not LLM labels.
import { USER_ID, type PaybackItem, type PaybackResponse } from "@sark/shared";
import { getAsOf, getConfig } from "../config";
import type { Db } from "../db/pool";
import { friendTotals } from "../domain/balance";
import { medianCents } from "../domain/estimateBaseCost";
import { stableId } from "../domain/ids";
import { acceptMessagePlan, mergePlans, type AcceptedPlan, type PlanSource } from "../domain/plans";
import { isNovel, solvePayback, TRUST, type PaybackConfig, type PaybackOption } from "../domain/payback";
import { addDays, detectPatterns, type Occurrence } from "../domain/recurrence";
import { eventsFromSerp, placesFromSerp, resolveMonthDay, type PricedPlace } from "../domain/serpPrice";
import { splitEvent } from "../domain/split";
import { cachedSerp, defaultSerpClient, SerpBudgetExceeded, SerpReplayMiss, type SerpApiClient, type SerpEngine } from "../sources/serpapi";
import { listLedgerEntries } from "../db/queries";
import { generateStructured, planFinder, type GenerateOptions, type PlanFinderInput } from "../llm";
import { mapLimit } from "../util/mapLimit";

export interface PaybackCounts {
  debtors: number;
  /** Calendar plans + chat plans that became planned candidates' source rows (after dedupe). */
  plans: number;
  /** planFinder calls (one per recent thread a debtor is in) and plans they proposed that code rejected. */
  planCalls: number;
  planRejected: number;
  patterns: number;
  discovered: number;
  candidates: number;
  suggestions: number;
  serpCalls: number;
  serpMisses: number;
}

export interface PaybackRunOptions {
  asOf?: string;
  /** Default: replay/live by SERPAPI_MODE. Tests inject. */
  serp?: SerpApiClient;
  /** planFinder's LLM mode and client overrides, as for the other LLM stages. */
  llmMode?: GenerateOptions["mode"];
  llm?: GenerateOptions;
  log?: (line: string) => void;
}

/** Chat plans are looked for in messages from this many days before asOf. */
const PLAN_WINDOW_DAYS = 30;
/** Most SerpAPI ideas kept per friend, interleaved across queries so one query can't crowd out the rest. */
const MAX_DISCOVERED = 6;
/** Results taken from each SerpAPI query before the novelty filter. */
const PER_QUERY = 3;

const STOP = new Set(["a", "an", "the", "at", "of", "for", "with", "and", "on", "in", "to", "my", "our"]);
const SHOW = /entertainment|concert|music|show|comedy|theat|event/i;
const STATED_PER_PERSON = /\$(\d+(?:\.\d{1,2})?)\s*(?:each|per person|pp|a head|\/person|\/pp)/i;
const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const range = (lo: number, hi: number) => (lo === hi ? money(lo) : `${money(lo)}-${money(hi)}`);
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

interface PastEvent {
  id: string;
  date: string;
  description: string;
  attendeeIds: string[];
  totalCents: number | null;
  merchant: string | null;
  category: string | null;
  key: string;
  perPersonCents: number | null;
}

/** Merchant if the event has one, else a known merchant named in its description, else the description's content words. */
export function activityKey(merchant: string | null, description: string, knownMerchants: string[]): string {
  if (merchant) return merchant.toLowerCase();
  const d = description.toLowerCase();
  const hit = [...knownMerchants].sort((a, b) => b.length - a.length).find((m) => d.includes(m.toLowerCase()));
  if (hit) return hit.toLowerCase();
  return d.match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)).join(" ") || d;
}

async function loadPastEvents(db: Db): Promise<PastEvent[]> {
  const { rows } = await db.query<{
    id: string; d: string; description: string; attendee_ids: string[]; total_cents: number | null; merchant: string | null; category: string | null;
  }>(
    `SELECT e.id, to_char(e.date,'YYYY-MM-DD') AS d, e.description, e.attendee_ids, e.total_cents, t.merchant, t.merchant_category AS category
     FROM event e LEFT JOIN txn t ON t.id = e.anchor_txn_id WHERE e.is_relevant ORDER BY e.date, e.id`,
  );
  const { rows: ms } = await db.query<{ merchant: string; merchant_category: string | null }>(
    "SELECT DISTINCT merchant, merchant_category FROM txn WHERE merchant IS NOT NULL AND kind = 'purchase'",
  );
  const known = ms.map((m) => m.merchant);
  const categoryOf = new Map(ms.map((m) => [m.merchant.toLowerCase(), m.merchant_category]));
  return rows.map((r) => {
    const key = activityKey(r.merchant, r.description, known);
    return {
      id: r.id, date: r.d, description: r.description, attendeeIds: r.attendee_ids, totalCents: r.total_cents, merchant: r.merchant,
      category: r.category ?? categoryOf.get(key) ?? null, key,
      perPersonCents: r.total_cents && r.attendee_ids.length ? Math.round(r.total_cents / r.attendee_ids.length) : null,
    };
  });
}

/**
 * What a single friend's share of an outing costs if the user pays the whole bill: runs the same split as the ledger on a
 * hypothetical "user paid" event, so rounding matches everywhere.
 */
export function friendShareCents(perPersonCents: number, headcount: number, friendId: string): number {
  const n = Math.max(2, headcount);
  const attendeeIds = [USER_ID, friendId, ...Array.from({ length: n - 2 }, (_, i) => `_guest${i}`)];
  return splitEvent({ attendeeIds, payers: [{ personId: USER_ID, amountCents: perPersonCents * n }], onlyTouching: null }).shareCents[friendId] ?? 0;
}

interface Candidate {
  id: string;
  friendId: string;
  kind: "planned" | "recurring" | "discovered";
  refId: string;
  title: string;
  date: string | null;
  headcount: number;
  lowCents: number;
  highCents: number;
  basis: "confirmed" | "estimated";
  confidence: number;
  trust: number;
  activityKey: string | null;
  url: string | null;
  evidence: string;
}

const candId = (friendId: string, kind: string, ref: string) => stableId("pc", friendId, kind, ref);

interface ChatPlan extends AcceptedPlan {
  ref: string;
  threadId: string;
  /** Snippet of the first message that established the plan. */
  snippet: string;
}

/**
 * planFinder over recent chats (DESIGN §15.3 A). One LLM call per thread that has a message in the window AND a debtor as a
 * sender (no debtor, no payback, no call). The model proposes; `acceptMessagePlan` decides (future date, in horizon, not paid by
 * a friend, cites real messages). Returns accepted plans plus how many calls ran and plans were rejected.
 */
async function findChatPlans(
  db: Db,
  o: { asOf: string; debtorIds: Set<string>; gen: GenerateOptions; concurrency: number },
): Promise<{ plans: ChatPlan[]; calls: number; rejected: number }> {
  if (!o.debtorIds.size) return { plans: [], calls: 0, rejected: 0 };
  const from = addDays(o.asOf, -PLAN_WINDOW_DAYS);
  const { rows: msgs } = await db.query<{ id: string; thread_id: string; sender_id: string | null; d: string; t: string; body: string }>(
    `SELECT id, thread_id, sender_id, to_char(sent_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d, to_char(sent_at AT TIME ZONE 'UTC','HH24:MI') AS t, body
     FROM message WHERE to_char(sent_at AT TIME ZONE 'UTC','YYYY-MM-DD') BETWEEN $1 AND $2 ORDER BY thread_id, sent_at, id`,
    [from, o.asOf],
  );
  const { rows: persons } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person ORDER BY id");
  const nameOf = new Map(persons.map((p) => [p.id, p.display_name]));
  const known = new Set(persons.map((p) => p.id));
  const threads = new Map<string, typeof msgs>();
  for (const m of msgs) (threads.get(m.thread_id) ?? threads.set(m.thread_id, []).get(m.thread_id)!).push(m);

  const jobs: { input: PlanFinderInput; ids: Set<string>; bodies: Map<string, string> }[] = [];
  for (const [threadId, all] of threads) {
    const senders = [...new Set([USER_ID, ...all.map((m) => m.sender_id).filter((x): x is string => !!x)])].sort();
    if (!senders.some((id) => o.debtorIds.has(id))) continue;
    jobs.push({
      ids: new Set(all.map((m) => m.id)),
      bodies: new Map(all.map((m) => [m.id, m.body])),
      input: {
        asOf: o.asOf,
        threadId,
        threadTitle: `Chat with ${senders.filter((id) => id !== USER_ID).map((id) => nameOf.get(id) ?? id).join(", ") || "yourself"}`,
        people: senders.map((id) => ({ id, name: nameOf.get(id) ?? id })),
        messages: all.map((m) => ({
          id: m.id, senderId: m.sender_id ?? "unknown", date: m.d, time: m.t, text: m.body,
          weekday: new Date(`${m.d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
        })),
      },
    });
  }
  const outs = await mapLimit(jobs, o.concurrency, (j) => generateStructured(db, planFinder, j.input, o.gen));
  const plans: ChatPlan[] = [];
  let rejected = 0;
  jobs.forEach((j, k) => {
    for (const raw of outs[k]!.plans) {
      const r = acceptMessagePlan(raw, { asOf: o.asOf, knownIds: known, messageIds: j.ids });
      if (!r.ok) {
        rejected++;
        continue;
      }
      const body = j.bodies.get(r.plan.sourceMessageIds[0]!) ?? "";
      plans.push({
        ...r.plan,
        ref: `chat:${j.input.threadId}:${r.plan.date}:${stableId("pl", r.plan.description)}`,
        threadId: j.input.threadId,
        snippet: body.length > 100 ? `${body.slice(0, 99)}…` : body,
      });
    }
  });
  return { plans, calls: jobs.length, rejected };
}

export async function runPayback(db: Db, opts: PaybackRunOptions = {}): Promise<PaybackCounts> {
  const cfg = getConfig();
  const asOf = opts.asOf ?? getAsOf(cfg);
  const log = opts.log ?? (() => {});
  const counts: PaybackCounts = {
    debtors: 0, plans: 0, planCalls: 0, planRejected: 0, patterns: 0, discovered: 0, candidates: 0, suggestions: 0, serpCalls: 0, serpMisses: 0,
  };
  const gen: GenerateOptions = { ...opts.llm, ...(opts.llmMode ? { mode: opts.llmMode } : {}) };
  const serp = cachedSerp(db, opts.serp ?? defaultSerpClient(), { day: asOf, location: cfg.HOME_CITY, maxCalls: cfg.SERPAPI_MAX_CALLS });

  await db.exec("DELETE FROM payback_suggestion; DELETE FROM payback_candidate; DELETE FROM recurring_pattern; DELETE FROM future_event;");

  const { rows: friends } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person WHERE is_user = false ORDER BY id");
  const ledger = await listLedgerEntries(db);
  const past = await loadPastEvents(db);

  // P0: only debts the user owes
  const debtorIds = new Set(friends.filter((f) => friendTotals(f.id, ledger).balanceCents < 0).map((f) => f.id));
  const chat = await findChatPlans(db, { asOf, debtorIds, gen, concurrency: cfg.LLM_CONCURRENCY });
  counts.planCalls = chat.calls;
  counts.planRejected = chat.rejected;

  for (const f of friends) {
    if (!debtorIds.has(f.id)) continue;
    counts.debtors++;
    const cands: Candidate[] = [];
    const withFriend = past.filter((e) => e.attendeeIds.includes(f.id) && e.attendeeIds.includes(USER_ID));

    // ---- P1 plans: calendar entries AND chat plans after asOf that include the friend, merged (same day + a friend in common = one plan)
    const { rows: cal } = await db.query<{ id: string; title: string; description: string | null; d: string; t: string; attendee_ids: string[] }>(
      `SELECT id, title, description, to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d, to_char(start_at AT TIME ZONE 'UTC','HH24:MI') AS t, attendee_ids
       FROM calendar_event WHERE $1 = ANY(attendee_ids) AND to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD') > $2 ORDER BY start_at, id`,
      [f.id, asOf],
    );
    const known = past.map((e) => e.merchant).filter((m): m is string => !!m);
    const statedCents = (text: string) => {
      const m = STATED_PER_PERSON.exec(text);
      return m ? Math.round(Number(m[1]) * 100) : null;
    };
    const sources: PlanSource[] = [
      ...cal.map((c): PlanSource => ({
        ref: c.id, source: "calendar", title: c.title, date: c.d, time: c.t, peopleIds: c.attendee_ids,
        statedPerPersonCents: statedCents(`${c.title} ${c.description ?? ""}`),
        evidence: `On your calendar with ${f.display_name}, ${dayName(c.d)}.`,
      })),
      ...chat.plans
        .filter((p) => p.peopleIds.includes(f.id))
        .map((p): PlanSource => ({
          ref: p.ref, source: "message", title: p.description, date: p.date, time: p.time, peopleIds: p.peopleIds,
          statedPerPersonCents: p.perPersonCents,
          evidence: `Mentioned in your chat with ${f.display_name} (“${p.snippet}”).`,
        })),
    ];
    for (const plan of mergePlans(sources)) {
      const headcount = Math.max(2, plan.peopleIds.length);
      const key = activityKey(null, plan.title, known);
      const hist = past.filter((e) => e.key === key && e.perPersonCents).map((e) => e.perPersonCents!);
      let lo: number, hi: number, basis: Candidate["basis"], conf: number, why: string;
      if (plan.statedPerPersonCents !== null) {
        lo = hi = plan.statedPerPersonCents;
        basis = "confirmed";
        conf = 1;
        why = `${plan.evidence} The listed price is ${money(lo)} per person.`;
      } else if (hist.length) {
        lo = Math.min(...hist);
        hi = Math.max(...hist);
        basis = "estimated";
        conf = 0.7;
        why = `${plan.evidence} No price listed; your ${hist.length} past outing${hist.length > 1 ? "s" : ""} there cost ${range(lo, hi)} per person (median ${money(medianCents(hist))}).`;
      } else continue; // no price anywhere: nothing honest to suggest
      await db.query(
        `INSERT INTO future_event (id, friend_ids, date, time, description, source, source_refs, headcount, stated_per_person_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [stableId("fe", f.id, plan.ref), [f.id], plan.date, plan.time, plan.title, plan.source, [plan.ref], headcount, plan.statedPerPersonCents],
      );
      counts.plans++;
      cands.push({
        id: candId(f.id, "planned", plan.ref), friendId: f.id, kind: "planned", refId: plan.ref, title: plan.title, date: plan.date, headcount,
        lowCents: friendShareCents(lo, headcount, f.id), highCents: friendShareCents(hi, headcount, f.id), basis, confidence: conf, trust: TRUST.planned,
        activityKey: key, url: null, evidence: why,
      });
    }

    // ---- P2 patterns: the same activity with this friend, repeatedly
    const occs: Occurrence[] = withFriend.map((e) => ({ key: e.key, date: e.date, perPersonCents: e.perPersonCents, eventId: e.id }));
    for (const p of detectPatterns(occs, asOf)) {
      const members = withFriend.filter((e) => p.memberEventIds.includes(e.id));
      const last = members[members.length - 1]!;
      await db.query(
        `INSERT INTO recurring_pattern (id, friend_id, activity_key, occurrences, last_date, median_gap_days, weekday, regularity, member_event_ids,
           next_date_pred, per_person_low_cents, per_person_median_cents, per_person_high_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [stableId("rp", f.id, p.key), f.id, p.key, p.occurrences, p.lastDate, p.medianGapDays, p.weekday, p.regularity, p.memberEventIds,
         p.nextDate, p.perPersonLowCents, p.perPersonMedianCents, p.perPersonHighCents],
      );
      counts.patterns++;
      if (p.perPersonLowCents === null || p.perPersonHighCents === null) continue; // a pattern with no known price can't be offered
      // A planned entry at the same place within 3 days already covers this occurrence.
      if (cands.some((c) => c.kind === "planned" && c.activityKey === p.key && c.date && Math.abs(Date.parse(c.date) - Date.parse(p.nextDate)) <= 3 * 86_400_000)) continue;
      cands.push({
        id: candId(f.id, "recurring", p.key), friendId: f.id, kind: "recurring", refId: p.key, title: last.description, date: p.nextDate, headcount: 2,
        lowCents: friendShareCents(p.perPersonLowCents, 2, f.id), highCents: friendShareCents(p.perPersonHighCents, 2, f.id), basis: "estimated",
        confidence: 0.7, trust: Math.round(TRUST.recurringMax * p.regularity * 1000) / 1000, activityKey: p.key, url: null,
        evidence: `A tried-and-true one: you and ${f.display_name} have done this ${p.occurrences} times (${members.map((m) => shortDay(m.date)).join(", ")}), about every ${Math.round(p.medianGapDays)} days. Cost per person ${range(p.perPersonLowCents, p.perPersonHighCents)} each time.`,
      });
    }

    // ---- P3 discover: new ideas priced by SerpAPI
    const cats = [...new Set(withFriend.map((e) => e.category).filter((c): c is string => !!c && c !== "grocery"))].sort();
    const queries: { engine: SerpEngine; q: string }[] = [
      ...cats.map((c) => (SHOW.test(c) ? { engine: "google_events" as const, q: `${c} events in ${cfg.HOME_CITY}` } : { engine: "google_maps" as const, q: `${c} in ${cfg.HOME_CITY}` })),
      { engine: "google_events", q: `events in ${cfg.HOME_CITY}` },
    ];
    // Novelty: an idea must be new to the pair, so drop anything they already do or already have planned.
    const seenKeys = [...withFriend.map((e) => e.key), ...cands.flatMap((c) => [c.activityKey ?? "", c.title])];
    const perQuery: { engine: SerpEngine; q: string; place: PricedPlace; date: string | null }[][] = [];
    for (const { engine, q } of queries) {
      let places: PricedPlace[] = [];
      try {
        const resp = await serp.search(engine, q);
        places = engine === "google_events" ? eventsFromSerp(resp) : placesFromSerp(resp);
      } catch (e) {
        if (e instanceof SerpReplayMiss) counts.serpMisses++;
        else if (e instanceof SerpBudgetExceeded) log(`[payback] ${e.message}`);
        else throw e;
      }
      perQuery.push(
        places
          .map((p) => ({ engine, q, place: p, date: resolveMonthDay(p.dateText, asOf) }))
          .filter((r) => !(r.place.dateText && !r.date) && isNovel(r.place.title, seenKeys))
          .slice(0, PER_QUERY), // filter first, so a place the pair already knows doesn't use up one of the slots
      );
    }
    // Round-robin across queries (best of each first), capped per friend.
    const picked: (typeof perQuery)[number] = [];
    for (let rank = 0; picked.length < MAX_DISCOVERED && perQuery.some((r) => rank < r.length); rank++) {
      for (const results of perQuery) if (rank < results.length && picked.length < MAX_DISCOVERED) picked.push(results[rank]!);
    }
    for (const { engine, q, place: p, date } of picked) {
      const ref = `${engine}|${q}|${p.title}`;
      cands.push({
        id: candId(f.id, "discovered", ref), friendId: f.id, kind: "discovered", refId: ref, title: p.title, date, headcount: 2,
        lowCents: friendShareCents(p.lowCents, 2, f.id), highCents: friendShareCents(p.highCents, 2, f.id), basis: "estimated",
        confidence: p.source === "stated" ? 0.6 : 0.3, trust: TRUST.discovered, activityKey: p.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), url: p.url,
        evidence: `Something new to try together: ${engine === "google_events" ? "a Google Events" : "a Google Maps"} result for "${q}" via SerpAPI. ${p.source === "stated" ? `Listed price ${range(p.lowCents, p.highCents)} per person.` : `Only a price level was listed; ${range(p.lowCents, p.highCents)} per person is an estimated band.`}`,
      });
      counts.discovered++;
    }

    // ---- P4 persist (prices are already friend shares)
    for (const c of cands) {
      await db.query(
        `INSERT INTO payback_candidate (id, friend_id, kind, ref_id, title, date, headcount, friend_share_low_cents, friend_share_high_cents, basis,
           confidence, trust, activity_key, url, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.friendId, c.kind, c.refId, c.title, c.date, c.headcount, c.lowCents, c.highCents, c.basis, c.confidence, c.trust, c.activityKey, c.url, c.evidence],
      );
      counts.candidates++;
    }
    // ---- P5 solve
    counts.suggestions += (await solveFriend(db, f.id, { asOf })).suggestions.length;
  }
  counts.serpCalls = serp.state.calls;
  log(`[payback] debtors=${counts.debtors} candidates=${counts.candidates} suggestions=${counts.suggestions} serpCalls=${counts.serpCalls} serpMisses=${counts.serpMisses}`);
  return counts;
}

export function paybackConfig(asOf = getAsOf()): PaybackConfig {
  const cfg = getConfig();
  return { asOf, tolerancePct: cfg.PAYBACK_TOLERANCE_PCT, toleranceMinCents: cfg.PAYBACK_TOLERANCE_MIN_CENTS, maxBundle: cfg.PAYBACK_MAX_BUNDLE };
}

const suggestionId = (friendId: string, optionIds: string[]) => stableId("ps", friendId, ...[...optionIds].sort());

/**
 * Debt now (from the ledger) + stored candidates -> ranked suggestions, rewritten into payback_suggestion and returned as the DTO.
 * Pure + DB only (no Meta API, no SerpAPI), so it is also what GET /friends/:id/payback runs: a review answer that moves the
 * debt is reflected on the next read without repricing anything.
 */
export async function solveFriend(db: Db, friendId: string, opts: { asOf?: string } = {}): Promise<PaybackResponse> {
  const { rows: pr } = await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM person WHERE id = $1 AND is_user = false", [friendId]);
  if (!pr[0]) throw new Error(`unknown friend ${friendId}`);
  const friend = { personId: pr[0].id, name: pr[0].display_name };
  const balance = friendTotals(friendId, await listLedgerEntries(db, { personId: friendId })).balanceCents;
  const debt = balance < 0 ? -balance : 0;
  const pc = paybackConfig(opts.asOf);

  const { rows } = await db.query<{
    id: string; kind: Candidate["kind"]; title: string; d: string | null; low: number; high: number; basis: "confirmed" | "estimated";
    confidence: number; trust: number; activity_key: string | null; url: string | null; evidence: string;
  }>(
    `SELECT id, kind, title, to_char(date,'YYYY-MM-DD') AS d, friend_share_low_cents AS low, friend_share_high_cents AS high, basis, confidence, trust,
            activity_key, url, evidence FROM payback_candidate WHERE friend_id = $1 ORDER BY id`,
    [friendId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const options: PaybackOption[] = rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, date: r.d, lowCents: r.low, highCents: r.high, confidence: r.confidence, trust: r.trust,
    ...(r.activity_key ? { activityKey: r.activity_key } : {}),
  }));
  const result = solvePayback(debt, options, { ...pc, limit: 10 });
  const { rows: dis } = await db.query<{ suggestion_id: string }>("SELECT suggestion_id FROM payback_dismissal WHERE friend_id = $1", [friendId]);
  const dismissed = new Set(dis.map((d) => d.suggestion_id));
  const bundles = result.bundles.filter((b) => !dismissed.has(suggestionId(friendId, b.optionIds))).slice(0, 3);

  await db.tx(async (tx) => {
    await tx.query("DELETE FROM payback_suggestion WHERE friend_id = $1", [friendId]);
    for (const b of bundles) {
      await tx.query(
        `INSERT INTO payback_suggestion (id, friend_id, debt_cents, candidate_ids, total_low_cents, total_high_cents, kind, score, needs_transfer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [suggestionId(friendId, b.optionIds), friendId, debt, b.optionIds, b.lowCents, b.highCents, b.kind, b.score, result.needsTransfer],
      );
    }
  });

  return {
    friend,
    debtCents: debt,
    toleranceCents: result.toleranceCents,
    needsTransfer: debt > 0 && (result.needsTransfer || bundles.length === 0),
    suggestions: bundles.map((b) => ({
      id: suggestionId(friendId, b.optionIds),
      kind: b.kind,
      totalLowCents: b.lowCents,
      totalHighCents: b.highCents,
      items: b.optionIds
        .map((id): PaybackItem => {
          const r = byId.get(id)!;
          return { id, kind: r.kind, title: r.title, date: r.d, friendShareLowCents: r.low, friendShareHighCents: r.high, basis: r.basis, confidence: r.confidence, url: r.url, evidence: r.evidence };
        })
        .sort((a, b2) => (a.date ?? "9999").localeCompare(b2.date ?? "9999") || a.id.localeCompare(b2.id)),
    })),
  };
}

/** Hides one suggestion for good (until its option set changes). Returns the friend id, or null if the suggestion is unknown. */
export async function dismissSuggestion(db: Db, id: string): Promise<string | null> {
  const { rows } = await db.query<{ friend_id: string }>("SELECT friend_id FROM payback_suggestion WHERE id = $1", [id]);
  if (!rows[0]) return null;
  await db.query("INSERT INTO payback_dismissal (suggestion_id, friend_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, rows[0].friend_id]);
  await db.query("DELETE FROM payback_suggestion WHERE id = $1", [id]);
  return rows[0].friend_id;
}
