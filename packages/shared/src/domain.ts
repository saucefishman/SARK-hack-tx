// Domain types mirroring server/migrations/001_init.sql (DESIGN.md section 5).
// This file is a contract: change it together with the migration and DESIGN.md.
import { z } from "zod";

/** The single MVP user. `event.owner_user_id` is this constant. TODO(stub): social */
export const USER_ID = "p_me";

export const Basis = z.enum(["confirmed", "assumed", "estimated", "crowd"]);
export type Basis = z.infer<typeof Basis>;

export const LedgerKind = z.enum(["covered", "repayment", "unaccounted"]);
export type LedgerKind = z.infer<typeof LedgerKind>;

export const ProtoSource = z.enum(["calendar", "message", "txn"]);
export type ProtoSource = z.infer<typeof ProtoSource>;

export const AliasKind = z.enum(["display_name", "nickname", "phone", "email", "handle", "merchant_name"]);
export type AliasKind = z.infer<typeof AliasKind>;

export const ReviewKind = z.enum(["alias", "attendees", "payer"]);
export type ReviewKind = z.infer<typeof ReviewKind>;

export const ReviewStatus = z.enum(["open", "answered", "dismissed"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const TxnKind = z.enum(["purchase", "transfer"]);
export type TxnKind = z.infer<typeof TxnKind>;

/** ISO date "YYYY-MM-DD". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Person = z.object({
  id: z.string(),
  displayName: z.string(),
  isUser: z.boolean(),
  /** TODO(stub): social — set when this friend joins the platform. */
  platformUserId: z.string().nullable(),
});
export type Person = z.infer<typeof Person>;

export const PersonAlias = z.object({
  personId: z.string().nullable(), // null = candidate alias awaiting review
  kind: AliasKind,
  value: z.string(),
  status: z.enum(["confirmed", "candidate"]),
});
export type PersonAlias = z.infer<typeof PersonAlias>;

export const Message = z.object({
  id: z.string(),
  threadId: z.string(),
  senderId: z.string().nullable(),
  senderName: z.string(),
  sentAt: z.string(), // ISO timestamp
  body: z.string(),
});
export type Message = z.infer<typeof Message>;

export const CalendarEvent = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string().nullable(),
  attendeeIds: z.array(z.string()),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const Txn = z.object({
  id: z.string(),
  nessieId: z.string(),
  kind: TxnKind,
  amountCents: z.number().int(),
  merchant: z.string().nullable(),
  merchantCategory: z.string().nullable(),
  description: z.string().nullable(),
  occurredOn: IsoDate, // Nessie has date only, no time
  payerId: z.string(),
});
export type Txn = z.infer<typeof Txn>;

export const ProtoEvent = z.object({
  id: z.string(),
  source: ProtoSource,
  sourceRef: z.string(),
  date: IsoDate,
  time: z.string().nullable(),
  description: z.string().nullable(),
  peopleIds: z.array(z.string()),
  /** Source-specific extras (payer hints, amounts mentioned, message ids, looksSocial...). */
  details: z.record(z.string(), z.unknown()),
});
export type ProtoEvent = z.infer<typeof ProtoEvent>;

export const Event = z.object({
  id: z.string(),
  ownerUserId: z.string(), // TODO(stub): social — constant USER_ID in MVP
  canonicalEventId: z.string().nullable(), // TODO(stub): social
  date: IsoDate,
  time: z.string().nullable(),
  description: z.string(),
  attendeeIds: z.array(z.string()),
  totalCents: z.number().int().nullable(),
  sourceCount: z.number().int(),
  isRelevant: z.boolean(),
  confidence: z.number(),
  contextMessageIds: z.array(z.string()),
  anchorTxnId: z.string().nullable(),
});
export type Event = z.infer<typeof Event>;

export const EventPayer = z.object({
  eventId: z.string(),
  personId: z.string(),
  amountCents: z.number().int().nullable(),
  basis: Basis,
  evidenceMessageId: z.string().nullable(),
  txnId: z.string().nullable(),
});
export type EventPayer = z.infer<typeof EventPayer>;

/** Directional: "payer spent amount on beneficiary" (covered) or "payer sent amount to beneficiary" (repayment). */
export const LedgerEntry = z.object({
  id: z.string(),
  eventId: z.string().nullable(), // null for repayments not tied to one event
  payerId: z.string(),
  beneficiaryId: z.string().nullable(), // null only for kind = unaccounted
  amountCents: z.number().int().nonnegative(),
  kind: LedgerKind,
  basis: Basis,
  confidence: z.number(),
  evidenceMessageId: z.string().nullable(),
  txnId: z.string().nullable(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const ReviewItem = z.object({
  id: z.string(),
  kind: ReviewKind,
  txnId: z.string().nullable(),
  eventId: z.string().nullable(),
  question: z.string(),
  /** Candidate person ids offered as answers. */
  optionIds: z.array(z.string()),
  answer: z.unknown().nullable(),
  status: ReviewStatus,
});
export type ReviewItem = z.infer<typeof ReviewItem>;
