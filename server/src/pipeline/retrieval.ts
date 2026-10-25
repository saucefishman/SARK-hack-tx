// Semantic search over stored messages (DESIGN §11: pgvector retrieval). Contract used by the
// cost-baseline RAG step; implementation swaps from keyword overlap to pgvector without touching callers.
import type { Db } from "../db/pool";

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
}

export type MessageSearch = (db: Db, query: string, opts?: SearchOptions) => Promise<MessageHit[]>;

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9$']+/g) ?? []);

/** TODO(stub): retrieval — keyword-overlap placeholder; replaced by pgvector search over message embeddings. */
export const searchMessages: MessageSearch = async (db, query, opts = {}) => {
  const { rows } = await db.query<{ id: string; thread_id: string; sender_id: string | null; body: string; sent_at: string }>(
    `SELECT id, thread_id, sender_id, body, to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at
     FROM message WHERE ($1::timestamptz IS NULL OR sent_at < $1::timestamptz)`,
    [opts.before ?? null],
  );
  const q = tokens(query);
  const skip = new Set(opts.excludeMessageIds ?? []);
  return rows
    .filter((r) => !skip.has(r.id))
    .map((r) => {
      const t = tokens(r.body);
      const overlap = [...q].filter((w) => t.has(w)).length;
      return { messageId: r.id, threadId: r.thread_id, senderId: r.sender_id, body: r.body, sentAt: r.sent_at, score: q.size ? overlap / q.size : 0 };
    })
    .filter((h) => h.score > (opts.minScore ?? 0))
    .sort((a, b) => b.score - a.score || a.messageId.localeCompare(b.messageId))
    .slice(0, opts.k ?? 5);
};
