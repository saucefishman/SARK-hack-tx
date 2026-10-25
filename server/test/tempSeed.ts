import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../src/config";
import { generateSeed, seedFiles } from "../src/seed/generate";

/** Writes the generated seed to a temp dir; returns its `generated` dir. */
export function writeTempSeed(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sark-seed-"));
  const scenario = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "seed/scenario.json"), "utf8"));
  for (const [rel, content] of Object.entries(seedFiles(generateSeed(scenario)))) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return path.join(root, "generated");
}
