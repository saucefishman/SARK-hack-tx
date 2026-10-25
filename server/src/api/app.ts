// Fastify app factory. Routes per BUILDPLAN section 7.
import cors from "@fastify/cors";
import { ReviewAnswerBody, type HealthResponse } from "@sark/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { getConfig } from "../config";
import { getFriendDetail, getFriendSummaries, listOpenReviewItems } from "../db/queries";
import type { Db } from "../db/pool";
import { applyReviewAnswer } from "../pipeline/review";
import { runPipeline } from "../pipeline/run";

export async function buildApp(opts: { db: Db; llmMode?: "live" | "replay" }): Promise<FastifyInstance> {
  const { db } = opts;
  const llmMode = opts.llmMode ?? getConfig().LLM_MODE;
  const app = Fastify();
  await app.register(cors, { origin: true });

  app.get("/health", async (): Promise<HealthResponse> => ({ ok: true, llmMode }));

  app.get("/friends", async () => getFriendSummaries(db));

  app.get<{ Params: { id: string } }>("/friends/:id", async (req, reply) => {
    const detail = await getFriendDetail(db, req.params.id);
    if (!detail) return reply.code(404).send({ error: "friend not found" });
    return detail;
  });

  app.get("/review", async () => listOpenReviewItems(db));

  app.post<{ Params: { id: string } }>("/review/:id/answer", async (req, reply) => {
    const parsed = ReviewAnswerBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });
    const { rows } = await db.query<{ status: string }>("SELECT status FROM review_item WHERE id = $1", [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: "review item not found" });
    if (rows[0].status !== "open") return reply.code(409).send({ error: "review item not open" });
    const affected = await applyReviewAnswer(db, req.params.id, parsed.data);
    return getFriendSummaries(db, affected);
  });

  if (process.env.NODE_ENV !== "production") {
    app.post("/dev/rerun", async () => runPipeline(db, { llmMode: "replay" }));
  }

  return app;
}
