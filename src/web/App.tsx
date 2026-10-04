import { useEffect, useMemo, useState } from "react";
// Named imports let Vite tree-shake the precomputed `results` out of the bundle; the page recomputes from `inputs`.
import { amountsUsd, defaultAmountUsd, generatedAt, headline, inputs, mid, sources, warnings } from "../../data/latest.json";
import { computeRoutes, HEADLINE_SWIFT_ROUTE, type RouteResult, type Snapshot } from "../model";
import { inr, pct, stamp, usd } from "./format";
import { Methodology } from "./Methodology";
import { RouteBars } from "./RouteBars";
import { RouteDetail } from "./RouteDetail";
import { WinnerTable } from "./WinnerTable";

const snap = {
  schemaVersion: 1,
  generatedAt,
  defaultAmountUsd,
  amountsUsd,
  mid,
  inputs,
  sources,
  warnings,
  headline,
  results: {},
} as unknown as Snapshot;

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  const page = hash.startsWith("#/methodology") ? "methodology" : "home";
  return (
    <div className="page">
      <Masthead />
      {page === "methodology" ? <Methodology snap={snap} /> : <Home />}
      <Footer />
    </div>
  );
}

function Masthead() {
  return (
    <header className="masthead">
      <a href="#/" className="wordmark">
        <span className="wordmark-rail" aria-hidden />
        Rail Watch
      </a>
      <nav>
        <a href="#/">Routes</a>
        <a href="#/methodology">Methodology</a>
        <a href="./data/latest.json">Data</a>
      </nav>
      <div className="updated">
        <span className="dot" aria-hidden /> Updated {stamp(snap.generatedAt)}
      </div>
    </header>
  );
}

function Home() {
  const [amount, setAmount] = useState(snap.defaultAmountUsd);
  const [tdsRefunded, setTdsRefunded] = useState(false);
  const routes = useMemo(() => computeRoutes(snap.inputs, amount, { tdsRefunded }), [amount, tdsRefunded]);
  const [selectedId, setSelectedId] = useState<string>("usdc-base");
  const selected = routes.find((r) => r.id === selectedId) ?? routes[0];

  return (
    <main>
      <section className="card" id="card">
        <Hero routes={routes} amount={amount} tdsRefunded={tdsRefunded} />
        <Controls amount={amount} setAmount={setAmount} tdsRefunded={tdsRefunded} setTdsRefunded={setTdsRefunded} />
        <RouteBars routes={routes} selectedId={selected.id} onSelect={setSelectedId} />
        <div className="card-foot">
          <span>Rail Watch · mid-market ₹{snap.mid.rate.toFixed(2)} · data {stamp(snap.generatedAt)}</span>
          <span>Open data, every hop cited</span>
        </div>
      </section>

      <RouteDetail route={selected} />

      <WinnerTable snap={snap} tdsRefunded={tdsRefunded} currentAmount={amount} onPick={setAmount} />
    </main>
  );
}

function Hero({ routes, amount, tdsRefunded }: { routes: RouteResult[]; amount: number; tdsRefunded: boolean }) {
  const swift = routes.find((r) => r.id === HEADLINE_SWIFT_ROUTE) ?? routes.find((r) => r.family === "bank")!;
  const licensed = routes.filter((r) => r.family !== "stablecoin");
  const best = licensed[0];
  const stable = routes.find((r) => r.family === "stablecoin");
  const premiumHop = stable?.hops.find((h) => h.category === "premium");
  const premiumPct = premiumHop && stable ? (-premiumHop.inr / stable.idealInr) * 100 : 0;
  const p = snap.inputs.params;
  const vdaEffective = p.vdaTaxRate * (1 + p.vdaCessRate);

  return (
    <div className="hero">
      <p className="kicker">
        Sending {usd(amount)} from a US bank account to an Indian one, today. Measured against mid-market ₹{snap.mid.rate.toFixed(2)}.
      </p>
      <h1>
        <span className="line">
          A {swift.shortName} loses <em className="num">{inr(swift.lossInr)}</em>.
        </span>
        <span className="line">
          The best licensed route, {best.shortName}, loses <em className="num">{inr(best.lossInr)}</em>.
        </span>
        {stable && (
          <span className="line accent">
            {stable.lossInr < 0 ? (
              <>
                A USDC rail lands <em className="num">{inr(stable.lossInr)}</em> above mid-market, after tax.
              </>
            ) : (
              <>
                A USDC rail loses <em className="num">{inr(stable.lossInr)}</em>, after tax.
              </>
            )}
          </span>
        )}
      </h1>
      {stable && (
        <p className="hero-note">
          {premiumHop
            ? `${stable.lossInr < 0 ? "That edge is" : "It starts from"} a ${premiumPct.toFixed(1)}% premium Indian exchanges pay for stablecoins, minus fees, ${pct(p.tdsRate)} TDS${tdsRefunded ? " (here assumed refunded)" : ""} and a ${pct(vdaEffective)} tax reserve on the gain. It is a market quirk, not a cheaper pipe, and it carries tax, KYC and bank-freeze risk.`
            : "No exchange premium at this amount: the stablecoin route is selling below mid-market."}{" "}
          <a href="#/methodology">How this is measured</a>
        </p>
      )}
    </div>
  );
}

function Controls(props: {
  amount: number;
  setAmount: (n: number) => void;
  tdsRefunded: boolean;
  setTdsRefunded: (b: boolean) => void;
}) {
  const amounts = snap.amountsUsd;
  const idx = Math.max(0, amounts.indexOf(props.amount));
  return (
    <div className="controls">
      <label className="slider">
        <span className="control-label">
          Amount <strong className="num">{usd(props.amount)}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={amounts.length - 1}
          step={1}
          value={idx}
          onChange={(e) => props.setAmount(amounts[Number(e.target.value)])}
          aria-valuetext={usd(props.amount)}
        />
        <span className="ticks" aria-hidden>
          {amounts.map((a) => (
            <span key={a} className={a === props.amount ? "on" : ""}>
              {a >= 1000 ? `${a / 1000}k` : a}
            </span>
          ))}
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={props.tdsRefunded} onChange={(e) => props.setTdsRefunded(e.target.checked)} />
        <span className="switch" aria-hidden />
        <span>
          Count the {pct(snap.inputs.params.tdsRate)} TDS as refunded at tax filing
          <small>
            Off = conservative: TDS treated as lost, {pct(snap.inputs.params.vdaTaxRate)} VDA tax plus {pct(snap.inputs.params.vdaCessRate)} cess reserved on any gain.
          </small>
        </span>
      </label>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <p>
        Rail Watch compares what actually lands in an Indian bank account, hop by hop. Live inputs come from keyless public APIs. Anything that is not
        live is labeled <span className="badge modeled">modeled</span> and cited with a date on the <a href="#/methodology">methodology</a> page.
      </p>
      <p className="muted">
        Not financial, tax or legal advice. Built by <a href="https://x.com/0xholmesdev">@0xholmesdev</a> · open source · snapshot {stamp(snap.generatedAt)} · {snap.mid.method}
      </p>
    </footer>
  );
}

