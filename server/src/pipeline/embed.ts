// Embed stage: every message lacking an embedding (or embedded by a different model) gets one.
// Writes message.embedding (real[], always) and message.embedding_vec (pgvector, when the column exists).
import type { Db } from "../db/pool";
import { embedTexts, getEmbedder, pgArray, pgVector, type Embedder } from "../llm/embed";

export interface EmbedOptions {
  embedder?: Embedder;
  /** Messages per embed call (default 100). */
  batchSize?: number;
}
export interface EmbedCounts {
  /** Messages embedded this run. */
  embedded: number;
  /** Messages already up to date. */
  skipped: number;
}

export async function hasVectorColumn(db: Db): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'message' AND column_name = 'embedding_vec' AND table_schema = current_schema()",
  );
  return rows.length > 0;
}

export async function embedMessages(db: Db, opts: EmbedOptions = {}): Promise<EmbedCounts> {
  const embedder = opts.embedder ?? getEmbedder();
  const size = opts.batchSize ?? 100;
  const vec = await hasVectorColumn(db);
  const { rows: todo } = await db.query<{ id: string; body: string }>(
    "SELECT id, body FROM message WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1 ORDER BY id",
    [embedder.model],
  );
  for (let i = 0; i < todo.length; i += size) {
    const batch = todo.slice(i, i + size);
    const vecs = await embedTexts(db, batch.map((m) => m.body), embedder);
    await db.tx(async (t) => {
      for (let j = 0; j < batch.length; j++) {
        const v = vecs[j]!;
        if (vec) {
          await t.query("UPDATE message SET embedding = $2::real[], embedding_vec = $3::vector, embedding_model = $4 WHERE id = $1", [
            batch[j]!.id, pgArray(v), pgVector(v), embedder.model,
          ]);
        } else {
          await t.query("UPDATE message SET embedding = $2::real[], embedding_model = $3 WHERE id = $1", [batch[j]!.id, pgArray(v), embedder.model]);
        }
      }
    });
  }
  const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM message");
  return { embedded: todo.length, skipped: Number(rows[0]!.n) - todo.length };
}
