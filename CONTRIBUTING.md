# Contributing to Rail Watch

Rail Watch is only as good as its numbers. The most valuable contribution is a correction with a source: a fee schedule, a statute, a circular, or a live quote that disagrees with ours. Open an issue with the link, or a pull request that updates `sources.yaml`.

## Setup

Node 22.12 or newer.

```sh
npm ci
npm run lint        # Biome lint + format check
npm run typecheck   # tsc, strict
npm test            # Vitest
npm run build       # static site in dist/
npm run dev         # local site with hot reload
```

`npm run format` applies Biome's formatting and safe fixes. CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build on every push and pull request. The CSS rule `noDescendingSpecificity` is off because the stylesheet relies on source order for state overrides.

## Layout

```
sources.yaml              every modeled and statutory number, cited and dated
scripts/sources.ts        loads and validates sources.yaml
scripts/fetch.ts          snapshot builder: live public APIs + sources.yaml -> data/
scripts/recompute.ts      offline: rerun the model on stored inputs after editing sources.yaml
src/model/types.ts        shared types, including ModeledParams
src/model/engine.ts       Flow (balance tracking), order-book walking, GST slabs
src/model/routes.ts       every route, as a sequence of hops
src/model/insights.ts     cross-amount winners for the site's table
src/model/model.test.ts   model tests and committed-snapshot reconciliation
src/web/                  React site (Vite); recomputes routes from data/latest.json
data/latest.json          latest snapshot; data/history/<date>.json one per day
.github/workflows/        ci.yml (checks) and snapshot.yml (daily fetch, off until the repo is public)
```

## The rules every change must keep

1. **Hops reconcile.** Build routes with `Flow` steps (`deduct`, `convert`, `credit`, `step`). Never compute a route total separately from its hops. The tests assert `sum(hop.inr) === idealInr - receivedInr` for every route.
2. **Every number is cited.** A hop's `sourceIds` must name entries in `sources.yaml`. A hop with `status: "modeled"` or `"statutory"` must cite at least one dated entry of that status. A test enforces this on the committed snapshot.
3. **No hard-coded rates.** Any fee or tax rate the model uses, including in labels and site copy, comes from `inputs.params`, which comes from `sources.yaml`.
4. **Failures are visible.** A missing input becomes a warning in the snapshot or a thrown error, never a zero.

## How to update a modeled fee

Say CoinDCX changes its INR taker fee to 0.4%.

1. Edit the entry in `sources.yaml`:
   ```yaml
   - id: coindcx-trading-fee
     ...
     param: exchangeTakerFeeRate
     value: 0.004
     as_of: "2026-11-01"        # the day you read it from the publisher
     url: https://coindcx.com/fees
     note: >-
       What the page said, and anything a reader should re-check.
   ```
   Change `status` from `modeled` only if the value is now fetched live, and say whether it is a published figure or an assumption in `publisher` and `note`.
2. Run `npm run recompute`. It reruns the model on the live inputs already stored in `data/latest.json`, so the diff shows only the effect of your change. Use `npm run fetch` instead if you also want fresh live data.
3. Run `npm test` and commit `sources.yaml` together with the updated `data/` files.

To add a new modeled number: add the field to `ModeledParams` and to `MODELED_PARAM_KEYS` in `src/model/types.ts`, add a `sources.yaml` entry with `param:` set to that field, use `p.<field>` in the route, and add it to the test fixture in `model.test.ts`. The loader will refuse to run until all three agree.

## How to add a provider from the Wise feed

The fetcher already stores every provider in the Wise comparison feed. Only the ones listed in `PROVIDERS` in `src/model/routes.ts` become routes.

1. Find the provider's `alias` in a snapshot: `node -e 'console.log(require("./data/latest.json").inputs.providerQuotes["1000"].map(q => q.alias))'`.
2. Add an entry to `PROVIDERS` with `name`, `shortName`, `family` (`"provider"` or `"bank"`) and any caveats a reader needs, such as promotional pricing.
3. Run `npm run recompute` and `npm test`.

## How to add a new route

1. Write a function in `src/model/routes.ts` that starts a `Flow` with `{ asset: "USD", qty: amountUsd }`, applies one step per real-world hop, and ends with `finalize(flow, {...})`. The balance must end in `INR`.
2. For each step, set `category` (`fee`, `fx`, `network`, `tax`, `premium`, `refund`), `status`, `sourceIds` and a `detail` string a reader can check. Read every rate from `inputs.params`.
3. If it needs live data, fetch it in `scripts/fetch.ts`, add it to `ModelInputs`, and add a `status: live` entry in `sources.yaml` describing the endpoint. On failure, push a warning and return `null`.
4. Call it from `computeRoutes`.
5. Add a test with a hand calculation in the comment, and call `expectReconciles` on the result.
6. Mention it in the README's methodology table, and in `src/web/Methodology.tsx`.

## Pull requests

Keep them focused. Say which numbers changed and why, and link the source. Plain commit messages, no AI attribution lines. By contributing you agree your work is released under the MIT License.
