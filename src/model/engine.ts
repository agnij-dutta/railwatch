// Core money-flow engine. A route is a sequence of steps that transform a balance.
// Each step's cost is measured as the drop in the balance's INR value at mid-market,
// so the hop costs telescope: sum(hops) === idealInr - receivedInr, always.

import type { Asset, BookLevel, DataStatus, Hop, HopCategory } from "./types";

export interface Balance {
  asset: Asset;
  qty: number;
}

/** INR value of a balance at mid-market. Stablecoins are valued at par with USD (1 USDC = 1 USDT = 1 USD). */
export function valueAtMid(b: Balance, midRate: number): number {
  return b.asset === "INR" ? b.qty : b.qty * midRate;
}

export interface StepMeta {
  id: string;
  label: string;
  category: HopCategory;
  status: DataStatus;
  sourceIds: string[];
  detail: string;
}

/**
 * A balance moving through a route. Each `step` records a Hop whose cost is the drop in the balance's
 * INR value at mid-market. Values are kept as unrounded floats end to end; rounding happens only for display,
 * so the telescoping identity sum(hop.inr) === idealInr - receivedInr holds to float precision.
 */
export class Flow {
  readonly hops: Hop[] = [];
  private bal: Balance;

  constructor(
    readonly midRate: number,
    start: Balance,
  ) {
    this.bal = { ...start };
  }

  get balance(): Balance {
    return { ...this.bal };
  }

  get valueInr(): number {
    return valueAtMid(this.bal, this.midRate);
  }

  /** Apply a step. `fn` returns the new balance. */
  step(meta: StepMeta, fn: (b: Balance) => Balance): this {
    const before = this.valueInr;
    const next = fn({ ...this.bal });
    if (!Number.isFinite(next.qty)) throw new Error(`step ${meta.id} produced non-finite qty`);
    this.bal = next;
    const after = this.valueInr;
    this.hops.push({
      ...meta,
      inr: before - after,
      balanceInrAfter: after,
      asset: next.asset,
      qtyAfter: next.qty,
    });
    return this;
  }

  /** Subtract a fixed amount in the balance's own asset. */
  deduct(meta: StepMeta, amount: number): this {
    return this.step(meta, (b) => ({ asset: b.asset, qty: b.qty - amount }));
  }

  /** Add back an amount in the balance's own asset (e.g. a refund). */
  credit(meta: StepMeta, amount: number): this {
    return this.step(meta, (b) => ({ asset: b.asset, qty: b.qty + amount }));
  }

  /** Convert the whole balance to another asset at a flat rate. */
  convert(meta: StepMeta, to: Asset, rate: number): this {
    return this.step(meta, (b) => ({ asset: to, qty: b.qty * rate }));
  }
}

export interface FillResult {
  filledQty: number;
  proceeds: number;
  avgPrice: number;
  /** True if the book did not have enough depth to fill the whole quantity. */
  insufficient: boolean;
  levelsUsed: number;
}

/**
 * Market-sell `qty` into a bid book, best price first, consuming each level fully before the next.
 * This is how a taker market order fills, so large transfers pay for thin books. It ignores the
 * exchange's minimum order size and tick rounding (both immaterial at these sizes) and assumes the book
 * does not move between the snapshot and the trade. If the stored levels cannot absorb `qty`,
 * `insufficient` is true and callers must not quote a price.
 */
export function sellIntoBids(bids: BookLevel[], qty: number): FillResult {
  let remaining = qty;
  let proceeds = 0;
  let levelsUsed = 0;
  const sorted = [...bids].sort((a, b) => b[0] - a[0]);
  for (const [price, size] of sorted) {
    if (remaining <= 1e-12) break;
    const take = Math.min(size, remaining);
    proceeds += take * price;
    remaining -= take;
    levelsUsed++;
  }
  const filledQty = qty - Math.max(remaining, 0);
  return {
    filledQty,
    proceeds,
    avgPrice: filledQty > 0 ? proceeds / filledQty : 0,
    insufficient: remaining > 1e-9,
    levelsUsed,
  };
}

/**
 * Taxable value of a currency-conversion service under Rule 32(2)(b) of the CGST Rules, 2017.
 * GST is then charged at the standard 18% on this value.
 *   up to ₹1,00,000:          1% of the gross amount, minimum ₹250
 *   ₹1,00,000 to ₹10,00,000:  ₹1,000 + 0.5% of the amount above ₹1,00,000
 *   above ₹10,00,000:         ₹5,500 + 0.1% of the amount above ₹10,00,000, value capped at ₹60,000
 *
 * Why (b) and not (a): Rule 32(2)(a) values the service as (bank rate minus RBI reference rate) times the
 * units converted, which needs the bank's own reference spread. Rule 32(2)(b) is the slab method a supplier may
 * opt into, and it is the method Indian banks commonly publish in their forex GST schedules. A bank using (a)
 * would charge a different (usually similar) amount.
 * The rule text says "0.5% of the gross amount"; banks apply the marginal reading used here, which is the only
 * reading that is continuous at ₹1 lakh and ₹10 lakh (the tests pin that).
 */
export function gstConversionTaxableValue(grossInr: number): number {
  if (grossInr <= 0) return 0;
  if (grossInr <= 100_000) return Math.max(0.01 * grossInr, 250);
  if (grossInr <= 1_000_000) return 1_000 + 0.005 * (grossInr - 100_000);
  return Math.min(5_500 + 0.001 * (grossInr - 1_000_000), 60_000);
}

/** GST payable on a conversion of `grossInr`: the Rule 32(2)(b) taxable value times `gstRate`. */
export function gstOnConversion(grossInr: number, gstRate: number): number {
  return gstConversionTaxableValue(grossInr) * gstRate;
}
