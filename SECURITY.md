# Security

Rail Watch reads public, keyless APIs and publishes a static site. It holds no keys, no user data and no funds, and it never moves money. The attack surface is small, but reports are welcome.

## Reporting

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Please do not open a public issue for a security problem. Expect a reply within a week.

## In scope

- Anything that lets a third party change the numbers the site shows without a commit: for example, a crafted API response that the fetcher accepts and that produces a misleading snapshot without a warning.
- Script injection through snapshot content rendered by the site.
- Supply-chain issues in the build or the snapshot workflow (`.github/workflows/`).

## Out of scope, by design

- **Wrong or stale numbers.** Those are bugs, not vulnerabilities. Open a normal issue with a source.
- **Upstream data integrity.** Rail Watch trusts Wise, CoinDCX, Coinbase, the ECB feeds and public RPC endpoints to report honestly. It cross-checks the mid-market rate across four feeds and warns when they disagree by more than 1%, but it cannot detect a coordinated or single-source manipulation of provider quotes or order books.
- **Advice.** Rail Watch is not financial, tax or legal advice, and it does not assess the safety of any provider, exchange or route.
