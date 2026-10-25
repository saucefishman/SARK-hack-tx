// Semantic search over stored messages (DESIGN §11: pgvector retrieval). Contract used by the
// cost-baseline RAG step. Query is embedded with the same embedder as the stored messages.
import type { Db } from "../db/pool";
import { embedTexts, getEmbedder, pgVector, type Embedder } from "../llm/embed";
import { runTraced } from "../obs/tracing";
import { hasVectorColumn } from "./embed";

export interface MessageHit {
  messageId: string;
  threadId: string;
  senderId: string | null;
  body: string;
  sentAt: string; // ISO timestamp
  /** Higher = more similar (cosine similarity for vectors). */
  score: number;
}

export interface SearchOptions {
  /** Max hits (default 5). */
  k?: number;
  /** Only messages sent strictly before this ISO date/timestamp (no peeking at the future). */
  before?: string;
  /** Skip these message ids (e.g. the event's own context messages). */
  excludeMessageIds?: string[];
  /** Drop hits scoring below this. */
  minScore?: number;
  /** Query embedder (default: module default, see setSearchEmbedder; must match the one used by embedMessages). */
  embedder?: Embedder;
  /** false forces the JS cosine path over message.embedding (default: pgvector when the column exists). */
  useVector?: boolean;
}

export type MessageSearch = (db: Db, query: string, opts?: SearchOptions) => Promise<MessageHit[]>;

let defaultEmbedder: Embedder | undefined;
/** Configure the embedder used for queries when opts.embedder is not given (default: getEmbedder()). */
export function setSearchEmbedder(e: Embedder | undefined): void {
  defaultEmbedder = e;
}

interface Row {
  id: string;
  thread_id: string;
  sender_id: string | null;
  body: string;
  sent_at: string;
  score?: number;
  embedding?: number[];
}
const COLS = `id, thread_id, sender_id, body, to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at`;

const hit = (r: Row, score: number): MessageHit => ({
  messageId: r.id, threadId: r.thread_id, senderId: r.sender_id, body: r.body, sentAt: r.sent_at, score,
});

export const searchMessages: MessageSearch = async (db, query, opts = {}) =>
  runTraced("searchMessages", { query, k: opts.k ?? 5, before: opts.before, minScore: opts.minScore }, () => searchMessagesImpl(db, query, opts), {
    runType: "retriever",
    processOutputs: (hits: MessageHit[]) => ({
      documents: hits.map((h) => ({ messageId: h.messageId, score: h.score, snippet: h.body.slice(0, 80) })),
    }),
  });

const searchMessagesImpl: MessageSearch = async (db, query, opts = {}) => {
  const embedder = opts.embedder ?? (defaultEmbedder ??= getEmbedder());
  const [q] = await embedTexts(db, [query], embedder);
  const k = opts.k ?? 5;
  const min = opts.minScore ?? 0;
  const before = opts.before ?? null;
  const skip = opts.excludeMessageIds ?? [];
  const order = (a: MessageHit, b: MessageHit) => b.score - a.score || a.messageId.localeCompare(b.messageId);

  let hits: MessageHit[];
  if (opts.useVector !== false && (await hasVectorColumn(db))) {
    const { rows } = await db.query<Row & { score: number }>(
      `SELECT ${COLS}, 1 - (embedding_vec <=> $1::vector) AS score FROM message
       WHERE embedding_vec IS NOT NULL AND embedding_model = $2
         AND ($3::timestamptz IS NULL OR sent_at < $3::timestamptz)
         AND NOT (id = ANY($4::text[]))
       ORDER BY embedding_vec <=> $1::vector, id LIMIT $5`,
      [pgVector(q!), embedder.model, before, skip, k],
    );
    hits = rows.map((r) => hit(r, Number(r.score)));
  } else {
    const { rows } = await db.query<Row>(
      `SELECT ${COLS}, embedding FROM message
       WHERE embedding IS NOT NULL AND embedding_model = $1
         AND ($2::timestamptz IS NULL OR sent_at < $2::timestamptz)
         AND NOT (id = ANY($3::text[]))`,
      [embedder.model, before, skip],
    );
    hits = rows.map((r) => hit(r, cosine(q!, r.embedding!.map(Number))));
  }
  return hits.filter((h) => h.score > min).sort(order).slice(0, k);
};

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
