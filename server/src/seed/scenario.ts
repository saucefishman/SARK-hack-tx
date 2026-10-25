// Scenario file schema (seed/scenario.json = single source of truth for the seed data).
import { AliasKind } from "@sark/shared";
import { z } from "zod";

const Id = z.string();
const Clock = z.string().regex(/^\d{2}:\d{2}$/); // UTC literal
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const At = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/); // UTC literal, no zone suffix

export const ScenarioPerson = z.object({
  id: Id,
  displayName: z.string(), // Instagram sender_name
  isUser: z.boolean(),
  /** First `email` alias = calendar email; 2nd `display_name` alias = full name (calendar displayName). */
  aliases: z.array(z.object({ kind: AliasKind, value: z.string() })),
});
export type ScenarioPerson = z.infer<typeof ScenarioPerson>;

export const ScenarioMessage = z.object({
  thread: z.string(),
  sender: Id,
  at: At,
  text: z.string(),
  /** Overrides the sender_name written to the export (e.g. a nickname). */
  senderName: z.string().optional(),
});
export type ScenarioMessage = z.infer<typeof ScenarioMessage>;

export const ScenarioPayer = z.object({
  person: Id,
  basis: z.enum(["confirmed", "estimated", "assumed"]),
  amountDollars: z.number().int().optional(),
  /** estimated: median of Me's earlier Nessie purchases at this merchant (treated as event totals). */
  estimateFromMerchant: z.string().optional(),
  /** assumed: total = perPersonDollars x headcount. */
  perPersonDollars: z.number().int().optional(),
});
export type ScenarioPayer = z.infer<typeof ScenarioPayer>;

export const ScenarioRepayment = z.object({
  via: z.enum(["message", "nessie"]),
  payer: Id,
  beneficiary: Id,
  amountDollars: z.number().int(),
  date: IsoDay,
  message: ScenarioMessage.optional(), // via message
  description: z.string().optional(), // via nessie
});
export type ScenarioRepayment = z.infer<typeof ScenarioRepayment>;

export const ScenarioEvent = z.object({
  key: z.string(),
  date: IsoDay,
  time: Clock.optional(),
  description: z.string(),
  scenarios: z.array(z.number().int()),
  attendees: z.array(Id),
  payers: z.array(ScenarioPayer),
  /** Me made a Nessie purchase for this event; amount = Me's payer amount. */
  nessie: z.object({ merchant: z.string(), category: z.array(z.string()) }).optional(),
  messages: z.array(ScenarioMessage),
  calendar: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      durationMin: z.number().int(),
      /** Attendees listed by displayName only (no email). Default: email + displayName. */
      nameOnly: z.array(Id).optional(),
    })
    .optional(),
  repayments: z.array(ScenarioRepayment).optional(),
  expected: z.object({
    relevant: z.boolean(),
    note: z.string(),
    review: z.array(z.object({ kind: z.enum(["alias", "attendees", "payer"]) })).optional(),
  }),
});
export type ScenarioEvent = z.infer<typeof ScenarioEvent>;

export const Scenario = z.object({
  version: z.literal(1),
  userId: Id,
  note: z.string().optional(),
  people: z.array(ScenarioPerson),
  threads: z.array(z.object({ key: z.string(), title: z.string(), participants: z.array(Id) })),
  events: z.array(ScenarioEvent),
});
export type Scenario = z.infer<typeof Scenario>;
