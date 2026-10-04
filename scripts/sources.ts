// Loads and validates sources.yaml, the single place every modeled and statutory number lives.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { MODELED_PARAM_KEYS, type ModeledParams, type SourceEntry } from "../src/model";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface YamlSource {
  id: string;
  label: string;
  status: SourceEntry["status"];
  publisher: string;
  url: string;
  note: string;
  param?: string;
  value?: number | string;
  unit?: string;
  as_of?: string;
}

const STATUSES = new Set(["live", "modeled", "statutory"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse sources.yaml into display entries and the numeric params the model consumes.
 * Throws with the offending entry id if anything would make a number untraceable: an unknown
 * status, a modeled or statutory entry without a numeric value or an ISO `as_of` date, a param
 * that the model does not know, a param set twice, or a model param that no entry provides.
 */
export async function loadSources(path = join(ROOT, "sources.yaml")): Promise<{ sources: SourceEntry[]; params: ModeledParams }> {
  const doc = parse(await readFile(path, "utf8")) as { sources?: YamlSource[] };
  if (!Array.isArray(doc?.sources)) throw new Error(`${path}: expected a top-level "sources:" list`);
  const known = new Set<string>(MODELED_PARAM_KEYS);
  const params: Partial<Record<keyof ModeledParams, number>> = {};
  const ids = new Set<string>();

  const sources: SourceEntry[] = doc.sources.map((s) => {
    const where = `sources.yaml entry "${s.id ?? "(no id)"}"`;
    for (const field of ["id", "label", "status", "publisher", "url", "note"] as const) {
      if (typeof s[field] !== "string" || s[field].trim() === "") throw new Error(`${where}: missing "${field}"`);
    }
    if (ids.has(s.id)) throw new Error(`${where}: duplicate id`);
    ids.add(s.id);
    if (!STATUSES.has(s.status)) throw new Error(`${where}: status must be live, modeled or statutory, got "${s.status}"`);
    if (s.status !== "live") {
      if (typeof s.value !== "number") throw new Error(`${where}: ${s.status} entries need a numeric "value"`);
      if (!s.as_of || !ISO_DATE.test(String(s.as_of))) throw new Error(`${where}: ${s.status} entries need "as_of" as a quoted YYYY-MM-DD date`);
    }
    if (s.param !== undefined) {
      if (!known.has(s.param)) throw new Error(`${where}: unknown param "${s.param}". Known: ${MODELED_PARAM_KEYS.join(", ")}`);
      const key = s.param as keyof ModeledParams;
      if (params[key] !== undefined) throw new Error(`${where}: param "${s.param}" is already set by another entry`);
      if (typeof s.value !== "number") throw new Error(`${where}: has param "${s.param}" but no numeric value`);
      params[key] = s.value;
    }
    return {
      id: s.id,
      label: s.label,
      status: s.status,
      url: s.url,
      publisher: s.publisher,
      asOf: s.as_of,
      value: s.value,
      unit: s.unit,
      note: s.note.trim(),
    };
  });

  const missing = MODELED_PARAM_KEYS.filter((k) => params[k] === undefined);
  if (missing.length) throw new Error(`sources.yaml: no entry provides param(s) ${missing.join(", ")}`);
  return { sources, params: params as ModeledParams };
}
