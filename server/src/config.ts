// The one config loader. Reads env (repo-root .env), fails fast on bad values.
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: path.join(REPO_ROOT, ".env"), quiet: true });

const Env = z.object({
  DATABASE_URL: z.string().default("pglite://./.pgdata"),
  NESSIE_API_KEY: z.string().optional(),
  NESSIE_BASE_URL: z.string().default("https://prod-api.nessieisreal.com"),
  NESSIE_SOURCE: z.enum(["file", "api"]).default("file"),
  // Generation (structured output + web search) runs on Meta's Model API (Muse); see src/llm/muse.ts.
  META_API_KEY: z.string().optional(),
  META_BASE_URL: z.string().default("https://api.meta.ai/v1"),
  LLM_MODEL: z.string().default("muse-spark-1.3-contributor"),
  // Muse reasoning effort. "none" (rejected by Muse Spark) and "max" (not on contributor models) are left out on purpose.
  LLM_REASONING: z.enum(["default", "minimal", "low", "medium", "high", "xhigh"]).default("low"),
  LLM_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  // Embeddings only (EMBED_MODE=live): Meta's Model API has no embedding model.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_EMBED_MODEL: z.string().default("gemini-embedding-001"),
  EMBED_MODE: z.enum(["local", "live"]).default("local"),
  LLM_MODE: z.enum(["live", "replay"]).default("replay"),
  MESSAGES_DIR: z.string().default("./seed/generated/instagram"),
  CALENDAR_FILE: z.string().default("./seed/generated/calendar.json"),
  NESSIE_FILE: z.string().default("./seed/generated/nessie.json"),
  PORT: z.coerce.number().int().default(3000),
  // Demo clock (YYYY-MM-DD). Calendar entries after it are plans (payback), not past events. Default: today (UTC).
  AS_OF_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Payback suggestions (DESIGN §15/§16). SerpAPI prices new ideas; replay reads server/test/fixtures/serpapi/.
  SERPAPI_API_KEY: z.string().optional(),
  SERPAPI_MODE: z.enum(["live", "replay"]).default("replay"),
  SERPAPI_MAX_CALLS: z.coerce.number().int().min(0).default(20),
  HOME_CITY: z.string().default("Austin, Texas"),
  PAYBACK_TOLERANCE_PCT: z.coerce.number().min(0).default(10),
  PAYBACK_TOLERANCE_MIN_CENTS: z.coerce.number().int().min(0).default(1000),
  PAYBACK_MAX_BUNDLE: z.coerce.number().int().min(1).max(5).default(3),
  // LangSmith tracing (off by default; read by src/obs/tracing.ts). Traces include prompt text.
  LANGSMITH_TRACING: z.enum(["true", "false"]).optional(),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().optional(),
  LANGSMITH_ENDPOINT: z.string().optional(),
  LANGSMITH_HIDE_INPUTS: z.enum(["true", "false"]).optional(),
  LANGSMITH_HIDE_OUTPUTS: z.enum(["true", "false"]).optional(),
});
export type Config = z.infer<typeof Env> & {
  /** Absolute path resolver for repo-relative paths in env. */
  resolvePath: (p: string) => string;
};

/** The demo clock: AS_OF_DATE, else today (UTC), as YYYY-MM-DD. */
export function getAsOf(cfg: Pick<Config, "AS_OF_DATE"> = getConfig()): string {
  return cfg.AS_OF_DATE ?? new Date().toISOString().slice(0, 10);
}

let cached: Config | undefined;

export function getConfig(overrides: Partial<z.input<typeof Env>> = {}): Config {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = Env.safeParse({ ...raw, ...overrides });
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const cfg: Config = {
    ...parsed.data,
    resolvePath: (p) => (path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p)),
  };
  if (cfg.LLM_MODE === "live" && !cfg.META_API_KEY) {
    throw new Error("LLM_MODE=live requires META_API_KEY (Meta Model API key)");
  }
  if (cfg.EMBED_MODE === "live" && !cfg.GEMINI_API_KEY) {
    throw new Error("EMBED_MODE=live requires GEMINI_API_KEY (human task H3)");
  }
  if (cfg.SERPAPI_MODE === "live" && !cfg.SERPAPI_API_KEY) {
    throw new Error("SERPAPI_MODE=live requires SERPAPI_API_KEY (human task H13)");
  }
  if (Object.keys(overrides).length === 0) cached = cfg;
  return cfg;
}
