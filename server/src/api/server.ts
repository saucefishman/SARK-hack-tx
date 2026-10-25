// Starts the Fastify API on an already-migrated Db. Shared by `pnpm dev` (main.ts) and `pnpm demo`.
import type { FastifyInstance } from "fastify";
import { getConfig } from "../config";
import type { Db } from "../db/pool";
import { buildApp } from "./app";

export async function startServer(db: Db, opts: { port?: number; llmMode?: "live" | "replay" } = {}): Promise<FastifyInstance> {
  const app = await buildApp({ db, llmMode: opts.llmMode });
  const port = opts.port ?? getConfig().PORT;
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`API listening on :${port}`);
  return app;
}
