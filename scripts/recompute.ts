// Rebuilds the results in data/latest.json from its stored live inputs and the current sources.yaml,
// without touching the network. Use it after editing a modeled fee or statutory rate.
// Usage: npm run recompute         (add --dry to print without writing)

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "../src/model";
import { computeResults, printSummary } from "./fetch";
import { loadSources, ROOT } from "./sources";

/** Warnings that computeResults produces; dropped before recomputing so they are not duplicated. */
const MODEL_WARNING = /^USDC via (base|solana) not priced at /;

export async function recompute(snap: Snapshot): Promise<Snapshot> {
  const { sources, params } = await loadSources();
  const inputs = { ...snap.inputs, params };
  const warnings = snap.warnings.filter((w) => !MODEL_WARNING.test(w));
  const { results, amountsUsd, headline } = computeResults(inputs, inputs.providerQuotes, warnings);
  return { ...snap, recomputedAt: new Date().toISOString(), inputs, sources, results, amountsUsd, headline, warnings };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const latest = join(ROOT, "data/latest.json");
  if (!existsSync(latest)) throw new Error("data/latest.json not found. Run `npm run fetch` first.");
  const snap = await recompute(JSON.parse(await readFile(latest, "utf8")) as Snapshot);
  printSummary(snap);
  if (dry) {
    console.log("dry run: nothing written");
    return;
  }
  const json = `${JSON.stringify(snap, null, 1)}\n`;
  await writeFile(latest, json);
  const history = join(ROOT, `data/history/${snap.generatedAt.slice(0, 10)}.json`);
  await writeFile(history, json);
  console.log(`rewrote data/latest.json and ${history.slice(ROOT.length + 1)} (live inputs from ${snap.generatedAt} kept)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
