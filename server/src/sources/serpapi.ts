// The one SerpAPI adapter (DESIGN §15.3 C). Only this file knows SerpAPI's URL and params.
// Replay reads hand-written fixtures and never touches the network. Live is cached in price_quote and capped per run.
// TODO(stub): serpapi-live: live path is untested against the real API (needs SERPAPI_API_KEY, human task H13).
import fs from "node:fs";
import path from "node:path";
import { getConfig, REPO_ROOT } from "../config";
import type { Db } from "../db/pool";

export type SerpEngine = "google_events" | "google_maps";

export interface SerpApiClient {
  search(engine: SerpEngine, query: string, location: string): Promise<unknown>;
}

/** Replay found no fixture. Discovery treats it as "no results for this query", not as a failure. */
export class SerpReplayMiss extends Error {
  constructor(public file: string) {
    super(`SerpAPI replay miss: create ${file} with the response JSON`);
  }
}

/** Over SERPAPI_MAX_CALLS for this run. */
export class SerpBudgetExceeded extends Error {}

export const FIXTURES_DIR = path.join(REPO_ROOT, "server/test/fixtures/serpapi");

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const fixtureName = (engine: SerpEngine, query: string) => `${engine}__${slug(query)}.json`;

export function replayClient(dir: string = FIXTURES_DIR): SerpApiClient {
  return {
    async search(engine, query) {
      const file = path.join(dir, fixtureName(engine, query));
      if (!fs.existsSync(file)) throw new SerpReplayMiss(file);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
  };
}

export function liveClient(apiKey: string, fetchImpl: typeof fetch = fetch): SerpApiClient {
  return {
    async search(engine, query, location) {
      const p = new URLSearchParams({ engine, q: query, api_key: apiKey });
      if (engine === "google_events") p.set("location", location);
      if (engine === "google_maps") p.set("type", "search");
      const res = await fetchImpl(`https://serpapi.com/search.json?${p}`);
      if (!res.ok) throw new Error(`SerpAPI ${engine} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
  };
}

export function defaultSerpClient(): SerpApiClient {
  const cfg = getConfig();
  return cfg.SERPAPI_MODE === "live" ? liveClient(cfg.SERPAPI_API_KEY!) : replayClient();
}

/**
 * Cached, budgeted search. `calls` counts only requests that reach the client (cache hits are free).
 * Cache key = engine + normalized query + location + day, so a day's repeat runs cost nothing.
 */
export function cachedSerp(db: Db, client: SerpApiClient, opts: { day: string; location: string; maxCalls: number }) {
  const state = { calls: 0, hits: 0 };
  return {
    state,
    async search(engine: SerpEngine, query: string): Promise<unknown> {
      const key = `${engine}|${slug(query)}|${slug(opts.location)}|${opts.day}`;
      const { rows } = await db.query<{ response: unknown }>("SELECT response FROM price_quote WHERE key = $1", [key]);
      if (rows[0]) {
        state.hits++;
        return rows[0].response;
      }
      if (state.calls >= opts.maxCalls) throw new SerpBudgetExceeded(`SERPAPI_MAX_CALLS=${opts.maxCalls} reached`);
      state.calls++;
      const response = await client.search(engine, query, opts.location);
      await db.query(
        `INSERT INTO price_quote (key, engine, query, location, response) VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (key) DO NOTHING`,
        [key, engine, query, opts.location, JSON.stringify(response)],
      );
      return response;
    },
  };
}
