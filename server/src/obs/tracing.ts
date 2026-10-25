// The ONE tracing module (LangSmith). Off by default; everything here is a no-op unless
// LANGSMITH_TRACING=true AND LANGSMITH_API_KEY is set. When on, prompt text (incl. message contents) is sent to LangSmith.
import { Client } from "langsmith";
import { getCurrentRunTree, isTraceableFunction, traceable } from "langsmith/traceable";
import { wrapGemini } from "langsmith/wrappers/gemini";
import "../config"; // loads .env before we read LANGSMITH_* from process.env

export type TraceRunType = "chain" | "llm" | "retriever" | "embedding" | "tool";

export interface TraceOptions {
  runType?: TraceRunType;
  metadata?: Record<string, unknown>;
  tags?: string[];
  /** Map the function's return value to the run's recorded outputs (keep big/private data out of traces). */
  processOutputs?: (result: any) => Record<string, unknown>;
}

export { isTraceableFunction };

/** True only when LANGSMITH_TRACING is "true" and LANGSMITH_API_KEY is set. Read live (tests toggle env). */
export function tracingEnabled(): boolean {
  return process.env.LANGSMITH_TRACING === "true" && !!process.env.LANGSMITH_API_KEY;
}

let client: Client | undefined;
/** The shared LangSmith client (lazy; reads LANGSMITH_ENDPOINT / API_KEY / HIDE_INPUTS / HIDE_OUTPUTS from env). */
export function getTracingClient(): Client {
  return (client ??= new Client());
}
/** Tests: inject a client that cannot reach the network (pass undefined to reset). */
export function setTracingClient(c: Client | undefined): void {
  client = c;
}

/** `fn` unchanged when disabled, else a LangSmith-traceable version of it. */
export function traced<A extends unknown[], R>(name: string, fn: (...args: A) => R, opts: TraceOptions = {}): (...args: A) => R {
  if (!tracingEnabled()) return fn;
  return traceable(fn as (...args: any[]) => any, {
    name,
    run_type: opts.runType ?? "chain",
    metadata: opts.metadata,
    tags: opts.tags,
    client: getTracingClient(),
    tracingEnabled: true,
    // langsmith wraps non-object returns (arrays, primitives) as { outputs }; hand the raw value to processOutputs.
    ...(opts.processOutputs
      ? { processOutputs: (o: Record<string, unknown>) => opts.processOutputs!(Object.keys(o).length === 1 && "outputs" in o ? o.outputs : o) }
      : {}),
  }) as unknown as (...args: A) => R;
}

/** Runs `fn` inside a traced run with explicit `inputs` (recorded as the run's inputs). Plain `fn()` when disabled. */
export function runTraced<R>(name: string, inputs: Record<string, unknown>, fn: () => Promise<R>, opts: TraceOptions = {}): Promise<R> {
  if (!tracingEnabled()) return fn();
  return traced(name, async (_inputs: Record<string, unknown>) => fn(), opts)(inputs);
}

/** Adds metadata to the currently running traced run (no-op when disabled or outside a run). */
export function annotateRun(metadata: Record<string, unknown>): void {
  if (!tracingEnabled()) return;
  const rt = getCurrentRunTree(true);
  if (!rt) return;
  rt.metadata = { ...rt.metadata, ...metadata };
}

/** The Gemini SDK instance, traced (each generateContent becomes an `llm` run with tokens) when enabled. */
export function wrapGenAI<T extends { models: { generateContent: (...a: any[]) => any; generateContentStream: (...a: any[]) => any } }>(ai: T): T {
  if (!tracingEnabled()) return ai;
  return wrapGemini(ai, { client: getTracingClient(), tracingEnabled: true });
}

/** Waits for pending trace batches to be delivered. No-op when disabled; never throws. */
export async function flushTraces(): Promise<void> {
  if (!tracingEnabled() || !client) return;
  try {
    await client.awaitPendingTraceBatches();
  } catch (e) {
    console.warn(`tracing: flush failed: ${e instanceof Error ? e.message : e}`);
  }
}
