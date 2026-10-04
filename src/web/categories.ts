import type { HopCategory, RouteFamily } from "../model";

// One accent (amber) for the FX spread, the cost people never see. Everything else is a neutral ramp,
// distinguishable by lightness alone. Gains are drawn hatched so they read without color.
export const CATEGORY: Record<HopCategory, { label: string; color: string; pattern?: string }> = {
  fx: { label: "FX spread", color: "var(--accent)" },
  fee: { label: "Fees", color: "var(--ink)" },
  network: { label: "Network", color: "#6f6c66" },
  tax: { label: "Tax", color: "#a8a49c" },
  premium: { label: "Exchange premium (gain)", color: "var(--accent)", pattern: "hatch-accent" },
  refund: { label: "TDS refund (gain)", color: "var(--ink)", pattern: "hatch-ink" },
};

export const COST_ORDER: HopCategory[] = ["fx", "fee", "network", "tax"];
export const GAIN_ORDER: HopCategory[] = ["premium", "refund"];

export const FAMILY_LABEL: Record<RouteFamily, string> = {
  bank: "Bank wire",
  provider: "Remittance",
  stablecoin: "Stablecoin",
};
