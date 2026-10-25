// Pipeline orchestrator (DESIGN 4): ingest -> embed -> protoEvents -> merge -> relevance -> attribution -> ledger.
// Every stage is idempotent, so any `from` stage can be rerun on its own.
import type { Db } from "../db/pool";
import { getConfig } from "../config";
import { defaultSources } from "../sources";
import type { Embedder } from "../llm/embed";
import type { GenerateOptions } from "../llm";
import { runAttribution } from "./attribution";
import { embedMessages } from "./embed";
import { ingest, type IngestSources } from "./ingest";
import { runLedger } from "./ledger";
import { mergeEvents } from "./merge";
import { buildProtoEvents } from "./protoEvents";
import { runRelevance } from "./relevance";

export type Stage = "ingest" | "embed" | "protoEvents" | "merge" | "relevance" | "attribution" | "ledger";
export const STAGES: Stage[] = ["ingest", "embed", "protoEvents", "merge", "relevance", "attribution", "ledger"];

export interface RunOptions {
  from?: Stage;
  llmMode?: "live" | "replay";
  /** Ingest sources (default: from env via defaultSources). */
  sources?: IngestSources;
  /** Progress logger (default silent). */
  log?: (line: string) => void;
  /** Message embedder (default: from EMBED_MODE; local = offline). */
  embedder?: Embedder;
  /** Extra generateStructured options (tests: custom client / fixtures dir). */
  llm?: GenerateOptions;
}

/** Counts per stage, flattened as "<stage>.<name>". */
export async function runPipeline(db: Db, opts: RunOptions = {}): Promise<Record<string, number>> {
  const from = opts.from ?? "ingest";
  const start = STAGES.indexOf(from);
  if (start < 0) throw new Error(`unknown stage "${from}" (expected one of ${STAGES.join(", ")})`);
  const log = opts.log ?? (() => {});
  const out: Record<string, number> = {};
  const llm = { llmMode: opts.llmMode, llm: opts.llm };
  const record = (stage: Stage, counts: object) => {
    const flat = Object.entries(counts).map(([k, v]) => {
      out[`${stage}.${k}`] = v as number;
      return `${k}=${v}`;
    });
    log(`[${stage}] ${flat.join(" ")}`);
  };
  for (const stage of STAGES.slice(start)) {
    switch (stage) {
      case "ingest":
        record(stage, await ingest(db, opts.sources ?? defaultSources(getConfig())));
        break;
      case "embed":
        record(stage, await embedMessages(db, { embedder: opts.embedder }));
        break;
      case "protoEvents":
        record(stage, await buildProtoEvents(db, llm));
        break;
      case "merge":
        record(stage, await mergeEvents(db, llm));
        break;
      case "relevance":
        record(stage, await runRelevance(db));
        break;
      case "attribution":
        record(stage, await runAttribution(db, llm));
        break;
      case "ledger":
        record(stage, await runLedger(db));
        break;
    }
  }
  return out;
}

/** Clears everything the pipeline derives (not the raw ingest tables or the llm_cache). Used by `pnpm demo`. */
export async function resetPipelineTables(db: Db): Promise<void> {
  await db.exec(`
    DELETE FROM ledger_entry;
    DELETE FROM review_item WHERE kind IN ('attendees','payer') OR status <> 'open';
    DELETE FROM event_payer;
    DELETE FROM event_source;
    DELETE FROM event;
    DELETE FROM proto_event;
  `);
}
