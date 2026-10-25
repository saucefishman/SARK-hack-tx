import type { ReviewItemDto } from '@sark/shared';
import { formatDate } from '../format';

/** Present the existing review DTO without guessing amounts or participants. */
export function reviewPresentation(item: ReviewItemDto) {
  const date = item.eventSummary.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const title = item.eventSummary.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/\s*\(transaction only\)$/, '') || (item.kind === 'alias' ? 'Match a name' : 'Shared activity');
  const amount = item.kind === 'alias' ? undefined : item.question.match(/\$[\d,]+(?:\.\d{2})?/)?.[0];
  return { title, date: date ? formatDate(date) : undefined, amount,
    eyebrow: item.kind === 'attendees' ? 'SHARED EXPENSE' : item.kind === 'payer' ? 'PAYMENT DETAILS' : 'NAME MATCH',
    prompt: item.kind === 'attendees' ? 'Who joined you?' : item.kind === 'payer' ? 'Who covered this?' : item.question,
    hint: item.kind === 'attendees' ? 'Select everyone who shared this expense.' : item.kind === 'alias' ? 'Choose the person this name refers to.' : 'Choose the person who paid.',
    dismissLabel: item.kind === 'alias' ? 'Dismiss' : 'Not shared' };
}
