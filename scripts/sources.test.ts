import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODELED_PARAM_KEYS } from "../src/model";
import { loadSources } from "./sources";

function yamlFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "railwatch-"));
  const path = join(dir, "sources.yaml");
  writeFileSync(path, body);
  return path;
}

const entry = (over: Record<string, string>) =>
  "  - " +
  Object.entries({ id: "x", label: "X", status: "modeled", publisher: "P", url: "https://example.com", note: "n", value: "1", as_of: '"2026-01-01"', ...over })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n    ");

describe("sources.yaml", () => {
  it("the committed file provides every model param with a dated, cited value", async () => {
    const { sources, params } = await loadSources();
    for (const k of MODELED_PARAM_KEYS) expect(typeof params[k]).toBe("number");
    for (const s of sources.filter((x) => x.status !== "live")) {
      expect(s.asOf, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it("rejects a modeled entry with no as_of date", async () => {
    await expect(loadSources(yamlFile(`sources:\n${entry({ as_of: "" })}\n`))).rejects.toThrow(/as_of/);
  });

  it("rejects an unknown param name", async () => {
    await expect(loadSources(yamlFile(`sources:\n${entry({ param: "typoRate" })}\n`))).rejects.toThrow(/unknown param "typoRate"/);
  });

  it("rejects a file that leaves a model param unset", async () => {
    await expect(loadSources(yamlFile(`sources:\n${entry({ param: "tdsRate" })}\n`))).rejects.toThrow(/no entry provides param/);
  });
});
