import type { Snapshot } from "../model";
import { pct, stamp } from "./format";

const STATUS_TEXT = {
  live: "Fetched from a keyless public API on every snapshot.",
  modeled: "From a published fee schedule, or an explicit assumption where none is published. Dated.",
  statutory: "Set by Indian law.",
} as const;

function fmtValue(v: number | string | undefined, unit: string | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (unit === "fraction") return `${+(v * 100).toFixed(3)}%`;
  if (unit === "USD") return `$${v}`;
  if (unit === "INR") return `₹${v}`;
  return String(v);
}

export function Methodology({ snap }: { snap: Snapshot }) {
  const p = snap.inputs.params;
  return (
    <main className="method">
      <p className="kicker">Methodology</p>
      <h1>How Rail Watch measures a transfer</h1>
      <p className="lede">
        Every route starts with dollars in a US bank account and ends with rupees in an Indian bank account. We price each step, measure what it costs against
        one mid-market rate, and show the steps. Credibility is the whole point, so anything we could not fetch live is labeled{" "}
        <span className="badge modeled">modeled</span> and cited below with a date.
      </p>
      <p className="lede">
        <strong>Not financial, tax or legal advice.</strong> This is a cost comparison built from public data and stated assumptions. Your bank, provider, tax
        position and the law may differ. Check with a chartered accountant before acting on the stablecoin numbers.
      </p>

      <h2>The yardstick: one mid-market rate</h2>
      <p>
        The ideal outcome is the amount times the mid-market USD/INR rate, with no fees. Today that rate is{" "}
        <strong className="num">₹{snap.mid.rate.toFixed(4)}</strong>, the {snap.mid.method}:
      </p>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Source</th>
              <th className="r">USD/INR</th>
              <th>As of</th>
            </tr>
          </thead>
          <tbody>
            {snap.mid.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.label}</td>
                <td className="r num">{s.rate ? s.rate.toFixed(4) : `failed: ${s.error}`}</td>
                <td>{s.asOf ? stamp(s.asOf) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Wise runs the comparison feed and is also a route in it, so we do not use Wise's own markup figures. Every markup is recomputed against this median,
        which is why Wise can show a small spread here even though it advertises the mid-market rate.
      </p>

      <h2>How a hop is costed</h2>
      <p>
        A route is a chain of steps that transform a balance: dollars, then maybe USDC or USDT, then rupees. After each step we value the balance at mid-market
        (stablecoins at par with the dollar). A hop's cost is how much that value fell. Because each hop is a difference of consecutive balances, the hop costs
        always add up exactly to the gap between mid-market and what lands in the bank. That reconciliation is enforced by the test suite for every route at
        every amount in every snapshot.
      </p>
      <p>A hop can be negative. When an Indian exchange pays more than mid-market for USDC, that step shows up as a gain, drawn hatched.</p>

      <h2>The routes</h2>
      <h3>Bank wires and remittance providers</h3>
      <p>
        Quotes for Chase, Wells Fargo, Wise, Remitly, Western Union, WorldRemit, Instarem and OFX come from Wise's public comparison feed, fetched at 12 send
        amounts from $100 to $10,000. Each quote is split into an upfront fee and an exchange-rate markup. Each quote carries its own collection date, shown on
        the route. Bank quotes are for wires converted to rupees by the US bank; intermediary and receiving-bank charges are not in them.
      </p>
      <h3>SWIFT in USD, converted in India</h3>
      <p>
        The classic wire: a ${p.chaseUsdWireFeeUsd} USD wire fee (Chase's published schedule), a ${p.correspondentFeeUsd} correspondent deduction (an
        assumption, banks do not publish it), conversion at SBI's rate from the same comparison feed, and GST on the conversion under Rule 32(2)(b) of the CGST
        Rules. This is the most modeled route on the page.
      </p>
      <h3>The USDC rail</h3>
      <ol>
        <li>ACH the dollars to Coinbase and convert to USDC 1:1 (published: no fee for either).</li>
        <li>
          Send USDC to an Indian exchange on Base or Solana. Network fee is live: Base gas price plus the L1 data fee, or Solana's base fee plus recent priority
          fees, priced in dollars at Coinbase spot. We charge it even when Coinbase absorbs it.
        </li>
        <li>
          Sell on CoinDCX. We market-sell the full amount into the live bid book, level by level, both directly on USDC/INR and via a USDC to USDT swap then
          USDT/INR, and keep whichever lands more. The swap path pays TDS twice.
        </li>
        <li>
          Pay the exchange fee ({pct(p.exchangeTakerFeeRate)} assumed) plus {pct(p.gstOnFeesRate)} GST on it, have {pct(p.tdsRate)} TDS withheld under Section
          194S on the proceeds net of fee and GST (CBDT Circular 13/2022), and withdraw rupees (₹{p.inrWithdrawalFeeInr} assumed).
        </li>
        <li>
          Reserve the {pct(p.vdaTaxRate)} VDA tax plus {pct(p.vdaCessRate)} cess ({pct(p.vdaTaxRate * (1 + p.vdaCessRate))} in all) on any gain over a
          mid-market cost basis. Under Section 115BBH only the cost of acquisition is deductible, so fees do not reduce the gain.
        </li>
      </ol>

      <h2>Being honest about the stablecoin route</h2>
      <ul className="plain">
        <li>
          <strong>The premium is not a fee advantage.</strong> Indian exchanges have priced USDT and USDC a few percent above the mid-market rate for years. It
          reflects tax friction, scarce on and off ramps, and demand for dollars. It is the main reason the route can beat mid-market, and it can shrink or
          vanish.
        </li>
        <li>
          <strong>TDS is real cash until you file.</strong> By default we count the {pct(p.tdsRate)} TDS as lost. Toggle it on the main page to see the number
          if it is fully credited at filing, which can be many months later.
        </li>
        <li>
          <strong>Tax depends on why you hold the USDC.</strong> Our {pct(p.vdaTaxRate)} reserve assumes you are moving your own money or a gift from a
          relative, with a mid-market cost basis. If the USDC is payment for services, it is income on receipt, taxed at your slab rate, and the later gain is
          close to zero. Talk to a CA.
        </li>
        <li>
          <strong>No proof of inward remittance.</strong> No FIRC or FIRA is issued. Exporters of services need that document to treat the receipt as an export
          for GST, so this route does not replace a bank rail for invoiced exports.
        </li>
        <li>
          <strong>KYC and banking risk.</strong> Indian exchanges must register with FIU-IND and can ask for the source of external deposits. Some banks have
          frozen accounts that receive exchange withdrawals. None of that is priced here.
        </li>
      </ul>

      <h2>What is not counted</h2>
      <ul className="plain">
        <li>Time to arrive. Bank wires can take days, the stablecoin leg minutes, the off-ramp anywhere from minutes to a day.</li>
        <li>Receiving-bank inward remittance fees, which some Indian banks charge.</li>
        <li>Card or debit funding, which most providers price higher than bank funding.</li>
        <li>Rate movement while money is in flight.</li>
        <li>Income tax surcharge at high incomes.</li>
        <li>The annual threshold below which no TDS is due (₹10,000, or ₹50,000 for some individuals). We always withhold.</li>
      </ul>

      <h2>Every source</h2>
      <p className="muted">
        {Object.entries(STATUS_TEXT).map(([k, v]) => (
          <span key={k} className="status-key">
            <span className={`badge ${k}`}>{k}</span> {v}{" "}
          </span>
        ))}
      </p>
      <div className="sources">
        {snap.sources.map((s) => (
          <article key={s.id} className="source">
            <header>
              <span className={`badge ${s.status}`}>{s.status}</span>
              <h4>{s.label}</h4>
              {s.value !== undefined && <span className="num value">{fmtValue(s.value, s.unit)}</span>}
            </header>
            <p>{s.note}</p>
            <p className="muted small">
              {s.publisher}
              {s.asOf && <> · as of {s.asOf}</>} ·{" "}
              <a href={s.url} rel="noreferrer">
                {s.url.replace(/^https?:\/\//, "").slice(0, 70)}
              </a>
            </p>
          </article>
        ))}
      </div>

      {snap.warnings.length > 0 && (
        <>
          <h2>Warnings from this snapshot</h2>
          <ul className="plain">
            {snap.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}

      <h2>Data</h2>
      <p>
        The full snapshot, inputs and computed routes included, is at <a href="./data/latest.json">data/latest.json</a>. Snapshots are committed daily to the
        repository under <code>data/history/</code>. Generated {stamp(snap.generatedAt)}.
      </p>
    </main>
  );
}
