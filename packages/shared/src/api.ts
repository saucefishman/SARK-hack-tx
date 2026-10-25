// API DTOs (BUILDPLAN.md section 7). Money is integer cents on the wire.
// balanceCents: positive = friend owes user, negative = user owes friend.
import { z } from "zod";
import { Basis, IsoDate, LedgerKind, ReviewKind } from "./domain";

export const FriendSummary = z.object({
  personId: z.string(),
  name: z.string(),
  spentOnYouCents: z.number().int(),
  youSpentOnThemCents: z.number().int(),
  balanceCents: z.number().int(),
  /** Sum of `assumed` rows; excluded from balance. */
  possibleCents: z.number().int(),
  eventCount: z.number().int(),
  /** Payback suggestions currently available for this friend (DESIGN §15); only when the user owes them. */
  paybackCount: z.number().int().optional(),
});
export type FriendSummary = z.infer<typeof FriendSummary>;

/** GET /friends — sorted by spentOnYouCents desc. */
export const FriendsResponse = z.array(FriendSummary);
export type FriendsResponse = z.infer<typeof FriendsResponse>;

export const PersonRef = z.object({ personId: z.string(), name: z.string() });
export type PersonRef = z.infer<typeof PersonRef>;

export const Evidence = z.object({
  messageId: z.string(),
  snippet: z.string(),
  sentAt: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export const FriendEntry = z.object({
  id: z.string(),
  event: z
    .object({
      id: z.string(),
      date: IsoDate,
      description: z.string(),
      attendees: z.array(PersonRef),
    })
    .nullable(),
  payerName: z.string(),
  beneficiaryName: z.string(),
  amountCents: z.number().int(),
  kind: LedgerKind,
  basis: Basis,
  confidence: z.number(),
  evidence: z.array(Evidence),
});
export type FriendEntry = z.infer<typeof FriendEntry>;

/** GET /friends/:id */
export const FriendDetailResponse = z.object({
  friend: FriendSummary,
  entries: z.array(FriendEntry),
});
export type FriendDetailResponse = z.infer<typeof FriendDetailResponse>;

export const ReviewItemDto = z.object({
  id: z.string(),
  kind: ReviewKind,
  question: z.string(),
  options: z.array(PersonRef).optional(),
  eventSummary: z.string(),
});
export type ReviewItemDto = z.infer<typeof ReviewItemDto>;

/** GET /review — open items. */
export const ReviewListResponse = z.array(ReviewItemDto);
export type ReviewListResponse = z.infer<typeof ReviewListResponse>;

/** POST /review/:id/answer body. attendees → personIds; payer → payerId; alias → payerId reused as the person id. */
export const ReviewAnswerBody = z.object({
  personIds: z.array(z.string()).optional(),
  payerId: z.string().optional(),
  dismiss: z.boolean().optional(),
});
export type ReviewAnswerBody = z.infer<typeof ReviewAnswerBody>;

/** POST /review/:id/answer response: updated friend rows. */
export const ReviewAnswerResponse = z.array(FriendSummary);
export type ReviewAnswerResponse = z.infer<typeof ReviewAnswerResponse>;

// ---- Payback suggestions (DESIGN §15.6). Cents on the wire; shares are the FRIEND's share of an outing (what reduces the debt).

export const PaybackKind = z.enum(["planned", "recurring", "discovered"]);
export type PaybackKind = z.infer<typeof PaybackKind>;

export const PaybackItem = z.object({
  id: z.string(),
  kind: PaybackKind,
  title: z.string(),
  date: IsoDate.nullable(),
  friendShareLowCents: z.number().int(),
  friendShareHighCents: z.number().int(),
  basis: z.enum(["confirmed", "estimated"]),
  confidence: z.number(),
  url: z.string().nullable(),
  /** Human-readable receipt: why this option exists and where its price comes from. */
  evidence: z.string(),
});
export type PaybackItem = z.infer<typeof PaybackItem>;

export const PaybackSuggestion = z.object({
  id: z.string(),
  /** exact: settles the debt within tolerance. partial: covers part of it. */
  kind: z.enum(["exact", "partial"]),
  totalLowCents: z.number().int(),
  totalHighCents: z.number().int(),
  items: z.array(PaybackItem),
});
export type PaybackSuggestion = z.infer<typeof PaybackSuggestion>;

/** GET /friends/:id/payback. Empty `suggestions` and debtCents 0 when the user owes this friend nothing. */
export const PaybackResponse = z.object({
  friend: PersonRef,
  debtCents: z.number().int(),
  toleranceCents: z.number().int(),
  /** No suggestion settles the debt: the UI also offers a plain transfer. */
  needsTransfer: z.boolean(),
  suggestions: z.array(PaybackSuggestion),
});
export type PaybackResponse = z.infer<typeof PaybackResponse>;

export const HealthResponse = z.object({ ok: z.literal(true), llmMode: z.enum(["live", "replay"]) });
export type HealthResponse = z.infer<typeof HealthResponse>;
