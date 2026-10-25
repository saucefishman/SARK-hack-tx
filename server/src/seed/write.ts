// Writes the generated seed (seed/generated/* + seed/truth.json) from seed/scenario.json. Shared by `pnpm seed` and `pnpm demo`.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config";
import { generateSeed, seedFiles, type GeneratedSeed } from "./generate";

export function loadScenario(): { events: unknown[] } & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "seed/scenario.json"), "utf8"));
}

/** Regenerates `<seedDir>/generated` and `<seedDir>/truth.json` (default repo seed/). */
export function writeSeed(seedDir = path.join(REPO_ROOT, "seed")): { seed: GeneratedSeed; files: Record<string, string>; events: number } {
  const scenario = loadScenario();
  const seed = generateSeed(scenario);
  const files = seedFiles(seed);
  fs.rmSync(path.join(seedDir, "generated"), { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(seedDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { seed, files, events: scenario.events.length };
}
