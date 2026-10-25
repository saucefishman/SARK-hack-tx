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
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  LLM_MODE: z.enum(["live", "replay"]).default("replay"),
  MESSAGES_DIR: z.string().default("./seed/generated/instagram"),
  CALENDAR_FILE: z.string().default("./seed/generated/calendar.json"),
  NESSIE_FILE: z.string().default("./seed/generated/nessie.json"),
  PORT: z.coerce.number().int().default(3000),
});
export type Config = z.infer<typeof Env> & {
  /** Absolute path resolver for repo-relative paths in env. */
  resolvePath: (p: string) => string;
};

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
  if (cfg.LLM_MODE === "live" && !cfg.GEMINI_API_KEY) {
    throw new Error("LLM_MODE=live requires GEMINI_API_KEY (human task H3)");
  }
  if (Object.keys(overrides).length === 0) cached = cfg;
  return cfg;
}
