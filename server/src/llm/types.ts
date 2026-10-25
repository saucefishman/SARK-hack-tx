// Prompt contract for llm/gemini.ts. Each prompt in llm/prompts/ exports one PromptDef.
import type { z } from "zod";

export interface PromptDef<I, O> {
  /** e.g. "messageDay". Also the fixture subfolder name. */
  id: string;
  /** Bump when render() or schema changes; part of the cache key. */
  version: string;
  /** Response schema; converted to JSON schema for Gemini structured output. */
  schema: z.ZodType<O>;
  render(input: I): string;
  /**
   * Human-readable key for hand-written replay fixtures:
   * server/test/fixtures/llm/<id>/<fixtureKey(input)>.json holds the response O.
   * Must be filesystem-safe and stable for the seed scenario (e.g. "2026-03-12__alex-thread").
   */
  fixtureKey(input: I): string;
}
