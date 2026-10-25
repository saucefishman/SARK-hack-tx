// Guard: every env var the config loader reads is documented in .env.example (so .env can be synced from it).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/config";

const configKeys = () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "server/src/config.ts"), "utf8");
  const body = src.slice(src.indexOf("const Env = z.object({"), src.indexOf("});", src.indexOf("const Env")));
  return [...body.matchAll(/^\s+([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
};

describe(".env.example", () => {
  it("lists every config key", () => {
    const example = fs.readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");
    const documented = new Set([...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
    const keys = configKeys();
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => !documented.has(k))).toEqual([]);
  });
});
