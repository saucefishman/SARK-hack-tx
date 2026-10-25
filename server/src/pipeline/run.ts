// TODO(stub): pipeline — replaced by the real orchestrator.
import type { Db } from "../db/pool";

export type Stage = "ingest" | "protoEvents" | "merge" | "relevance" | "attribution" | "ledger";

export async function runPipeline(
  _db: Db,
  _opts: { from?: Stage; llmMode?: "live" | "replay" } = {},
): Promise<Record<string, number>> {
  throw new Error("not implemented"); // TODO(stub): pipeline
}
