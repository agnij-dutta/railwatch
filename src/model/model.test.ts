import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHeadline,
  computeRoutes,
  Flow,
  gstConversionTaxableValue,
  gstOnConversion,
  providerRoute,
  sellIntoBids,
  stablecoinPath,
  stablecoinRoute,
  swiftUsdRoute,
  type ModelInputs,
  type ProviderQuote,
  type RouteResult,
  type Snapshot,
} from "./index";

const MID = 95;

function quote(alias: string, fee: number, rate: number, amount: number, type: ProviderQuote["type"] = "moneyTransferProvider"): ProviderQuote {
  return {
    alias,
    name: alias,
    type,
    fee,
    rate,
    receivedAmount: (amount - fee) * rate,
    collectedAt: "2026-10-04T00:00:00Z",
    sourceCountry: "US",
  };
}

function fixture(overrides: Partial<ModelInputs> = {}): ModelInputs {
  const amounts = [100, 1000, 10000];
  const providerQuotes: ModelInputs["providerQuotes"] = {};
  for (const a of amounts) {
    providerQuotes[String(a)] = [
      quote("wise", 2 + a * 0.005, MID, a),
      quote("remitly", a < 1000 ? 3.99 : 0, 94.8, a),
      quote("chase", a < 5000 ? 5 : 0, 92, a, "bank"),
      quote("state-bank-of-india", 0, 94, a, "bank"),
    ];
  }
  return {
    midRate: MID,
    providerQuotes,
    books: {
      usdcInr: { pair: "I-USDC_INR", fetchedAt: "2026-10-04T00:00:00Z", bids: [[100, 10_000]] },
      usdtInr: { pair: "I-USDT_INR", fetchedAt: "2026-10-04T00:00:00Z", bids: [[101, 50_000]] },
      usdcUsdt: { pair: "B-USDC_USDT", fetchedAt: "2026-10-04T00:00:00Z", bids: [[1, 1_000_000]] },
    },
    chainFees: {
      base: { network: "base", feeUsd: 0, detail: "test", fetchedAt: "2026-10-04T00:00:00Z" },
      solana: { network: "solana", feeUsd: 0.002, detail: "test", fetchedAt: "2026-10-04T00:00:00Z" },
    },
    params: {
      chaseUsdWireFeeUsd: 40,
      correspondentFeeUsd: 20,
      gstRate: 0.18,
      gstOnFeesRate: 0.18,
      coinbaseAchDepositUsd: 0,
      coinbaseUsdcConversionFeeRate: 0,
      exchangeDepositFeeUsd: 0,
      exchangeTakerFeeRate: 0.005,
      exchangeSwapFeeRate: 0.001,
      tdsRate: 0.01,
      vdaTaxRate: 0.3,
      vdaCessRate: 0.04,
      inrWithdrawalFeeInr: 10,
    },
    ...overrides,
  };
}

/** Core invariant: the hop costs add up exactly to the gap between mid-market and what lands. */
function expectReconciles(r: RouteResult) {
  const hopSum = r.hops.reduce((s, h) => s + h.inr, 0);
  expect(hopSum).toBeCloseTo(r.idealInr - r.receivedInr, 6);
  expect(r.lossInr).toBeCloseTo(hopSum, 6);
  expect(r.idealInr).toBeCloseTo(r.amountUsd * r.midRate, 6);
  // Running balance after the last hop is exactly what lands in the bank.
  const last = r.hops[r.hops.length - 1];
  expect(last.asset).toBe("INR");
  expect(last.balanceInrAfter).toBeCloseTo(r.receivedInr, 6);
  // And each hop's cost equals the drop in running balance.
  let prev = r.idealInr;
  for (const h of r.hops) {
    expect(h.inr).toBeCloseTo(prev - h.balanceInrAfter, 6);
    prev = h.balanceInrAfter;
  }
  expect(r.lossBps).toBeCloseTo((r.lossInr / r.idealInr) * 10_000, 6);
}

describe("Flow", () => {
  it("values stablecoins at par and records the drop per step", () => {
    const f = new Flow(MID, { asset: "USD", qty: 100 });
    const meta = { id: "x", label: "x", category: "fee" as const, status: "modeled" as const, sourceIds: [], detail: "" };
    f.deduct(meta, 1).convert({ ...meta, id: "y" }, "USDC", 1).convert({ ...meta, id: "z" }, "INR", 96);
    expect(f.hops.map((h) => h.inr)).toEqual([95, 0, -99]);
    expect(f.balance).toEqual({ asset: "INR", qty: 99 * 96 });
  });
});

describe("GST on currency conversion (Rule 32(2)(b))", () => {
  it("applies the ₹250 minimum below ₹25,000", () => {
    expect(gstConversionTaxableValue(10_000)).toBe(250);
    expect(gstOnConversion(10_000, 0.18)).toBeCloseTo(45, 9);
  });
  it("is 1% up to ₹1 lakh", () => {
    expect(gstConversionTaxableValue(50_000)).toBe(500);
    expect(gstConversionTaxableValue(100_000)).toBe(1_000);
  });
  it("is ₹1,000 + 0.5% between ₹1 lakh and ₹10 lakh", () => {
    expect(gstConversionTaxableValue(500_000)).toBe(3_000);
    expect(gstConversionTaxableValue(1_000_000)).toBe(5_500);
  });
  it("is ₹5,500 + 0.1% above ₹10 lakh, capped at ₹60,000", () => {
    expect(gstConversionTaxableValue(2_000_000)).toBe(6_500);
    expect(gstConversionTaxableValue(1_000_000_000)).toBe(60_000);
  });
  it("is continuous at the slab boundaries", () => {
    expect(gstConversionTaxableValue(100_000.01)).toBeCloseTo(1_000, 2);
    expect(gstConversionTaxableValue(1_000_000.01)).toBeCloseTo(5_500, 2);
  });
});

describe("sellIntoBids", () => {
  const bids: [number, number][] = [
    [99, 100],
    [100, 50],
    [98, 1000],
  ];
  it("walks the book best price first", () => {
    const f = sellIntoBids(bids, 200);
    expect(f.proceeds).toBeCloseTo(50 * 100 + 100 * 99 + 50 * 98, 9);
    expect(f.levelsUsed).toBe(3);
    expect(f.insufficient).toBe(false);
    expect(f.avgPrice).toBeCloseTo(f.proceeds / 200, 9);
  });
  it("flags insufficient depth", () => {
    const f = sellIntoBids(bids, 5_000);
    expect(f.insufficient).toBe(true);
    expect(f.filledQty).toBe(1150);
  });
});

describe("provider routes", () => {
  it("reproduce the provider's own received amount", () => {
    const q = quote("wise", 11.26, 96.1503, 1000);
    const r = providerRoute(q, 1000, 96.2744)!;
    expect(r.receivedInr).toBeCloseTo(95_067.65, 1);
    expectReconciles(r);
  });
  it("split cost into upfront fee and FX markup", () => {
    const r = providerRoute(quote("chase", 5, 92, 1000, "bank"), 1000, MID)!;
    const [fee, fx] = r.hops;
    expect(fee.inr).toBeCloseTo(5 * MID, 9);
    expect(fx.inr).toBeCloseTo(995 * (MID - 92), 9);
    expect(r.family).toBe("bank");
  });
  it("ignore providers we do not list", () => {
    expect(providerRoute(quote("unknown", 0, 90, 1000), 1000, MID)).toBeNull();
  });
});

describe("SWIFT in USD route", () => {
  it("matches a hand calculation", () => {
    const r = swiftUsdRoute(fixture(), 1000)!;
    // $1,000 - $40 - $20 = $940 at ₹94 = ₹88,360. GST: 18% of 1% of ₹88,360.
    const gross = 940 * 94;
    expect(r.receivedInr).toBeCloseTo(gross - 0.18 * 0.01 * gross, 6);
    expect(r.hops.map((h) => h.id)).toEqual(["wire-fee", "correspondent", "fx-markup", "gst-conversion"]);
    expect(r.hasModeled).toBe(true);
    expectReconciles(r);
  });
});

describe("stablecoin route", () => {
  it("matches a hand calculation on the direct USDC/INR path", () => {
    const r = stablecoinPath(fixture(), 1000, "base", "direct")!;
    // gross ₹1,00,000. fee ₹500, GST ₹90, TDS 1% of (1,00,000 - 500 - 90) = ₹994.10 (Circular 13/2022),
    // withdrawal ₹10, VDA tax 31.2% of (1,00,000 - 95,000) = ₹1,560 (fees not deductible under 115BBH).
    const received = 100_000 - 500 - 90 - 994.1 - 10 - 1_560;
    expect(r.receivedInr).toBeCloseTo(received, 6);
    expect(r.lossInr).toBeCloseTo(95_000 - received, 6);
    expect(r.hops.find((h) => h.id === "tds")!.inr).toBeCloseTo(994.1, 6);
    const premium = r.hops.find((h) => h.id === "sell-for-inr")!;
    expect(premium.category).toBe("premium");
    expect(premium.inr).toBeCloseTo(-5_000, 6);
    expectReconciles(r);
  });

  it("adds TDS back only in the refund lens", () => {
    const base = stablecoinPath(fixture(), 1000, "base", "direct")!;
    const refunded = stablecoinPath(fixture(), 1000, "base", "direct", { tdsRefunded: true })!;
    expect(refunded.receivedInr - base.receivedInr).toBeCloseTo(994.1, 6);
    expect(refunded.hops.at(-1)!.category).toBe("refund");
    expectReconciles(refunded);
  });

  it("skips the VDA tax reserve when asked and when there is no gain", () => {
    const noReserve = stablecoinPath(fixture(), 1000, "base", "direct", { reserveVdaTax: false })!;
    expect(noReserve.hops.some((h) => h.id === "vda-tax")).toBe(false);
    const discount = fixture({
      books: { ...fixture().books, usdcInr: { pair: "I-USDC_INR", fetchedAt: "", bids: [[90, 10_000]] } },
    });
    const r = stablecoinPath(discount, 1000, "base", "direct")!;
    expect(r.hops.find((h) => h.id === "vda-tax")!.inr).toBe(0);
    expect(r.hops.find((h) => h.id === "sell-for-inr")!.category).toBe("fx");
  });

  it("charges TDS twice on the USDT path and picks the better path", () => {
    const via = stablecoinPath(fixture(), 1000, "base", "via-usdt")!;
    expect(via.hops.filter((h) => h.sourceIds.includes("tds-194s"))).toHaveLength(2);
    expectReconciles(via);
    const direct = stablecoinPath(fixture(), 1000, "base", "direct")!;
    const best = stablecoinRoute(fixture(), 1000, "base")!;
    expect(best.receivedInr).toBe(Math.max(via.receivedInr, direct.receivedInr));
  });

  it("returns null when the book cannot absorb the amount", () => {
    const thin = fixture({
      books: {
        usdcInr: { pair: "I-USDC_INR", fetchedAt: "", bids: [[100, 10]] },
        usdtInr: null,
        usdcUsdt: null,
      },
    });
    expect(stablecoinRoute(thin, 1000, "base")).toBeNull();
  });

  it("takes TDS on the swap net of the swap fee and its GST", () => {
    const via = stablecoinPath(fixture(), 1000, "base", "via-usdt")!;
    // 1,000 USDC at 1 USDT; fee 1 USDT; GST 0.18; TDS 1% of 998.82 USDT, valued at mid.
    expect(via.hops.find((h) => h.id === "swap-tds")!.inr).toBeCloseTo(9.9882 * MID, 6);
  });

  it("reads every rate in labels and caveats from params, so sources.yaml edits propagate", () => {
    const inputs = fixture();
    inputs.params = { ...inputs.params, tdsRate: 0.02, vdaTaxRate: 0.25, vdaCessRate: 0.05, exchangeDepositFeeUsd: 1, gstOnFeesRate: 0.1 };
    const r = stablecoinPath(inputs, 1000, "base", "direct")!;
    const text = JSON.stringify(r);
    expect(text).toContain("2% TDS on sale");
    expect(text).toContain("25% VDA tax on the gain, plus 5% cess");
    expect(text).not.toMatch(/\b1% TDS|30% VDA|4% cess/);
    expect(r.hops.find((h) => h.id === "exchange-deposit")!.inr).toBeCloseTo(MID, 9);
    // $1 deposit fee leaves 999 USDC: fee 0.5% of ₹99,900 = ₹499.50, GST at 10% = ₹49.95.
    expect(r.hops.find((h) => h.id === "trade-fee-gst")!.inr).toBeCloseTo(49.95, 6);
    expectReconciles(r);
  });

  it("deducts the live network fee", () => {
    const base = stablecoinPath(fixture(), 1000, "base", "direct")!;
    const sol = stablecoinPath(fixture(), 1000, "solana", "direct")!;
    expect(sol.hops.find((h) => h.id === "network-fee")!.inr).toBeCloseTo(0.002 * MID, 9);
    expect(base.receivedInr).toBeGreaterThan(sol.receivedInr);
  });
});

describe("computeRoutes", () => {
  it("returns every route sorted best first and every route reconciles", () => {
    for (const amount of [100, 1000, 10000]) {
      for (const tdsRefunded of [false, true]) {
        const routes = computeRoutes(fixture(), amount, { tdsRefunded });
        expect(routes.length).toBeGreaterThanOrEqual(5);
        for (let i = 1; i < routes.length; i++) expect(routes[i - 1].receivedInr).toBeGreaterThanOrEqual(routes[i].receivedInr);
        routes.forEach(expectReconciles);
        expect(routes.some((r) => r.id === "state-bank-of-india")).toBe(false);
      }
    }
  });

  it("lets fixed fees flip the winner as the amount changes", () => {
    const winner = (a: number) => computeRoutes(fixture(), a).filter((r) => r.family !== "stablecoin")[0].id;
    // Wise: fixed $2 + 0.5% at mid. Remitly: $3.99 under $1,000 then 0 fee with a 0.21% markup.
    expect(winner(100)).toBe("wise");
    expect(winner(1000)).toBe("remitly");
  });

  it("builds a headline from the computed routes", () => {
    const h = buildHeadline(computeRoutes(fixture(), 1000), 1000);
    expect(h.swift.routeId).toBe("chase");
    expect(h.bestLicensed.routeId).toBe("remitly");
    expect(h.stablecoin?.routeId).toMatch(/^usdc-/);
    expect(h.text).not.toMatch(/\u2014/);
  });
});

describe("committed snapshot", () => {
  const path = join(__dirname, "../../data/latest.json");
  it.skipIf(!existsSync(path))("reconciles every route at every amount and recomputes identically", () => {
    const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
    for (const amount of snap.amountsUsd) {
      const stored = snap.results[String(amount)];
      stored.forEach(expectReconciles);
      const recomputed = computeRoutes(snap.inputs, amount);
      expect(recomputed.map((r) => [r.id, r.receivedInr])).toEqual(stored.map((r) => [r.id, r.receivedInr]));
    }
    expect(JSON.stringify(snap)).not.toMatch(/\u2014/);
  });
});

describe("buildHeadline", () => {
  it("fails loudly instead of inventing a headline with no licensed route", () => {
    const stableOnly = computeRoutes(fixture(), 1000).filter((r) => r.family === "stablecoin");
    expect(() => buildHeadline(stableOnly, 1000)).toThrow(/at least one bank or provider route/);
  });
});

describe("insights", () => {
  it("groups consecutive winners into ranges", async () => {
    const { amountRows, licensedWinnerRanges, stablecoinWins } = await import("./insights");
    const rows = amountRows(fixture(), [100, 1000, 10000]);
    const ranges = licensedWinnerRanges(rows);
    expect(ranges[0]).toMatchObject({ routeId: "wise", from: 100, to: 100 });
    expect(ranges[1]).toMatchObject({ routeId: "remitly", from: 1000, to: 10000 });
    // Fixture USDC/INR book holds 10,000 USDC at ₹100, so every amount clears and beats mid.
    expect(stablecoinWins(rows)).toEqual([100, 1000, 10000]);
  });
});
