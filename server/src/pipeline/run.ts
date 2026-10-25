// Pipeline orchestrator (DESIGN 4): ingest -> embed -> protoEvents -> merge -> relevance -> attribution -> ledger -> payback.
// Every stage is idempotent, so any `from` stage can be rerun on its own.
import type { Db } from "../db/pool";
import { getConfig } from "../config";
import { runTraced } from "../obs/tracing";
import { defaultSources } from "../sources";
import type { Embedder } from "../llm/embed";
import type { GenerateOptions } from "../llm";
import { runAttribution } from "./attribution";
import { embedMessages } from "./embed";
import { ingest, type IngestSources } from "./ingest";
import { runLedger } from "./ledger";
import { runPayback } from "./payback";
import { mergeEvents } from "./merge";
import { buildProtoEvents } from "./protoEvents";
import { runRelevance } from "./relevance";

export type Stage = "ingest" | "embed" | "protoEvents" | "merge" | "relevance" | "attribution" | "ledger" | "payback";
export const STAGES: Stage[] = ["ingest", "embed", "protoEvents", "merge", "relevance", "attribution", "ledger", "payback"];

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
  const cfg = getConfig();
  const meta = {
    from: opts.from ?? "ingest",
    llmMode: opts.llmMode ?? cfg.LLM_MODE,
    embedMode: opts.embedder ? opts.embedder.model : cfg.EMBED_MODE,
    model: opts.llm?.model ?? cfg.LLM_MODEL,
  };
  return runTraced("pipeline", meta, () => runPipelineImpl(db, opts), { metadata: meta, processOutputs: (o) => o });
}

async function runPipelineImpl(db: Db, opts: RunOptions): Promise<Record<string, number>> {
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
  const runStage = async (stage: Stage): Promise<object> => {
    switch (stage) {
      case "ingest":
        return ingest(db, opts.sources ?? defaultSources(getConfig()));
      case "embed":
        return embedMessages(db, { embedder: opts.embedder });
      case "protoEvents":
        return buildProtoEvents(db, llm);
      case "merge":
        return mergeEvents(db, llm);
      case "relevance":
        return runRelevance(db);
      case "attribution":
        return runAttribution(db, llm);
      case "ledger":
        return runLedger(db);
      case "payback":
        return runPayback(db, { log });
    }
  };
  for (const stage of STAGES.slice(start)) {
    record(stage, await runTraced(stage, { stage }, () => runStage(stage), { processOutputs: (c) => ({ ...c }) }));
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
