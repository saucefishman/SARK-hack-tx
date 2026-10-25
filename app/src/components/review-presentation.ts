import type { ReviewItemDto } from '@sark/shared';
import { formatDate } from '../format';

/** Present the existing review DTO without guessing amounts or participants. */
export function reviewPresentation(item: ReviewItemDto) {
  const date = item.eventSummary.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const title = item.eventSummary.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/\s*\(transaction only\)$/, '');
  const amount = item.question.match(/\$[\d,]+(?:\.\d{2})?/)?.[0];
  return { title, date: date ? formatDate(date) : undefined, amount,
    prompt: item.kind === 'attendees' ? 'Who was there?' : item.kind === 'payer' ? 'Who paid?' : item.question,
    hint: item.kind === 'attendees' ? 'Select everyone who joined you.' : 'Select one person.' };
}
