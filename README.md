# Rail Watch

What it really costs to send dollars from a US bank account to an Indian one, hop by hop.

Rail Watch compares bank SWIFT wires, remittance providers (Wise, Remitly, Western Union and others) and a stablecoin rail (USD to USDC on Coinbase, on-chain on Base or Solana, sold for INR on an Indian exchange). Every route is measured against one mid-market rate, and every hop's cost is broken out and cited.

The hop costs always reconcile: they add up exactly to the gap between mid-market and what lands in the bank. The test suite enforces that for every route at every amount in every committed snapshot.

## Run it

```sh
npm install
npm run fetch      # build a fresh snapshot from live public APIs -> data/latest.json, data/history/<date>.json
npm test           # cost-model math, tax slabs, order-book walking, reconciliation of the committed snapshot
npm run dev        # local site
npm run build      # static site in dist/ (also copies data/ to dist/data/ as a public JSON API)
```

`npm run fetch -- --dry` prints the numbers without writing files.

## Data: live vs modeled

| Input | Status | Source |
| --- | --- | --- |
| Mid-market USD/INR | live | median of Wise, Coinbase, open.er-api.com, Frankfurter (ECB) |
| Bank and provider quotes at 12 amounts | live | Wise public comparison feed (`api.wise.com/v4/comparisons`, keyless) |
| USDC/INR, USDT/INR, USDC/USDT order books | live | CoinDCX public order book API |
| Base gas and L1 data fee | live | `mainnet.base.org` RPC + GasPriceOracle predeploy |
| Solana base and priority fee | live | `api.mainnet-beta.solana.com` RPC |
| ETH and SOL spot | live | Coinbase public prices |
| USD wire fee, correspondent deduction | modeled | Chase fee schedule, assumption |
| Coinbase ACH and USDC conversion | modeled | Coinbase published fees |
| Exchange trading fee, INR withdrawal | modeled | assumption, conservative end of published ranges |
| GST on currency conversion and on fees, 1% TDS, 30% VDA tax plus cess | statutory | CGST Rule 32(2)(b), Income-tax Act |

All modeled and statutory values live in [`sources.yaml`](sources.yaml) with a publisher, URL, date and note. Change a value there and the next fetch uses it. The site labels every modeled hop.

## Being honest about the stablecoin route

Indian exchanges price stablecoins a few percent above mid-market. That premium is why the USDC route can land more than mid-market, and it is a market quirk, not a cheaper pipe. By default the model counts the 1% TDS as lost and reserves 30% VDA tax plus 4% cess on any gain over a mid-market cost basis. The site also lists the regulatory and KYC caveats: no FIRC/FIRA, FIU-IND registered exchanges, bank-freeze risk.

## Layout

```
sources.yaml              every modeled and statutory number, cited and dated
scripts/fetch.ts          snapshot builder (keyless public APIs only)
src/model/                pure cost model shared by fetcher, tests and site
src/web/                  static React site (Vite)
data/latest.json          latest snapshot (inputs + computed routes)
data/history/<date>.json  one snapshot per day
.github/workflows/        daily snapshot job (not enabled until pushed)
```

Not financial, tax or legal advice.
