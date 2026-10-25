import type { PromptDef } from "../types";
import { MessageDayOutput } from "../schemas/messageDay";
import { json, RULES, slug } from "./util";

export interface Person {
  id: string;
  name: string;
  aliases?: string[];
}

export interface MessageDayInput {
  threadId: string;
  threadTitle: string;
  date: string;
  people: Person[];
  messages: { id: string; senderId: string; senderName: string; time: string; text: string }[];
}

export const messageDay: PromptDef<MessageDayInput, MessageDayOutput> = {
  id: "messageDay",
  version: "2",
  schema: MessageDayOutput,
  fixtureKey: (i) => `${i.date}__${slug(i.threadId)}`,
  render: (i) => `You extract shared social outings (meals, drinks, trips, activities) from one day of one chat thread.

${RULES}

Output JSON {"events": [...]}. One entry per distinct outing that actually happened or was explicitly planned/confirmed that day. Skip pure chit-chat.
Each event:
- date: "YYYY-MM-DD" (the day it happened; normally the thread date).
- time: "HH:MM" if the text gives or implies it, else omit.
- description: short, e.g. "dinner at Uchi".
- peopleIds: ids of everyone who attended, per the text (include "p_me" if the user was there).
- payerId: id of who paid/covered the bill, only if the text says so ("I got it", "my treat"). Else omit.
- amountDollars: the total/bill amount for THIS event, only if stated for this event. Else omit.
- perPersonAmountDollars: a stated PER-PERSON price for THIS event (e.g. "$75 each"), only if stated. Never multiply it yourself and never put it in amountDollars.
- payers: use when more than one person paid part of the bill: [{personId, amountDollars?}] with the amount each says they paid. Omit for a single payer (use payerId).
- coveredPhrases: verbatim phrases showing who covered whom (e.g. "I got dinner").
- paymentMentions: money moving between people mentioned in the messages (venmo, "sent you $20", "you owe me"): {messageId, fromId?, toId?, amountDollars?, text}.
- sourceMessageIds: ids of messages supporting this event.

Important:
- Lunch and dinner (or any clearly separate outings) on the same day are SEPARATE events.
- If an amount refers to a different or earlier event (e.g. paying back last week's dinner), do NOT use it as this event's amountDollars; put it in paymentMentions or omit it.
- Use only the person ids below. Sender ids are given on each message.

Thread: ${i.threadTitle} (${i.threadId}), date ${i.date}
People:
${json(i.people)}
Messages:
${json(i.messages)}`,
};
