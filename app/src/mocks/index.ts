// Mock data shaped exactly like @sark/shared DTOs. Enabled by EXPO_PUBLIC_USE_MOCKS=1.
import type {
  FriendDetailResponse,
  FriendEntry,
  FriendSummary,
  ReviewAnswerBody,
  ReviewItemDto,
} from "@sark/shared";

const ME = "You";
const delay = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms));

const people = {
  alex: { personId: "p_alex", name: "Alex" },
  sam: { personId: "p_sam", name: "Sam" },
  jordan: { personId: "p_jordan", name: "Jordan" },
  riley: { personId: "p_riley", name: "Riley" },
};
type P = keyof typeof people;

interface MockEntry extends FriendEntry {
  friend: P;
}

const ev = (id: string, date: string, description: string, who: P[]) => ({
  id,
  date,
  description,
  attendees: who.map((w) => people[w]),
});
const evidence = (id: string, snippet: string, sentAt: string) => [{ messageId: id, snippet, sentAt }];

const events = {
  uchi: ev("e1", "2026-09-06", "Dinner at Uchi", ["sam", "alex", "jordan"]),
  brunch: ev("e2", "2026-09-13", "Brunch at Josephine House", ["sam", "riley"]),
  concert: ev("e3", "2026-09-20", "ACL concert tickets", ["alex", "jordan", "riley"]),
  bowling: ev("e4", "2026-09-27", "Bowling night", ["jordan", "alex"]),
  taxi: ev("e5", "2026-10-02", "Late-night rideshare", ["riley", "sam"]),
  tacos: ev("e6", "2026-10-09", "Tacos after work", ["sam", "alex"]),
  hike: ev("e7", "2026-10-11", "Barton Creek hike and snacks", ["jordan", "riley"]),
};

let seq = 0;
const mk = (
  friend: P,
  event: (typeof events)[keyof typeof events] | null,
  payer: "me" | "friend",
  amountCents: number,
  kind: FriendEntry["kind"],
  basis: FriendEntry["basis"],
  confidence: number,
  ev_: FriendEntry["evidence"] = [],
): MockEntry => ({
  id: `le_${++seq}`,
  friend,
  event,
  payerName: payer === "me" ? ME : people[friend].name,
  beneficiaryName: payer === "me" ? people[friend].name : ME,
  amountCents,
  kind,
  basis,
  confidence,
  evidence: ev_,
});

function seedEntries(): MockEntry[] {
  return [
    // Sam: covered a lot, you covered some, one repayment
    mk("sam", events.uchi, "friend", 4850, "covered", "confirmed", 0.95, evidence("m1", "Got dinner, just Venmo me later haha", "2026-09-06T21:40:00Z")),
    mk("sam", events.brunch, "me", 3200, "covered", "confirmed", 0.9, evidence("m2", "Brunch was $64 total, thanks for grabbing it!", "2026-09-13T13:05:00Z")),
    mk("sam", events.tacos, "friend", 1450, "covered", "estimated", 0.7, evidence("m3", "tacos on me today", "2026-10-09T18:20:00Z")),
    mk("sam", null, "friend", 2000, "repayment", "confirmed", 0.9, evidence("m4", "Sent you $20 for the other night", "2026-09-30T10:02:00Z")),
    // Alex: mostly spent on you
    mk("alex", events.uchi, "friend", 4850, "covered", "confirmed", 0.9, evidence("m5", "I'll cover the table, you all owe me", "2026-09-06T21:41:00Z")),
    mk("alex", events.concert, "friend", 11800, "covered", "confirmed", 0.95, evidence("m6", "Tickets bought, $118 for yours", "2026-09-20T09:00:00Z")),
    mk("alex", events.bowling, "me", 2100, "covered", "estimated", 0.65, evidence("m7", "Thanks for the lanes!", "2026-09-27T23:10:00Z")),
    mk("alex", events.tacos, "friend", 1450, "covered", "estimated", 0.7),
    // Jordan: roughly even
    mk("jordan", events.concert, "me", 9500, "covered", "confirmed", 0.9, evidence("m8", "Can you grab mine, I'll pay you back", "2026-09-20T09:12:00Z")),
    mk("jordan", events.bowling, "friend", 2100, "covered", "estimated", 0.6),
    mk("jordan", events.hike, "friend", 1800, "covered", "assumed", 0.4, evidence("m9", "snacks were great, thanks again!!", "2026-10-11T17:30:00Z")),
    mk("jordan", events.uchi, "me", 4850, "unaccounted", "estimated", 0.5),
    // Riley: you spent more
    mk("riley", events.brunch, "me", 3200, "covered", "confirmed", 0.9),
    mk("riley", events.taxi, "me", 2600, "covered", "confirmed", 0.9, evidence("m10", "Uber home was $26, got it", "2026-10-02T01:15:00Z")),
    mk("riley", events.concert, "me", 9500, "covered", "estimated", 0.7, evidence("m11", "omg thank you for the ticket", "2026-09-20T09:30:00Z")),
    mk("riley", events.hike, "friend", 1800, "covered", "assumed", 0.35),
  ];
}

interface MockReview {
  item: ReviewItemDto;
  /** Applies the answer to the entries. */
  apply(entries: MockEntry[], body: ReviewAnswerBody): MockEntry[];
}

function seedReviews(): MockReview[] {
  return [
    {
      item: {
        id: "r1",
        kind: "payer",
        question: "Who covered you at the Barton Creek hike?",
        eventSummary: "Oct 11 · Barton Creek hike and snacks · with Jordan, Riley",
        options: [people.jordan, people.riley],
      },
      apply: (entries, body) => {
        const chosen = Object.values(people).find((p) => p.personId === body.payerId);
        if (body.dismiss || !chosen) return entries.filter((e) => e.event?.id !== "e7");
        return entries.flatMap((e) => {
          if (e.event?.id !== "e7") return [e];
          if (people[e.friend].personId !== chosen.personId) return [];
          return [{ ...e, basis: "confirmed" as const, confidence: 1 }];
        });
      },
    },
    {
      item: {
        id: "r2",
        kind: "attendees",
        question: "Who was at the bowling night?",
        eventSummary: "Sep 27 · Bowling night · $42.00 on your card",
        options: [people.alex, people.jordan, people.sam, people.riley],
      },
      apply: (entries, body) => {
        const ids = new Set(body.personIds ?? []);
        if (body.dismiss) return entries.filter((e) => e.event?.id !== "e4");
        return entries
          .filter((e) => e.event?.id !== "e4" || ids.has(people[e.friend].personId))
          .map((e) => (e.event?.id === "e4" ? { ...e, basis: "confirmed" as const, confidence: 1 } : e));
      },
    },
    {
      item: {
        id: "r3",
        kind: "alias",
        question: "Who is \"R\" in your messages about the late-night rideshare?",
        eventSummary: "Oct 2 · Late-night rideshare · $26.00",
        options: [people.riley, people.sam],
      },
      apply: (entries, body) => {
        if (body.dismiss) return entries.filter((e) => e.event?.id !== "e5");
        const chosen = Object.values(people).find((p) => p.personId === body.payerId);
        if (!chosen) return entries;
        const taxi = entries.find((e) => e.event?.id === "e5");
        if (!taxi) return entries;
        const rest = entries.filter((e) => e.event?.id !== "e5");
        const friend = (Object.keys(people) as P[]).find((k) => people[k].personId === chosen.personId)!;
        return [
          ...rest,
          { ...taxi, friend, beneficiaryName: chosen.name, basis: "confirmed" as const, confidence: 1 },
        ];
      },
    },
  ];
}

let entries = seedEntries();
let reviews = seedReviews();

function summarize(friend: P): FriendSummary {
  const rows = entries.filter((e) => e.friend === friend);
  let spentOn = 0;
  let youSpent = 0;
  let balance = 0;
  let possible = 0;
  for (const e of rows) {
    if (e.basis === "assumed") {
      possible += e.amountCents;
      continue;
    }
    const mine = e.payerName === ME;
    balance += mine ? e.amountCents : -e.amountCents;
    if (e.kind === "covered") {
      if (mine) youSpent += e.amountCents;
      else spentOn += e.amountCents;
    }
  }
  const eventIds = new Set(rows.map((e) => e.event?.id).filter(Boolean));
  return {
    personId: people[friend].personId,
    name: people[friend].name,
    spentOnYouCents: spentOn,
    youSpentOnThemCents: youSpent,
    balanceCents: balance,
    possibleCents: possible,
    eventCount: eventIds.size,
  };
}

const allSummaries = () =>
  (Object.keys(people) as P[]).map(summarize).sort((a, b) => b.spentOnYouCents - a.spentOnYouCents);

export const mockApi = {
  getFriends: () => delay(allSummaries()),
  async getFriend(id: string): Promise<FriendDetailResponse> {
    const key = (Object.keys(people) as P[]).find((k) => people[k].personId === id);
    if (!key) throw new Error(`Friend ${id} not found`);
    const rows = entries
      .filter((e) => e.friend === key)
      .map(({ friend: _f, ...rest }) => rest as FriendEntry)
      .sort((a, b) => (b.event?.date ?? "").localeCompare(a.event?.date ?? ""));
    return delay({ friend: summarize(key), entries: rows });
  },
  getReview: () => delay(reviews.map((r) => r.item)),
  async answerReview(id: string, body: ReviewAnswerBody): Promise<FriendSummary[]> {
    const r = reviews.find((x) => x.item.id === id);
    if (!r) throw new Error(`Review item ${id} not found`);
    entries = r.apply(entries, body);
    reviews = reviews.filter((x) => x.item.id !== id);
    return delay(allSummaries());
  },
  /** For tests / demo reset. */
  reset() {
    seq = 0;
    entries = seedEntries();
    reviews = seedReviews();
  },
};
