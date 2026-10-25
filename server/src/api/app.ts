// Fastify app factory. Routes per BUILDPLAN section 7.
import cors from "@fastify/cors";
import { EventEditBody, ReviewAnswerBody, type HealthResponse } from "@sark/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { getConfig } from "../config";
import { getFriendDetail, getFriendSummaries, listOpenReviewItems } from "../db/queries";
import type { Db } from "../db/pool";
import type { IngestSources } from "../pipeline/ingest";
import { dismissSuggestion, solveFriend } from "../pipeline/payback";
import { applyReviewAnswer, editEvent } from "../pipeline/review";
import { runPipeline } from "../pipeline/run";

export async function buildApp(opts: { db: Db; llmMode?: "live" | "replay"; sources?: IngestSources }): Promise<FastifyInstance> {
  const { db } = opts;
  const llmMode = opts.llmMode ?? getConfig().LLM_MODE;
  const app = Fastify();
  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "PATCH"] });

  app.get("/health", async (): Promise<HealthResponse> => ({ ok: true, llmMode }));

  app.get("/friends", async () => getFriendSummaries(db));

  app.get<{ Params: { id: string } }>("/friends/:id", async (req, reply) => {
    const detail = await getFriendDetail(db, req.params.id);
    if (!detail) return reply.code(404).send({ error: "friend not found" });
    return detail;
  });

  // Payback (DESIGN §15.6): debt-led ways to settle. Reads stored candidates; never calls Meta's API or SerpAPI.
  app.get<{ Params: { id: string } }>("/friends/:id/payback", async (req, reply) => {
    const { rows } = await db.query("SELECT 1 FROM person WHERE id = $1 AND is_user = false", [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: "friend not found" });
    return solveFriend(db, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/payback/:id/dismiss", async (req, reply) => {
    const friendId = await dismissSuggestion(db, req.params.id);
    if (!friendId) return reply.code(404).send({ error: "suggestion not found" });
    return solveFriend(db, friendId);
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

  app.patch<{ Params: { id: string } }>("/events/:id", async (req, reply) => {
    const parsed = EventEditBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });
    const affected = await editEvent(db, req.params.id, parsed.data);
    if (!affected) return reply.code(404).send({ error: "event not found" });
    return getFriendSummaries(db, affected);
  });

  if (process.env.NODE_ENV !== "production") {
    app.post("/dev/rerun", async () => runPipeline(db, { llmMode: "replay", sources: opts.sources }));
  }

  return app;
}
