// The one DB handle. postgres://... → pg.Pool (Tiger Data / local Postgres);
// pglite://<dir> or pglite://memory → embedded PGlite (zero-install dev and tests).
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { getConfig } from "../config";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run multiple statements (no params). Used by migrations. */
  exec(sql: string): Promise<void>;
  /** Run fn inside a transaction. */
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
  end(): Promise<void>;
}

export function createDb(url: string = getConfig().DATABASE_URL): Db {
  if (url.startsWith("pglite://")) return pgliteDb(url.slice("pglite://".length));
  return pgDb(url);
}

let shared: Db | undefined;
/** Process-wide singleton built from DATABASE_URL. */
export function getDb(): Db {
  shared ??= createDb();
  return shared;
}

function pgliteDb(location: string): Db {
  const dataDir = location === "memory" || location === "" ? undefined : getConfig().resolvePath(location);
  const lite = new PGlite(dataDir);
  const wrap = (q: Pick<PGlite, "query" | "exec">): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await q.query<T>(sql, params);
      return { rows: res.rows };
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
    tx: (fn) => lite.transaction((t) => fn(wrap(t as unknown as PGlite))),
    end: () => lite.close(),
  });
  return wrap(lite);
}

function pgDb(url: string): Db {
  // libpq semantics for sslmode (as psql): "require" encrypts without verifying the CA.
  // Tiger Data serves a private Timescale CA, which node-pg's default verify-full rejects.
  const u = new URL(url);
  if (!u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
  const pool = new pg.Pool({ connectionString: u.toString() });
  const fromClient = (c: pg.PoolClient | pg.Pool): Omit<Db, "tx" | "end"> => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await c.query(sql, params);
      return { rows: res.rows as T[] };
    },
    async exec(sql: string) {
      await c.query(sql);
    },
  });
  return {
    ...fromClient(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inner: Db = {
          ...fromClient(client),
          tx: (f) => f(inner),
          end: async () => {},
        };
        const r = await fn(inner);
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
