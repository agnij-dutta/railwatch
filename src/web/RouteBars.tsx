import type { HopCategory, RouteResult } from "../model";
import { CATEGORY, COST_ORDER, FAMILY_LABEL, GAIN_ORDER } from "./categories";
import { bps, inr, inrSigned } from "./format";

interface Segment {
  cat: HopCategory;
  value: number; // INR, positive = cost, negative = gain
}

function segmentsOf(r: RouteResult): { costs: Segment[]; gains: Segment[] } {
  const by = new Map<HopCategory, number>();
  for (const h of r.hops) by.set(h.category, (by.get(h.category) ?? 0) + h.inr);
  const order = [...COST_ORDER, ...GAIN_ORDER];
  const all = order.map((cat) => ({ cat, value: by.get(cat) ?? 0 }));
  return {
    costs: all.filter((s) => s.value > 0.5),
    gains: all.filter((s) => s.value < -0.5),
  };
}

export function RouteBars({ routes, selectedId, onSelect }: { routes: RouteResult[]; selectedId: string; onSelect: (id: string) => void }) {
  const segs = routes.map((r) => ({ r, ...segmentsOf(r) }));
  const maxCost = Math.max(1, ...segs.map((s) => s.costs.reduce((a, c) => a + c.value, 0)));
  const maxGain = Math.max(0, ...segs.map((s) => -s.gains.reduce((a, c) => a + c.value, 0)));
  const domain = maxCost + maxGain;
  const zero = (maxGain / domain) * 100;
  const pctOf = (v: number) => (Math.abs(v) / domain) * 100;
  const usedCats = new Set(segs.flatMap((s) => [...s.costs, ...s.gains].map((x) => x.cat)));

  return (
    <div className="bars">
      <div className="bars-head">
        <h2>Where each rupee goes</h2>
        <ul className="legend">
          {[...COST_ORDER, ...GAIN_ORDER]
            .filter((c) => usedCats.has(c))
            .map((c) => (
              <li key={c}>
                <span className={`swatch ${CATEGORY[c].pattern ? "hatched" : ""}`} style={{ "--c": CATEGORY[c].color } as React.CSSProperties} />
                {CATEGORY[c].label}
              </li>
            ))}
        </ul>
      </div>
      <p className="bars-sub">
        Loss versus mid-market, per route. Bars to the right are money lost on the way. Hatched bars to the left are money gained. Click a route for every hop.
      </p>
      <ol className="bar-rows">
        {segs.map(({ r, costs, gains }) => {
          let x = zero;
          let gx = zero;
          return (
            <li key={r.id}>
              <button type="button" className={`bar-row ${r.id === selectedId ? "selected" : ""} fam-${r.family}`} onClick={() => onSelect(r.id)}>
                <span className="bar-name">
                  <span className="fam">{FAMILY_LABEL[r.family]}</span>
                  {r.shortName}
                  {r.hasModeled && <span className="badge modeled">modeled</span>}
                </span>
                <span className="bar-track">
                  {maxGain > 0 && <span className="zero" style={{ left: `${zero}%` }} />}
                  {costs.map((s) => {
                    const w = pctOf(s.value);
                    const el = (
                      <span
                        key={s.cat}
                        className="seg"
                        title={`${CATEGORY[s.cat].label}: ${inr(s.value)}`}
                        style={{ left: `${x}%`, width: `${w}%`, "--c": CATEGORY[s.cat].color } as React.CSSProperties}
                      />
                    );
                    x += w;
                    return el;
                  })}
                  {gains.map((s) => {
                    const w = pctOf(s.value);
                    gx -= w;
                    return (
                      <span
                        key={s.cat}
                        className="seg hatched"
                        title={`${CATEGORY[s.cat].label}: +${inr(s.value)}`}
                        style={{ left: `${gx}%`, width: `${w}%`, "--c": CATEGORY[s.cat].color } as React.CSSProperties}
                      />
                    );
                  })}
                </span>
                <span className={`bar-val num ${r.lossInr < 0 ? "gain" : ""}`}>
                  {inrSigned(r.lossInr)}
                  <small>{bps(r.lossBps)}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
