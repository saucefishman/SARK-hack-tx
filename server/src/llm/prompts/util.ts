// Shared helpers for prompt definitions.
import type { PromptDef } from "../types";

/** Filesystem-safe lowercase slug. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A prompt that also validates its output against its input (e.g. mergeDay id coverage). Throw to reject. */
export interface ValidatedPromptDef<I, O> extends PromptDef<I, O> {
  validate(input: I, output: O): void;
}

export const RULES = `Global rules:
- Never do arithmetic. Report amounts only exactly as the text states them, as a plain number of dollars (e.g. "$42.50" -> 42.5). Never sum, split or estimate.
- Refer to people ONLY by the ids provided in the input. Never invent ids. If someone is not in the list, omit them.
- The user's id is "p_me"; include "p_me" in people/attendee lists whenever the user was there (the user is a participant in every thread they appear in).
- Use null-free JSON: omit optional fields you do not know.`;

export function json(v: unknown): string {
  return JSON.stringify(v, null, 1);
}
