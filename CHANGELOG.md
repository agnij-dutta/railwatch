# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-04

### Added

- Live comparison of sending USD from a US bank account to an Indian one across bank wires, remittance providers (from Wise's public comparison feed) and a USDC route on Base or Solana sold on CoinDCX.
- Hop-by-hop cost model in which hop costs always sum to the gap between mid-market and what lands, enforced by tests on every committed snapshot.
- Mid-market rate as the median of four keyless feeds.
- Order-book walking on CoinDCX USDC/INR, USDT/INR and USDC/USDT, keeping the better of the direct and via-USDT paths.
- Indian tax modeling: GST on currency conversion (CGST Rule 32(2)(b)), GST on exchange fees, 1% TDS (Section 194S, on consideration net of fees and GST per CBDT Circular 13/2022), and a 30% VDA tax plus 4% cess reserve on gains (Section 115BBH).
- `sources.yaml` as the single, validated home of every modeled and statutory number, each with a source and an `as_of` date.
- `npm run fetch` (with `--dry`) and `npm run recompute` for offline what-ifs on stored live inputs.
- Static Vite site with route bars, a per-route waterfall, a TDS refund toggle, a cross-amount winner table and a methodology page listing every source.
- CI workflow, Biome lint and format, issue and PR templates, and a daily snapshot workflow that is off until the repository is public.
