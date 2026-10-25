-- pgvector retrieval (DESIGN 11). Guarded: where the `vector` extension is unavailable this still succeeds,
-- and retrieval falls back to cosine over message.embedding (real[]), which is always populated.
ALTER TABLE message ADD COLUMN IF NOT EXISTS embedding_model text;

CREATE TABLE IF NOT EXISTS embedding_cache (
  key        text PRIMARY KEY,       -- sha256(model + dims + text)
  model      text NOT NULL,
  dims       int  NOT NULL,
  embedding  real[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable (%); skipping embedding_vec', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE message ADD COLUMN IF NOT EXISTS embedding_vec vector(768)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS message_embedding_hnsw ON message USING hnsw (embedding_vec vector_cosine_ops)';
  END IF;
END $$;
