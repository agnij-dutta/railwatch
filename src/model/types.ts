// Shared types for the Rail Watch cost model. Used by the fetcher, the tests and the web app.

export type Asset = "USD" | "USDC" | "USDT" | "INR";

/** Where a number comes from. "live" = fetched at snapshot time, "modeled" = published schedule or assumption, "statutory" = set by law. */
export type DataStatus = "live" | "modeled" | "statutory";

export type HopCategory = "fee" | "fx" | "network" | "tax" | "premium" | "refund";

export interface Hop {
  id: string;
  label: string;
  category: HopCategory;
  status: DataStatus;
  sourceIds: string[];
  /** Cost of this hop in INR, valued at mid-market. Positive = money lost. Negative = money gained. */
  inr: number;
  /** Human-readable detail, e.g. "$40.00 wire fee". */
  detail: string;
  /** INR value of the balance (at mid-market) right after this hop. */
  balanceInrAfter: number;
  /** Balance after this hop in its native asset. */
  asset: Asset;
  qtyAfter: number;
}

export type RouteFamily = "bank" | "provider" | "stablecoin";

export interface RouteResult {
  id: string;
  name: string;
  shortName: string;
  family: RouteFamily;
  amountUsd: number;
  midRate: number;
  /** What you would get at mid-market with zero fees. */
  idealInr: number;
  /** INR that ends up in the Indian bank account (after any tax reserve in the chosen lens). */
  receivedInr: number;
  /** idealInr minus receivedInr. Negative means the route paid more than mid-market. */
  lossInr: number;
  lossBps: number;
  hops: Hop[];
  /** True if any hop relies on modeled (non-live) data. */
  hasModeled: boolean;
  /** Oldest live quote feeding this route (ISO), if known. */
  quoteCollectedAt?: string;
  caveats: string[];
}

export interface MidSource {
  id: string;
  label: string;
  rate: number | null;
  asOf: string | null;
  ok: boolean;
  error?: string;
}

export interface ProviderQuote {
  alias: string;
  name: string;
  type: "bank" | "moneyTransferProvider";
  fee: number;
  rate: number;
  receivedAmount: number;
  collectedAt: string;
  sourceCountry: string | null;
}

/** [price, quantity] sorted best-first. Price is INR (or USDT) per coin, quantity is in coins. */
export type BookLevel = [number, number];

export interface OrderBookInput {
  pair: string;
  fetchedAt: string;
  bids: BookLevel[];
}

export interface ChainFeeInput {
  network: "base" | "solana";
  feeUsd: number;
  detail: string;
  fetchedAt: string;
}

/**
 * Numeric parameters read from sources.yaml. Each key is the `param` field of exactly one source entry,
 * so every modeled or statutory number in the output traces back to a cited, dated line in that file.
 */
export interface ModeledParams {
  /** sources.yaml `chase-usd-wire-fee`. */
  chaseUsdWireFeeUsd: number;
  /** sources.yaml `correspondent-fee`. Assumption: banks do not publish intermediary deductions. */
  correspondentFeeUsd: number;
  /** sources.yaml `gst-currency-conversion`: GST rate applied to the Rule 32(2)(b) value. */
  gstRate: number;
  /** sources.yaml `gst-on-fees`: GST rate on exchange trading and swap fees. */
  gstOnFeesRate: number;
  /** sources.yaml `coinbase-ach`. */
  coinbaseAchDepositUsd: number;
  /** sources.yaml `coinbase-usdc`. */
  coinbaseUsdcConversionFeeRate: number;
  /** sources.yaml `coindcx-deposit`. */
  exchangeDepositFeeUsd: number;
  /** sources.yaml `coindcx-trading-fee`. */
  exchangeTakerFeeRate: number;
  /** sources.yaml `coindcx-swap-fee`. */
  exchangeSwapFeeRate: number;
  /** sources.yaml `tds-194s`. */
  tdsRate: number;
  /** sources.yaml `vda-tax-115bbh`. */
  vdaTaxRate: number;
  /** sources.yaml `health-education-cess`. */
  vdaCessRate: number;
  /** sources.yaml `coindcx-inr-withdrawal`. */
  inrWithdrawalFeeInr: number;
}

/** Every key of ModeledParams, used to validate sources.yaml and old snapshots. */
export const MODELED_PARAM_KEYS = [
  "chaseUsdWireFeeUsd",
  "correspondentFeeUsd",
  "gstRate",
  "gstOnFeesRate",
  "coinbaseAchDepositUsd",
  "coinbaseUsdcConversionFeeRate",
  "exchangeDepositFeeUsd",
  "exchangeTakerFeeRate",
  "exchangeSwapFeeRate",
  "tdsRate",
  "vdaTaxRate",
  "vdaCessRate",
  "inrWithdrawalFeeInr",
] as const satisfies readonly (keyof ModeledParams)[];

export interface ModelInputs {
  midRate: number;
  /** Quotes from Wise's public comparison feed, keyed by send amount in USD. */
  providerQuotes: Record<string, ProviderQuote[]>;
  books: {
    usdcInr: OrderBookInput | null;
    usdtInr: OrderBookInput | null;
    usdcUsdt: OrderBookInput | null;
  };
  chainFees: { base: ChainFeeInput | null; solana: ChainFeeInput | null };
  params: ModeledParams;
}

export interface ModelOptions {
  /** If true, the 1% TDS is assumed refunded or credited when the recipient files taxes. Default false (conservative). */
  tdsRefunded?: boolean;
  /** If true, reserve the VDA tax plus cess (30% + 4% of it by default) on any gain over a mid-market cost basis. Default true (conservative). */
  reserveVdaTax?: boolean;
}

export interface SourceEntry {
  id: string;
  label: string;
  status: DataStatus;
  url: string;
  publisher: string;
  /** Date the published figure was taken from the source (for modeled/statutory data). */
  asOf?: string;
  value?: number | string;
  unit?: string;
  note: string;
}

export interface Snapshot {
  schemaVersion: 1;
  /** When the live inputs were fetched. */
  generatedAt: string;
  /** Set by `npm run recompute` when results were rebuilt from stored live inputs with edited sources.yaml params. */
  recomputedAt: string | null;
  defaultAmountUsd: number;
  amountsUsd: number[];
  mid: { rate: number; method: string; sources: MidSource[] };
  inputs: ModelInputs;
  results: Record<string, RouteResult[]>;
  headline: Headline;
  sources: SourceEntry[];
  warnings: string[];
}

export interface Headline {
  amountUsd: number;
  swift: { routeId: string; name: string; lossInr: number };
  bestLicensed: { routeId: string; name: string; lossInr: number };
  stablecoin: { routeId: string; name: string; lossInr: number } | null;
  text: string;
}
