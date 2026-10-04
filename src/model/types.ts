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

/** [price, quantity] sorted best-first. */
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

/** Numeric parameters read from sources.yaml. Keys match source ids. */
export interface ModeledParams {
  chaseUsdWireFeeUsd: number;
  correspondentFeeUsd: number;
  gstRate: number;
  coinbaseAchDepositUsd: number;
  coinbaseUsdcConversionFeeRate: number;
  exchangeTakerFeeRate: number;
  exchangeSwapFeeRate: number;
  tdsRate: number;
  vdaTaxRate: number;
  vdaCessRate: number;
  inrWithdrawalFeeInr: number;
}

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
  /** If true, reserve 30% + cess VDA tax on any gain over mid-market cost basis. Default true (conservative). */
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
  generatedAt: string;
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
