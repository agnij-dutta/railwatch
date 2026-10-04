// Builds a Rail Watch snapshot from keyless public APIs and writes
//   data/latest.json
//   data/history/<YYYY-MM-DD>.json
// Usage: npm run fetch            (add --dry to print without writing)
// Needs network access to the public APIs listed in sources.yaml. No keys or env vars.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildHeadline,
  computeRoutes,
  type BookLevel,
  type ChainFeeInput,
  type MidSource,
  type ModelInputs,
  type OrderBookInput,
  type ProviderQuote,
  type Snapshot,
} from "../src/model";
import { loadSources, ROOT } from "./sources";
export const AMOUNTS_USD = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000];
export const DEFAULT_AMOUNT = 1000;
/** Bid levels kept per book. Enough for $10,000 on CoinDCX's INR books at the time of writing; if not, the route is dropped with a warning. */
const BOOK_LEVELS = 50;
const UA = "railwatch/1.0 (+https://github.com/agnij-dutta/railwatch)";
const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const warnings: string[] = [];
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, init: RequestInit = {}, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

const rpc = <T>(url: string, method: string, params: unknown[]) =>
  getJson<{ result: T; error?: { message: string } }>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => {
    if (r.error) throw new Error(`${method}: ${r.error.message}`);
    return r.result;
  });

// ------------------------------------------------------------------ mid-market

async function midSource(id: string, label: string, fn: () => Promise<{ rate: number; asOf: string }>): Promise<MidSource> {
  try {
    const { rate, asOf } = await fn();
    if (!(rate > 50 && rate < 200)) throw new Error(`implausible rate ${rate}`);
    return { id, label, rate, asOf, ok: true };
  } catch (e) {
    warnings.push(`mid-market source ${id} failed: ${(e as Error).message}`);
    return { id, label, rate: null, asOf: null, ok: false, error: (e as Error).message };
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface WiseComparison {
  providers: {
    alias: string;
    name: string;
    type: "bank" | "moneyTransferProvider";
    quotes: {
      fee: number;
      rate: number;
      receivedAmount: number;
      dateCollected: string;
      sourceCountry: string | null;
      isConsideredMidMarketRate: boolean;
    }[];
  }[];
}

async function fetchWise(amount: number): Promise<WiseComparison> {
  return getJson<WiseComparison>(
    `https://api.wise.com/v4/comparisons/?sourceCurrency=USD&targetCurrency=INR&sendAmount=${amount}`,
  );
}

// ------------------------------------------------------------------ order books

async function fetchBook(pair: string): Promise<OrderBookInput | null> {
  try {
    const d = await getJson<{ timestamp: number; bids: Record<string, string> }>(
      `https://public.coindcx.com/market_data/orderbook?pair=${pair}`,
    );
    const bids: BookLevel[] = Object.entries(d.bids)
      .map(([p, q]) => [Number(p), Number(q)] as BookLevel)
      .filter(([p, q]) => p > 0 && q > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, BOOK_LEVELS);
    if (bids.length === 0) throw new Error("empty bid book");
    return { pair, fetchedAt: new Date(d.timestamp).toISOString(), bids };
  } catch (e) {
    warnings.push(`order book ${pair} failed: ${(e as Error).message}`);
    return null;
  }
}

// ------------------------------------------------------------------ chain fees

async function spot(sym: "ETH" | "SOL"): Promise<number> {
  const d = await getJson<{ data: { amount: string } }>(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`);
  return Number(d.data.amount);
}

async function fetchBaseFee(): Promise<ChainFeeInput | null> {
  try {
    const url = "https://mainnet.base.org";
    const gasPrice = BigInt(await rpc<string>(url, "eth_gasPrice", []));
    // GasPriceOracle.getL1FeeUpperBound(uint256 unsignedTxSize), selector 0xf1c7a58b, size 300 bytes.
    const data = "0xf1c7a58b" + (300).toString(16).padStart(64, "0");
    const l1Fee = BigInt(await rpc<string>(url, "eth_call", [{ to: "0x420000000000000000000000000000000000000F", data }, "latest"]));
    const gasUnits = 65_000n;
    const totalWei = gasPrice * gasUnits + l1Fee;
    const ethUsd = await spot("ETH");
    const feeUsd = (Number(totalWei) / 1e18) * ethUsd;
    return {
      network: "base",
      feeUsd,
      fetchedAt: now(),
      detail: `${(Number(gasPrice) / 1e9).toFixed(4)} gwei × 65k gas + L1 data fee, ETH at $${ethUsd.toFixed(0)} = $${feeUsd.toFixed(4)}`,
    };
  } catch (e) {
    warnings.push(`Base fee failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchSolanaFee(): Promise<ChainFeeInput | null> {
  try {
    const fees = await rpc<{ prioritizationFee: number }[]>("https://api.mainnet-beta.solana.com", "getRecentPrioritizationFees", [
      [USDC_MINT_SOLANA],
    ]);
    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    const p75 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))] : 0;
    const cu = 30_000;
    const lamports = 5_000 + (p75 * cu) / 1e6;
    const solUsd = await spot("SOL");
    const feeUsd = (lamports / 1e9) * solUsd;
    return {
      network: "solana",
      feeUsd,
      fetchedAt: now(),
      detail: `5,000 lamport base + p75 priority ${p75.toLocaleString("en-US")} µlamports/CU × 30k CU, SOL at $${solUsd.toFixed(0)} = $${feeUsd.toFixed(4)}`,
    };
  } catch (e) {
    warnings.push(`Solana fee failed: ${(e as Error).message}`);
    return null;
  }
}

// ------------------------------------------------------------------ main

export async function buildSnapshot(): Promise<Snapshot> {
  const { sources, params } = await loadSources();

  // Wise feed at every amount (sequential, gentle on the API).
  const providerQuotes: Record<string, ProviderQuote[]> = {};
  let wiseMid: { rate: number; asOf: string } | null = null;
  for (const amount of AMOUNTS_USD) {
    try {
      const d = await fetchWise(amount);
      providerQuotes[String(amount)] = d.providers.flatMap((p) =>
        p.quotes.slice(0, 1).map((q) => ({
          alias: p.alias,
          name: p.name,
          type: p.type,
          fee: q.fee,
          rate: q.rate,
          receivedAmount: q.receivedAmount,
          collectedAt: q.dateCollected,
          sourceCountry: q.sourceCountry,
        })),
      );
      const w = d.providers.find((p) => p.alias === "wise")?.quotes[0];
      if (w?.isConsideredMidMarketRate && !wiseMid) wiseMid = { rate: w.rate, asOf: w.dateCollected };
    } catch (e) {
      warnings.push(`Wise comparison at $${amount} failed: ${(e as Error).message}`);
    }
    await sleep(400);
  }
  if (Object.keys(providerQuotes).length === 0) throw new Error("Wise comparison feed unavailable, aborting");

  const midSources = await Promise.all([
    midSource("wise", "Wise mid-market", async () => {
      if (!wiseMid) throw new Error("no mid-market quote in feed");
      return wiseMid;
    }),
    midSource("coinbase", "Coinbase exchange rates", async () => {
      const d = await getJson<{ data: { rates: Record<string, string> } }>("https://api.coinbase.com/v2/exchange-rates?currency=USD");
      return { rate: Number(d.data.rates.INR), asOf: now() };
    }),
    midSource("er-api", "ExchangeRate-API (open)", async () => {
      const d = await getJson<{ rates: Record<string, number>; time_last_update_unix: number }>("https://open.er-api.com/v6/latest/USD");
      return { rate: d.rates.INR, asOf: new Date(d.time_last_update_unix * 1000).toISOString() };
    }),
    midSource("frankfurter", "ECB reference via Frankfurter", async () => {
      const d = await getJson<{ rates: Record<string, number>; date: string }>("https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR");
      return { rate: d.rates.INR, asOf: `${d.date}T14:15:00.000Z` };
    }),
  ]);
  const okRates = midSources.filter((s) => s.ok).map((s) => s.rate as number);
  if (okRates.length < 2) throw new Error("fewer than two mid-market sources available, aborting");
  const midRate = median(okRates);
  const spread = (Math.max(...okRates) - Math.min(...okRates)) / midRate;
  if (spread > 0.01) warnings.push(`mid-market sources disagree by ${(spread * 100).toFixed(2)}%`);

  const [usdcInr, usdtInr, usdcUsdt, base, solana] = await Promise.all([
    fetchBook("I-USDC_INR"),
    fetchBook("I-USDT_INR"),
    fetchBook("B-USDC_USDT"),
    fetchBaseFee(),
    fetchSolanaFee(),
  ]);

  const inputs: ModelInputs = {
    midRate,
    providerQuotes,
    books: { usdcInr, usdtInr, usdcUsdt },
    chainFees: { base, solana },
    params,
  };

  const { results, amountsUsd, headline } = computeResults(inputs, providerQuotes, warnings);
  return {
    schemaVersion: 1,
    generatedAt: now(),
    defaultAmountUsd: DEFAULT_AMOUNT,
    amountsUsd,
    mid: { rate: midRate, method: `median of ${okRates.length} sources`, sources: midSources },
    inputs,
    results,
    headline,
    sources,
    warnings,
  };
}

/**
 * Run the cost model at every amount that has provider quotes. Pushes a warning (never silently drops)
 * when a stablecoin route cannot be priced because its inputs were missing or the stored book was too thin.
 * Shared by `fetch` (live inputs) and `recompute` (stored inputs, edited params).
 */
export function computeResults(
  inputs: ModelInputs,
  providerQuotes: Record<string, ProviderQuote[]>,
  warnings: string[],
): { results: Snapshot["results"]; amountsUsd: number[]; headline: Snapshot["headline"] } {
  const results: Snapshot["results"] = {};
  for (const amount of AMOUNTS_USD) {
    if (!providerQuotes[String(amount)]) continue;
    const routes = computeRoutes(inputs, amount);
    results[String(amount)] = routes;
    for (const net of ["base", "solana"] as const) {
      if (!routes.some((r) => r.id === `usdc-${net}`)) {
        warnings.push(`USDC via ${net} not priced at $${amount}: chain fee or order book missing, or the stored ${BOOK_LEVELS} bid levels cannot absorb the amount`);
      }
    }
  }
  const headlineRoutes = results[String(DEFAULT_AMOUNT)];
  if (!headlineRoutes?.length) throw new Error(`no routes computed at $${DEFAULT_AMOUNT}`);
  return {
    results,
    amountsUsd: AMOUNTS_USD.filter((a) => results[String(a)]),
    headline: buildHeadline(headlineRoutes, DEFAULT_AMOUNT),
  };
}

/** Print the default-amount table that the README shows. */
export function printSummary(snap: Snapshot): void {
  console.log(snap.headline.text);
  console.log(`mid ${snap.mid.rate.toFixed(4)} (${snap.mid.method})`);
  for (const r of snap.results[String(snap.defaultAmountUsd)]) {
    console.log(
      `  ${r.shortName.padEnd(18)} ₹${Math.round(r.receivedInr).toLocaleString("en-IN").padStart(9)}  loss ₹${Math.round(r.lossInr).toLocaleString("en-IN").padStart(7)}  ${r.lossBps.toFixed(0).padStart(5)} bps`,
    );
  }
  if (snap.warnings.length) console.warn("warnings:\n  " + snap.warnings.join("\n  "));
}

async function main() {
  const dry = process.argv.includes("--dry");
  const snap = await buildSnapshot();
  const day = snap.generatedAt.slice(0, 10);
  const json = JSON.stringify(snap, null, 1) + "\n";
  printSummary(snap);
  if (dry) {
    console.log("dry run: nothing written");
    return;
  }
  await mkdir(join(ROOT, "data/history"), { recursive: true });
  await writeFile(join(ROOT, "data/latest.json"), json);
  await writeFile(join(ROOT, `data/history/${day}.json`), json);
  console.log(`wrote data/latest.json and data/history/${day}.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
