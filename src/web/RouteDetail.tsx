import type { RouteResult } from "../model";
import { CATEGORY } from "./categories";
import { bps, inr, inrSigned, rate, stamp } from "./format";

export function RouteDetail({ route }: { route: RouteResult }) {
  // Waterfall: cumulative cost after each hop, on one shared scale.
  let cum = 0;
  const steps = route.hops.map((h) => {
    const from = cum;
    cum += h.inr;
    return { h, from, to: cum };
  });
  const lo = Math.min(0, ...steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(1, ...steps.map((s) => Math.max(s.from, s.to)));
  const span = hi - lo;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <section className="detail" id="hops">
      <div className="detail-head">
        <div>
          <p className="kicker">Hop by hop</p>
          <h2>{route.name}</h2>
        </div>
        <dl className="detail-stats">
          <div>
            <dt>At mid-market</dt>
            <dd className="num">{inr(route.idealInr)}</dd>
          </div>
          <div>
            <dt>Lands in the bank</dt>
            <dd className="num">{inr(route.receivedInr)}</dd>
          </div>
          <div>
            <dt>{route.lossInr < 0 ? "Gain vs mid" : "Lost on the way"}</dt>
            <dd className={`num ${route.lossInr < 0 ? "gain" : "loss"}`}>
              {inrSigned(route.lossInr)} <small>{bps(route.lossBps)}</small>
            </dd>
          </div>
        </dl>
      </div>

      <div className="table-wrap">
        <table className="hops">
          <thead>
            <tr>
              <th>Hop</th>
              <th>Data</th>
              <th className="r">Cost</th>
              <th className="wf-col">Running cost</th>
              <th className="r">Balance at mid</th>
            </tr>
          </thead>
          <tbody>
            <tr className="start">
              <td>
                <strong>Start: ${route.amountUsd.toLocaleString("en-US")} in a US bank account</strong>
                <span className="detail-text">
                  Worth {inr(route.idealInr)} at mid-market {rate(route.midRate)}
                </span>
              </td>
              <td />
              <td />
              <td className="wf-col" />
              <td className="r num">{inr(route.idealInr)}</td>
            </tr>
            {steps.map(({ h, from, to }) => {
              const left = pos(Math.min(from, to));
              const width = Math.max(0.4, Math.abs(pos(to) - pos(from)));
              const gain = h.inr < 0;
              return (
                <tr key={h.id}>
                  <td>
                    <strong>{h.label}</strong>
                    <span className="detail-text">{h.detail}</span>
                  </td>
                  <td>
                    <span className={`badge ${h.status}`}>{h.status}</span>
                  </td>
                  <td className={`r num ${gain ? "gain" : ""}`}>{inrSigned(h.inr)}</td>
                  <td className="wf-col">
                    <span className="wf">
                      {lo < 0 && <span className="zero" style={{ left: `${pos(0)}%` }} />}
                      {Math.abs(h.inr) >= 0.005 && (
                        <span
                          className={`seg ${gain ? "hatched" : ""}`}
                          style={{ left: `${left}%`, width: `${width}%`, "--c": CATEGORY[h.category].color } as React.CSSProperties}
                        />
                      )}
                    </span>
                  </td>
                  <td className="r num">{inr(h.balanceInrAfter)}</td>
                </tr>
              );
            })}
            <tr className="end">
              <td>
                <strong>Lands in the Indian bank account</strong>
              </td>
              <td />
              <td className={`r num ${route.lossInr < 0 ? "gain" : ""}`}>{inrSigned(route.lossInr)}</td>
              <td className="wf-col" />
              <td className="r num strong">{inr(route.receivedInr)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="reconcile">
        Hop costs net to {inrSigned(route.lossInr)}, exactly the gap between mid-market and what lands.
        {route.quoteCollectedAt && <> Quote data collected {stamp(route.quoteCollectedAt)}.</>}
      </p>
      {route.caveats.length > 0 && (
        <div className="caveats">
          <h3>Read before you trust this number</h3>
          <ul>
            {route.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
