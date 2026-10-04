import { computeRoutes } from "./routes";
import type { ModelInputs, ModelOptions, RouteResult } from "./types";

export interface AmountRow {
  amountUsd: number;
  routes: RouteResult[];
  bestLicensed: RouteResult;
  bestStablecoin: RouteResult | null;
}

export interface WinnerRange {
  routeId: string;
  name: string;
  from: number;
  to: number;
}

export function amountRows(inputs: ModelInputs, amounts: number[], opts: ModelOptions = {}): AmountRow[] {
  return amounts.map((amountUsd) => {
    const routes = computeRoutes(inputs, amountUsd, opts);
    return {
      amountUsd,
      routes,
      bestLicensed: routes.filter((r) => r.family !== "stablecoin")[0],
      bestStablecoin: routes.filter((r) => r.family === "stablecoin")[0] ?? null,
    };
  });
}

/** Consecutive amount ranges with the same cheapest licensed (non-stablecoin) route. */
export function licensedWinnerRanges(rows: AmountRow[]): WinnerRange[] {
  const out: WinnerRange[] = [];
  for (const row of rows) {
    const w = row.bestLicensed;
    const last = out[out.length - 1];
    if (last && last.routeId === w.id) last.to = row.amountUsd;
    else out.push({ routeId: w.id, name: w.shortName, from: row.amountUsd, to: row.amountUsd });
  }
  return out;
}

/** Amounts at which the best stablecoin route lands more INR than the best licensed route. */
export function stablecoinWins(rows: AmountRow[]): number[] {
  return rows.filter((r) => r.bestStablecoin && r.bestStablecoin.receivedInr > r.bestLicensed.receivedInr).map((r) => r.amountUsd);
}
