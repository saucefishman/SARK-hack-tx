// Pure seed generator: scenario -> Instagram export, calendar, Nessie payloads, people, truth.
// Deterministic: no Math.random, no Date.now. Times in the scenario are UTC literals.
//
// Rules encoded in truth (the pipeline is built to these):
//  - relevant = attendees >= 2 AND a payer row exists (assumed counts) AND sourceCount >= 2,
//    sources = Nessie txn | message thread | calendar entry. Irrelevant events have no ledger rows.
//  - Me paid (Nessie txn): equal split, every other attendee gets covered Me->friend, confirmed.
//  - Friend paid, stated amount: covered friend->Me share, confirmed.
//  - Friend paid, no amount (estimated): total = median of Me's earlier Nessie purchases at the same merchant.
//  - Friend paid, no amount, no history, expected.costSource rag|web: total = payer.perPersonDollars x headcount (the per-person
//    figure the RAG / web cost steps must reproduce; the oracle cannot search). Basis estimated.
//  - Implicit payer (assumed): total = perPersonDollars x headcount; assumed payer = attendee who posted the
//    ticket price (else most frequent past payer); ledger basis assumed -> counts as "possible" only.
//  - Multi-payer: surplus/debt pro rata (see oracle.ts). Only edges touching Me are kept.
import type { RawCalendarEvent, NessieAccount, NessieCustomer, NessieMerchant, NessiePurchase, NessieTransfer } from "../sources/types";
import type { NessieData } from "../sources/nessie";
import type { PersonSeed } from "../sources/people";
import { medianCents, splitEdges } from "./oracle";
import { Scenario, type ScenarioEvent, type ScenarioMessage, type ScenarioPerson } from "./scenario";

export interface IgThreadFile {
  participants: { name: string }[];
  messages: { sender_name: string; timestamp_ms: number; content: string }[]; // newest first, like real exports
  title: string;
  thread_path: string;
}
export interface InstagramThread { dirName: string; file: IgThreadFile }

export interface TruthLedgerRow { payerId: string; beneficiaryId: string; amountCents: number; kind: "covered"; basis: string }
export interface TruthEvent {
  key: string;
  date: string;
  description: string;
  attendeeIds: string[];
  payers: { personId: string; amountCents: number; basis: string }[];
  totalCents: number;
  sourceCount: number;
  relevant: boolean;
  scenarios: number[];
  ledger: TruthLedgerRow[];
}
export interface TruthRepayment {
  payerId: string;
  beneficiaryId: string;
  amountCents: number;
  via: "message" | "nessie";
  date: string;
  eventKey: string;
}
export interface TruthReview { kind: "alias" | "attendees" | "payer"; eventKey?: string; nessieId?: string; alias?: string }
export interface Truth {
  /** Balance sign: positive = friend owes Me. */
  friends: Record<string, { spentOnYouCents: number; youSpentOnThemCents: number; balanceCents: number; possibleCents: number }>;
  events: TruthEvent[];
  repayments: TruthRepayment[];
  reviewItems: TruthReview[];
  unaccountedCents: number;
}

export interface GeneratedSeed {
  instagramThreads: InstagramThread[];
  calendar: RawCalendarEvent[];
  nessie: NessieData;
  people: PersonSeed[];
  truth: Truth;
}

/** UTF-8 bytes mis-decoded as latin-1 (what Instagram exports do to non-ASCII text). */
export function toMojibake(s: string): string {
  return Buffer.from(s, "utf8").toString("latin1");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const cents = (d: number) => d * 100;
const ts = (at: string) => Date.parse(`${at}:00Z`);
const isoZ = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

const nameOf = (p: ScenarioPerson) => p.displayName;
const fullNameOf = (p: ScenarioPerson) => p.aliases.filter((a) => a.kind === "display_name")[1]?.value ?? p.displayName;
const emailOf = (p: ScenarioPerson) => p.aliases.find((a) => a.kind === "email")?.value;

export function generateSeed(input: unknown): GeneratedSeed {
  const sc = Scenario.parse(input);
  const person = new Map(sc.people.map((p) => [p.id, p]));
  const P = (id: string) => {
    const p = person.get(id);
    if (!p) throw new Error(`unknown person ${id}`);
    return p;
  };
  const userId = sc.userId;
  const events = [...sc.events].sort((a, b) => `${a.date}T${a.time ?? "00:00"}${a.key}`.localeCompare(`${b.date}T${b.time ?? "00:00"}${b.key}`));
  const slugOf = (id: string) => id.replace(/^p_/, "");

  // ---- Instagram
  const threadDefs = new Map(sc.threads.map((t) => [t.key, t]));
  const perThread = new Map<string, { seq: number; msg: ScenarioMessage }[]>();
  let seq = 0;
  const addMsg = (m: ScenarioMessage) => {
    const t = threadDefs.get(m.thread);
    if (!t) throw new Error(`unknown thread ${m.thread}`);
    if (!t.participants.includes(m.sender)) throw new Error(`${m.sender} not in thread ${m.thread}`);
    (perThread.get(m.thread) ?? perThread.set(m.thread, []).get(m.thread)!).push({ seq: seq++, msg: m });
  };
  for (const e of events) {
    e.messages.forEach(addMsg);
    for (const r of e.repayments ?? []) if (r.via === "message") addMsg(r.message ?? (() => { throw new Error(`repayment in ${e.key} missing message`); })());
  }
  const instagramThreads: InstagramThread[] = [...perThread.keys()]
    .map((key) => {
      const t = threadDefs.get(key)!;
      const dirName = `${t.title.toLowerCase().replace(/[^a-z0-9]/g, "")}_${t.key}`;
      const rows = perThread.get(key)!.sort((a, b) => ts(a.msg.at) - ts(b.msg.at) || a.seq - b.seq).reverse();
      const file: IgThreadFile = {
        participants: t.participants.map((id) => ({ name: toMojibake(nameOf(P(id))) })),
        messages: rows.map(({ msg }) => ({
          sender_name: toMojibake(msg.senderName ?? nameOf(P(msg.sender))),
          timestamp_ms: ts(msg.at),
          content: toMojibake(msg.text),
        })),
        title: toMojibake(t.title),
        thread_path: `inbox/${dirName}`,
      };
      return { dirName, file };
    })
    .sort((a, b) => a.dirName.localeCompare(b.dirName));

  // ---- Calendar
  const calendar: RawCalendarEvent[] = events
    .filter((e) => e.calendar)
    .map((e) => {
      const c = e.calendar!;
      if (!e.time) throw new Error(`${e.key}: calendar entry needs time`);
      const start = ts(`${e.date}T${e.time}`);
      return {
        id: `cal_${e.key}`,
        summary: c.title,
        ...(c.description ? { description: c.description } : {}),
        start: { dateTime: isoZ(start) },
        end: { dateTime: isoZ(start + c.durationMin * 60000) },
        attendees: e.attendees.map((id) => {
          const p = P(id);
          return c.nameOnly?.includes(id) ? { displayName: fullNameOf(p) } : { email: emailOf(p), displayName: fullNameOf(p) };
        }),
      };
    });
  for (const p of sc.plans) {
    const start = ts(`${p.date}T${p.time}`);
    calendar.push({
      id: `cal_${p.key}`,
      summary: p.title,
      ...(p.description ? { description: p.description } : {}),
      start: { dateTime: isoZ(start) },
      end: { dateTime: isoZ(start + p.durationMin * 60000) },
      attendees: p.attendees.map((id) => ({ email: emailOf(P(id)), displayName: fullNameOf(P(id)) })),
    });
  }
  calendar.sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime) || a.id.localeCompare(b.id));

  // ---- Nessie
  const lastName = (p: ScenarioPerson) => fullNameOf(p).split(" ").slice(1).join(" ") || "Friend";
  const customers: NessieCustomer[] = sc.people.map((p) => ({ _id: `cust_${slugOf(p.id)}`, first_name: nameOf(p), last_name: lastName(p) }));
  const accounts: NessieAccount[] = sc.people.map((p) => ({
    _id: `acct_${slugOf(p.id)}`, customer_id: `cust_${slugOf(p.id)}`, nickname: `${nameOf(p)} Checking`, type: "Checking",
  }));
  const merchants: NessieMerchant[] = [];
  const merchantId = (name: string, category: string[]) => {
    let m = merchants.find((x) => x.name === name);
    if (!m) merchants.push((m = { _id: `mer_${slug(name)}`, name, category }));
    return m._id;
  };
  const meAccount = `acct_${slugOf(userId)}`;
  const purchases: NessiePurchase[] = [];
  const transfers: NessieTransfer[] = [];
  for (const e of events) {
    if (!e.nessie) continue;
    const mine = e.payers.find((p) => p.person === userId);
    if (!mine?.amountDollars) throw new Error(`${e.key}: nessie purchase needs a Me payer with amountDollars`);
    purchases.push({
      _id: `pur_${e.key}`, type: "merchant", merchant_id: merchantId(e.nessie.merchant, e.nessie.category),
      payer_id: meAccount, purchase_date: e.date, amount: mine.amountDollars, status: "completed", medium: "balance",
      description: e.nessie.merchant,
    });
  }
  let trf = 0;
  for (const e of events) {
    for (const r of e.repayments ?? []) {
      if (r.via !== "nessie") continue;
      transfers.push({
        _id: `trf_${String(++trf).padStart(2, "0")}`, type: "p2p", transaction_date: r.date, status: "completed", medium: "balance",
        payer_id: `acct_${slugOf(r.payer)}`, payee_id: `acct_${slugOf(r.beneficiary)}`, amount: r.amountDollars, description: r.description,
      });
    }
  }
  const nessie: NessieData = { customers, accounts, merchants, purchases, transfers };

  // ---- Truth
  const people: PersonSeed[] = sc.people.map((p) => ({ id: p.id, displayName: p.displayName, isUser: p.isUser, aliases: p.aliases }));
  const truthEvents: TruthEvent[] = [];
  const repayments: TruthRepayment[] = [];
  const reviewItems: TruthReview[] = [];
  const myPurchases: { date: string; merchant: string; amountCents: number }[] = [];
  for (const e of events) {
    if (e.nessie) myPurchases.push({ date: e.date, merchant: e.nessie.merchant, amountCents: cents(e.payers.find((p) => p.person === userId)!.amountDollars!) });
  }
  const headcount = (e: ScenarioEvent) => new Set(e.attendees).size;
  for (const e of events) {
    const payers = e.payers.map((p) => {
      let amountCents: number;
      if (p.amountDollars !== undefined) amountCents = cents(p.amountDollars);
      else if (p.estimateFromMerchant) {
        const hist = myPurchases.filter((x) => x.merchant === p.estimateFromMerchant && x.date < e.date).map((x) => x.amountCents);
        if (hist.length < 2) throw new Error(`${e.key}: need >=2 earlier purchases at ${p.estimateFromMerchant}`);
        amountCents = medianCents(hist);
      } else if (p.perPersonDollars !== undefined) amountCents = cents(p.perPersonDollars) * headcount(e);
      else throw new Error(`${e.key}: payer ${p.person} has no amount source`);
      return { personId: p.person, amountCents, basis: p.basis as string };
    });
    if (e.expected.costSource && !e.payers.some((p) => p.basis === "estimated" && p.perPersonDollars !== undefined)) {
      throw new Error(`${e.key}: costSource ${e.expected.costSource} needs an estimated payer with perPersonDollars`);
    }
    const sourceCount = (e.nessie ? 1 : 0) + (e.messages.length ? 1 : 0) + (e.calendar ? 1 : 0);
    const relevant = headcount(e) >= 2 && payers.length > 0 && sourceCount >= 2;
    if (relevant !== e.expected.relevant) throw new Error(`${e.key}: computed relevant=${relevant} but scenario expects ${e.expected.relevant}`);
    const basisByPayer = new Map(payers.map((p) => [p.personId, p.basis]));
    const ledger: TruthLedgerRow[] = relevant
      ? splitEdges(e.attendees, payers, userId).map((x) => ({ ...x, kind: "covered" as const, basis: basisByPayer.get(x.payerId)! }))
      : [];
    // Edges between friends never reach here (splitEdges keeps only edges touching Me).
    truthEvents.push({
      key: e.key, date: e.date, description: e.description, attendeeIds: [...e.attendees].sort(), payers,
      totalCents: payers.reduce((s, p) => s + p.amountCents, 0), sourceCount, relevant, scenarios: e.scenarios, ledger,
    });
    for (const rv of e.expected.review ?? []) {
      reviewItems.push({ kind: rv.kind, eventKey: e.key, ...(rv.kind === "attendees" ? { nessieId: `pur_${e.key}` } : {}) });
    }
    for (const r of e.repayments ?? []) {
      repayments.push({ payerId: r.payer, beneficiaryId: r.beneficiary, amountCents: cents(r.amountDollars), via: r.via, date: r.date, eventKey: e.key });
    }
  }
  const friends: Truth["friends"] = {};
  for (const p of sc.people.filter((x) => x.id !== userId)) {
    const t = { spentOnYouCents: 0, youSpentOnThemCents: 0, balanceCents: 0, possibleCents: 0 };
    for (const ev of truthEvents) {
      for (const l of ev.ledger) {
        const fromFriend = l.payerId === p.id && l.beneficiaryId === userId;
        const fromUser = l.payerId === userId && l.beneficiaryId === p.id;
        if (!fromFriend && !fromUser) continue;
        if (l.basis === "assumed") { t.possibleCents += l.amountCents; continue; }
        if (fromFriend) { t.spentOnYouCents += l.amountCents; t.balanceCents -= l.amountCents; }
        else { t.youSpentOnThemCents += l.amountCents; t.balanceCents += l.amountCents; }
      }
    }
    for (const r of repayments) {
      if (r.payerId === p.id && r.beneficiaryId === userId) t.balanceCents -= r.amountCents;
      if (r.payerId === userId && r.beneficiaryId === p.id) t.balanceCents += r.amountCents;
    }
    friends[p.id] = t;
  }
  const truth: Truth = { friends, events: truthEvents, repayments, reviewItems, unaccountedCents: 0 };
  return { instagramThreads, calendar, nessie, people, truth };
}

/** JSON as written to disk: 2-space, trailing newline, non-ASCII \u-escaped (like Instagram exports). */
export function stringifyJson(v: unknown): string {
  return JSON.stringify(v, null, 2).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) + "\n";
}

/** Every output file, keyed by path relative to the seed/ directory. Pure. */
export function seedFiles(seed: GeneratedSeed): Record<string, string> {
  const files: Record<string, string> = {
    "generated/calendar.json": stringifyJson(seed.calendar),
    "generated/nessie.json": stringifyJson(seed.nessie),
    "generated/people.json": stringifyJson(seed.people),
    "truth.json": stringifyJson(seed.truth),
  };
  for (const t of seed.instagramThreads) {
    files[`generated/instagram/messages/inbox/${t.dirName}/message_1.json`] = stringifyJson(t.file);
  }
  return files;
}
