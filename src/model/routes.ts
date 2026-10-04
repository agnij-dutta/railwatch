// Route definitions. Every route starts with `amountUsd` dollars in a US bank account
// and ends with rupees in an Indian bank account.

import { Flow, gstOnConversion, sellIntoBids } from "./engine";
import type { Headline, ModeledParams, ModelInputs, ModelOptions, ProviderQuote, RouteFamily, RouteResult } from "./types";

const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtRate = (n: number) => `₹${n.toFixed(4)}`;
const pct = (n: number) => `${(n * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

interface ProviderMeta {
  name: string;
  shortName: string;
  family: RouteFamily;
  caveats: string[];
}

const BANK_CAVEATS = ["Intermediary (correspondent) banks and the receiving Indian bank can deduct further fees. Those are not included in this quote."];

/** Providers we show from Wise's comparison feed. SBI is excluded: its quote is the receiving-side rate used inside the SWIFT route. */
export const PROVIDERS: Record<string, ProviderMeta> = {
  wise: {
    name: "Wise",
    shortName: "Wise",
    family: "provider",
    caveats: ["Wise publishes the comparison feed this data comes from. Its own rate is the mid-market rate it uses; all fees are in the upfront fee."],
  },
  remitly: {
    name: "Remitly",
    shortName: "Remitly",
    family: "provider",
    caveats: ["Remitly rates in comparison feeds can reflect promotional first-transfer pricing. Repeat transfers may get a lower rate."],
  },
  "western-union": {
    name: "Western Union",
    shortName: "Western Union",
    family: "provider",
    caveats: ["Online bank-to-bank pricing. Cash pickup and card funding are priced differently."],
  },
  "world-remit": { name: "WorldRemit", shortName: "WorldRemit", family: "provider", caveats: [] },
  instarem: { name: "Instarem", shortName: "Instarem", family: "provider", caveats: [] },
  ofx: { name: "OFX", shortName: "OFX", family: "provider", caveats: ["OFX targets larger transfers and may have minimums."] },
  chase: { name: "SWIFT wire · Chase, converted to INR in the US", shortName: "Chase wire", family: "bank", caveats: BANK_CAVEATS },
  "wells-fargo": { name: "SWIFT wire · Wells Fargo, converted to INR in the US", shortName: "Wells Fargo wire", family: "bank", caveats: BANK_CAVEATS },
};

function finalize(flow: Flow, base: Omit<RouteResult, "midRate" | "idealInr" | "receivedInr" | "lossInr" | "lossBps" | "hops" | "hasModeled">): RouteResult {
  const bal = flow.balance;
  if (bal.asset !== "INR") throw new Error(`route ${base.id} did not end in INR`);
  const idealInr = base.amountUsd * flow.midRate;
  const receivedInr = bal.qty;
  const lossInr = idealInr - receivedInr;
  return {
    ...base,
    midRate: flow.midRate,
    idealInr,
    receivedInr,
    lossInr,
    lossBps: (lossInr / idealInr) * 10_000,
    hops: flow.hops,
    hasModeled: flow.hops.some((h) => h.status === "modeled"),
  };
}

/** A route priced entirely from a provider quote: upfront fee in USD, then conversion at the provider's rate. */
export function providerRoute(q: ProviderQuote, amountUsd: number, midRate: number): RouteResult | null {
  const meta = PROVIDERS[q.alias];
  if (!meta) return null;
  const collected = q.collectedAt.slice(0, 10);
  const flow = new Flow(midRate, { asset: "USD", qty: amountUsd });
  flow.deduct(
    {
      id: "upfront-fee",
      label: meta.family === "bank" ? "Outgoing wire fee" : "Upfront transfer fee",
      category: "fee",
      status: "live",
      sourceIds: ["wise-comparisons"],
      detail: `${fmtUsd(q.fee)} charged on send (quote collected ${collected})`,
    },
    q.fee,
  );
  flow.convert(
    {
      id: "fx-markup",
      label: "Exchange-rate markup vs mid-market",
      category: "fx",
      status: "live",
      sourceIds: ["wise-comparisons", "mid-market"],
      detail: `Rate ${fmtRate(q.rate)} vs mid ${fmtRate(midRate)} (${pct((midRate - q.rate) / midRate)} below mid)`,
    },
    "INR",
    q.rate,
  );
  return finalize(flow, {
    id: q.alias,
    name: meta.name,
    shortName: meta.shortName,
    family: meta.family,
    amountUsd,
    quoteCollectedAt: q.collectedAt,
    caveats: meta.caveats,
  });
}

/**
 * Classic SWIFT: USD wire from a US bank, intermediary deduction, converted to INR by the receiving Indian bank, GST on the conversion.
 * The receiving bank's rate is SBI's quote from the Wise feed (source country IN), used as a proxy for an Indian bank's
 * TT buying rate. SBI's own upfront fee in that quote is ignored because it applies to SBI as a sender, not a receiver.
 * GST under Rule 32(2)(b) applies because the conversion happens in India; provider routes pay out in INR and skip it.
 */
export function swiftUsdRoute(inputs: ModelInputs, amountUsd: number): RouteResult | null {
  const { params: p, midRate } = inputs;
  const sbi = findQuote(inputs, amountUsd, "state-bank-of-india");
  if (!sbi) return null;
  const flow = new Flow(midRate, { asset: "USD", qty: amountUsd });
  flow
    .deduct(
      {
        id: "wire-fee",
        label: "Outgoing international wire fee (US bank)",
        category: "fee",
        status: "modeled",
        sourceIds: ["chase-usd-wire-fee"],
        detail: `${fmtUsd(p.chaseUsdWireFeeUsd)} for a USD-denominated wire sent online (Chase published schedule)`,
      },
      p.chaseUsdWireFeeUsd,
    )
    .deduct(
      {
        id: "correspondent",
        label: "Correspondent bank deduction",
        category: "fee",
        status: "modeled",
        sourceIds: ["correspondent-fee"],
        detail: `${fmtUsd(p.correspondentFeeUsd)} assumed deduction by one intermediary bank`,
      },
      p.correspondentFeeUsd,
    );
  const usdArriving = flow.balance.qty;
  flow.convert(
    {
      id: "fx-markup",
      label: "Indian bank converts USD to INR",
      category: "fx",
      status: "live",
      sourceIds: ["wise-comparisons", "mid-market"],
      detail: `SBI rate ${fmtRate(sbi.rate)} vs mid ${fmtRate(midRate)} (quote collected ${sbi.collectedAt.slice(0, 10)})`,
    },
    "INR",
    sbi.rate,
  );
  const grossInr = usdArriving * sbi.rate;
  const gst = gstOnConversion(grossInr, p.gstRate);
  flow.deduct(
    {
      id: "gst-conversion",
      label: "GST on currency conversion",
      category: "tax",
      status: "statutory",
      sourceIds: ["gst-currency-conversion"],
      detail: `${pct(p.gstRate)} GST on the Rule 32(2)(b) value of a ${fmtInr(Math.round(grossInr))} conversion`,
    },
    gst,
  );
  return finalize(flow, {
    id: "swift-usd-sbi",
    name: "SWIFT wire in USD · converted by the Indian bank (SBI rate)",
    shortName: "SWIFT in USD",
    family: "bank",
    amountUsd,
    quoteCollectedAt: sbi.collectedAt,
    caveats: [
      "The wire fee and correspondent deduction are modeled from published schedules, not quoted live. Some wires see no intermediary deduction, some see two.",
      "Many Indian banks also charge an inward remittance handling fee. It is not included here.",
    ],
  });
}

type OfframpPath = "direct" | "via-usdt";

/**
 * Stablecoin rail: USD to USDC on Coinbase, send on-chain to an Indian exchange, sell for INR, withdraw.
 * Tries both the direct USDC/INR book and a USDC to USDT to INR path and keeps whichever lands more INR.
 */
export function stablecoinRoute(inputs: ModelInputs, amountUsd: number, network: "base" | "solana", opts: ModelOptions = {}): RouteResult | null {
  const candidates = (["direct", "via-usdt"] as OfframpPath[])
    .map((path) => stablecoinPath(inputs, amountUsd, network, path, opts))
    .filter((r): r is RouteResult => r !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.receivedInr > a.receivedInr ? b : a));
}

export function stablecoinPath(
  inputs: ModelInputs,
  amountUsd: number,
  network: "base" | "solana",
  path: OfframpPath,
  opts: ModelOptions = {},
): RouteResult | null {
  const { params: p, midRate } = inputs;
  const tdsRefunded = opts.tdsRefunded ?? false;
  const reserveVdaTax = opts.reserveVdaTax ?? true;
  const chain = inputs.chainFees[network];
  const usdcInr = inputs.books.usdcInr;
  const usdtInr = inputs.books.usdtInr;
  const usdcUsdt = inputs.books.usdcUsdt;
  // The book the final sale walks: USDC/INR directly, or USDT/INR after a USDC/USDT swap.
  const book = path === "direct" ? usdcInr : usdtInr;
  if (!chain || !book) return null;
  if (path === "via-usdt" && !usdcUsdt) return null;

  const netName = network === "base" ? "Base" : "Solana";
  const flow = new Flow(midRate, { asset: "USD", qty: amountUsd });

  flow.deduct(
    {
      id: "onramp-deposit",
      label: "ACH deposit to Coinbase",
      category: "fee",
      status: "modeled",
      sourceIds: ["coinbase-ach"],
      detail: `${fmtUsd(p.coinbaseAchDepositUsd)} for a standard ACH bank deposit`,
    },
    p.coinbaseAchDepositUsd,
  );
  flow.convert(
    {
      id: "usd-to-usdc",
      label: "Convert USD to USDC",
      category: "fee",
      status: "modeled",
      sourceIds: ["coinbase-usdc"],
      detail: `${pct(p.coinbaseUsdcConversionFeeRate)} fee, 1 USD = 1 USDC`,
    },
    "USDC",
    1 - p.coinbaseUsdcConversionFeeRate,
  );
  const usdcBought = flow.balance.qty;
  const costBasisInr = usdcBought * midRate;

  flow.deduct(
    {
      id: "network-fee",
      label: `Network fee on ${netName}`,
      category: "network",
      status: "live",
      sourceIds: [network === "base" ? "base-rpc" : "solana-rpc", "coinbase-spot"],
      detail: chain.detail,
    },
    chain.feeUsd,
  );
  flow.deduct(
    {
      id: "exchange-deposit",
      label: "Deposit to Indian exchange (CoinDCX)",
      category: "fee",
      status: "modeled",
      sourceIds: ["coindcx-deposit"],
      detail: `${fmtUsd(p.exchangeDepositFeeUsd)} to deposit USDC (published schedule)`,
    },
    p.exchangeDepositFeeUsd,
  );

  const tdsLegs: number[] = []; // INR value of each TDS deduction, for the refund lens

  if (path === "via-usdt" && usdcUsdt) {
    const fill = sellIntoBids(usdcUsdt.bids, flow.balance.qty);
    if (fill.insufficient) return null;
    flow.step(
      {
        id: "swap-usdc-usdt",
        label: "Swap USDC to USDT",
        category: "fx",
        status: "live",
        sourceIds: ["coindcx-orderbook"],
        detail: `USDC/USDT book, average ${fill.avgPrice.toFixed(5)} USDT per USDC`,
      },
      () => ({ asset: "USDT", qty: fill.proceeds }),
    );
    const swapFee = fill.proceeds * p.exchangeSwapFeeRate;
    flow.deduct(
      {
        id: "swap-fee",
        label: "Swap trading fee",
        category: "fee",
        status: "modeled",
        sourceIds: ["coindcx-swap-fee"],
        detail: `${pct(p.exchangeSwapFeeRate)} of the swap`,
      },
      swapFee,
    );
    const swapFeeGst = swapFee * p.gstOnFeesRate;
    flow.deduct(
      {
        id: "swap-fee-gst",
        label: "GST on swap fee",
        category: "tax",
        status: "statutory",
        sourceIds: ["gst-on-fees"],
        detail: `${pct(p.gstOnFeesRate)} of the swap fee`,
      },
      swapFeeGst,
    );
    // TDS base is the consideration net of the exchange's fee and the GST on it (CBDT Circular 13/2022).
    const swapTds = (fill.proceeds - swapFee - swapFeeGst) * p.tdsRate;
    tdsLegs.push(swapTds * midRate);
    flow.deduct(
      {
        id: "swap-tds",
        label: `${pct(p.tdsRate)} TDS on the swap (crypto to crypto)`,
        category: "tax",
        status: "statutory",
        sourceIds: ["tds-194s"],
        detail: `${pct(p.tdsRate)} of the swap proceeds net of fee and GST. TDS applies to every VDA transfer, including swaps`,
      },
      swapTds,
    );
  }

  const coin = path === "direct" ? "USDC" : "USDT";
  const fill = sellIntoBids(book.bids, flow.balance.qty);
  if (fill.insufficient) return null;
  const gross = fill.proceeds;
  const premiumStep = flow.balance.qty * midRate - gross < 0;
  flow.step(
    {
      id: "sell-for-inr",
      label: premiumStep ? `Sell ${coin} for INR: Indian exchange premium` : `Sell ${coin} for INR: below mid-market`,
      category: premiumStep ? "premium" : "fx",
      status: "live",
      sourceIds: ["coindcx-orderbook", "mid-market"],
      detail: `${coin}/INR book, average ${fmtRate(fill.avgPrice)} vs mid ${fmtRate(midRate)} across ${fill.levelsUsed} price level${fill.levelsUsed === 1 ? "" : "s"}`,
    },
    () => ({ asset: "INR", qty: gross }),
  );
  const fee = gross * p.exchangeTakerFeeRate;
  const feeGst = fee * p.gstOnFeesRate;
  flow
    .deduct(
      {
        id: "trade-fee",
        label: "Exchange trading fee",
        category: "fee",
        status: "modeled",
        sourceIds: ["coindcx-trading-fee"],
        detail: `${pct(p.exchangeTakerFeeRate)} taker fee on ${fmtInr(Math.round(gross))}`,
      },
      fee,
    )
    .deduct(
      {
        id: "trade-fee-gst",
        label: "GST on trading fee",
        category: "tax",
        status: "statutory",
        sourceIds: ["gst-on-fees"],
        detail: `${pct(p.gstOnFeesRate)} of the trading fee`,
      },
      feeGst,
    );
  // Section 194S TDS. Per CBDT Circular 13/2022 (22 June 2022), tax is withheld on the consideration
  // excluding GST and the exchange's own charges, so the base is gross proceeds minus fee minus GST on fee.
  // The model always withholds; below the annual threshold in 194S(1) (₹10,000, or ₹50,000 for a
  // "specified person") no TDS is due, which only matters at the smallest amounts.
  const tdsBase = gross - fee - feeGst;
  const tds = tdsBase * p.tdsRate;
  tdsLegs.push(tds);
  flow.deduct(
    {
      id: "tds",
      label: `${pct(p.tdsRate)} TDS on sale (Section 194S)`,
      category: "tax",
      status: "statutory",
      sourceIds: ["tds-194s"],
      detail: `${pct(p.tdsRate)} of ${fmtInr(Math.round(tdsBase))} (proceeds net of fee and GST), withheld by the exchange`,
    },
    tds,
  );
  flow.deduct(
    {
      id: "inr-withdrawal",
      label: "INR withdrawal to bank",
      category: "fee",
      status: "modeled",
      sourceIds: ["coindcx-inr-withdrawal"],
      detail: `${fmtInr(p.inrWithdrawalFeeInr)} per withdrawal (assumption)`,
    },
    p.inrWithdrawalFeeInr,
  );

  if (reserveVdaTax) {
    // Section 115BBH: income from transferring a VDA is taxed at a flat rate, computed as full sale
    // consideration minus cost of acquisition only. No deduction for trading fees, GST or network fees
    // (115BBH(2)(a)), and a loss cannot be set off against anything (115BBH(2)(b)), hence the floor at zero.
    // Cess is a percentage of the tax (Finance Act, 2018), so the effective rate is 30% x 1.04 = 31.2%.
    // Cost basis is the INR value of the USDC at mid-market on the day it was bought. Simplifications:
    //   - the USDC to USDT swap is itself a taxable transfer; its own gain or loss is tiny at a ~1.0001 book
    //     and is folded into the final sale here, which can understate tax by a few rupees;
    //   - income-tax surcharge at high incomes is ignored;
    //   - if the USDC is payment for services, it is slab-rate income on receipt instead (see caveats).
    const gain = Math.max(0, gross - costBasisInr);
    const rate = p.vdaTaxRate * (1 + p.vdaCessRate);
    flow.deduct(
      {
        id: "vda-tax",
        label: `${pct(p.vdaTaxRate)} VDA tax on the gain, plus ${pct(p.vdaCessRate)} cess (reserve)`,
        category: "tax",
        status: "statutory",
        sourceIds: ["vda-tax-115bbh"],
        detail:
          gain > 0
            ? `${pct(rate)} of ${fmtInr(Math.round(gain))} gain over a mid-market cost basis. Fees are not deductible.`
            : "No gain over mid-market cost basis, so no VDA tax",
      },
      gain * rate,
    );
  }

  if (tdsRefunded) {
    const refund = tdsLegs.reduce((a, b) => a + b, 0);
    flow.credit(
      {
        id: "tds-refund",
        label: "TDS credited back at tax filing",
        category: "refund",
        status: "statutory",
        sourceIds: ["tds-194s"],
        detail: `${fmtInr(Math.round(refund))} claimed against income tax or refunded, months later`,
      },
      refund,
    );
  }

  return finalize(flow, {
    id: `usdc-${network}`,
    name: `USDC rail · ${netName} · ${path === "direct" ? "sold on USDC/INR" : "swapped to USDT, sold on USDT/INR"}`,
    shortName: `USDC via ${netName}`,
    family: "stablecoin",
    amountUsd,
    quoteCollectedAt: book.fetchedAt,
    caveats: stablecoinCaveats(p),
  });
}

/** Caveats shown under every stablecoin route. Rates are read from params so they track sources.yaml. */
export function stablecoinCaveats(p: ModeledParams): string[] {
  return [
    "Indian exchanges price stablecoins above the mid-market rate. That premium is a market quirk driven by tax friction and limited ramps, not a fee advantage, and it can shrink or vanish.",
    `Profit on selling a virtual digital asset is taxed at a flat ${pct(p.vdaTaxRate)} plus ${pct(p.vdaCessRate)} cess, with no deduction for fees and no loss set-off. We reserve that tax on any gain over a mid-market cost basis. If the USDC is received as payment for services, the treatment differs: talk to a CA.`,
    `${pct(p.tdsRate)} TDS is withheld on every sale and swap. It is credited against your tax or refunded only when you file, so it is a real cash cost until then.`,
    "No FIRC or FIRA is issued. Exporters cannot use this route as proof of inward remittance for GST export of services, and it does not count as a foreign inward remittance under FEMA reporting.",
    "Both ends require full KYC. Indian exchanges must be registered with FIU-IND and may ask for the source of external deposits. Some Indian banks have frozen accounts receiving exchange withdrawals.",
    "Sending the wrong token or network to an exchange address is usually unrecoverable. Confirm the exchange supports deposits of that token on that network first.",
  ];
}

export function findQuote(inputs: ModelInputs, amountUsd: number, alias: string): ProviderQuote | null {
  const quotes = inputs.providerQuotes[String(amountUsd)];
  return quotes?.find((q) => q.alias === alias) ?? null;
}

/** All routes for one amount, best (most INR received) first. */
export function computeRoutes(inputs: ModelInputs, amountUsd: number, opts: ModelOptions = {}): RouteResult[] {
  const out: RouteResult[] = [];
  for (const q of inputs.providerQuotes[String(amountUsd)] ?? []) {
    const r = providerRoute(q, amountUsd, inputs.midRate);
    if (r) out.push(r);
  }
  const swift = swiftUsdRoute(inputs, amountUsd);
  if (swift) out.push(swift);
  for (const net of ["base", "solana"] as const) {
    const r = stablecoinRoute(inputs, amountUsd, net, opts);
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.receivedInr - a.receivedInr);
}

export const HEADLINE_SWIFT_ROUTE = "chase";

export function buildHeadline(routes: RouteResult[], amountUsd: number): Headline {
  const swift = routes.find((r) => r.id === HEADLINE_SWIFT_ROUTE) ?? routes.filter((r) => r.family === "bank")[0];
  const licensed = routes.filter((r) => r.family !== "stablecoin");
  if (!swift || licensed.length === 0) throw new Error("buildHeadline: need at least one bank or provider route");
  const best = licensed.reduce((a, b) => (b.receivedInr > a.receivedInr ? b : a));
  const stable = routes.filter((r) => r.family === "stablecoin").sort((a, b) => b.receivedInr - a.receivedInr)[0] ?? null;
  const r = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const usd = `$${amountUsd.toLocaleString("en-US")}`;
  const parts = [`Sending ${usd} to India today: a ${swift.shortName} loses ${r(swift.lossInr)}, ${best.shortName} loses ${r(best.lossInr)}`];
  if (stable) {
    parts.push(
      stable.lossInr >= 0
        ? `, the ${stable.shortName} route loses ${r(stable.lossInr)} after tax`
        : `, the ${stable.shortName} route lands ${r(-stable.lossInr)} above mid-market even after tax`,
    );
  }
  return {
    amountUsd,
    swift: { routeId: swift.id, name: swift.shortName, lossInr: swift.lossInr },
    bestLicensed: { routeId: best.id, name: best.shortName, lossInr: best.lossInr },
    stablecoin: stable ? { routeId: stable.id, name: stable.shortName, lossInr: stable.lossInr } : null,
    text: `${parts.join("")}. Here's every hop.`,
  };
}
