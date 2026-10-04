import { useMemo } from "react";
import { amountRows, HEADLINE_SWIFT_ROUTE, licensedWinnerRanges, type Snapshot, stablecoinWins } from "../model";
import { bps, inrSigned, usd } from "./format";

function rangeText(from: number, to: number, isLast: boolean, isFirst: boolean): string {
  if (from === to) return isLast ? `${usd(from)} and up` : isFirst ? `up to ${usd(from)}` : `at ${usd(from)}`;
  if (isFirst) return `up to ${usd(to)}`;
  if (isLast) return `${usd(from)} and up`;
  return `${usd(from)} to ${usd(to)}`;
}

export function WinnerTable({
  snap,
  tdsRefunded,
  currentAmount,
  onPick,
}: {
  snap: Snapshot;
  tdsRefunded: boolean;
  currentAmount: number;
  onPick: (n: number) => void;
}) {
  const rows = useMemo(() => amountRows(snap.inputs, snap.amountsUsd, { tdsRefunded }), [snap, tdsRefunded]);
  const ranges = licensedWinnerRanges(rows);
  const wins = stablecoinWins(rows);
  const losesAt = rows.filter((r) => !wins.includes(r.amountUsd)).map((r) => r.amountUsd);

  return (
    <section className="winners">
      <p className="kicker">The slider insight</p>
      <h2>The cheapest route changes with the amount</h2>
      <p className="lede">
        Fixed fees punish small transfers, percentage spreads punish large ones, and order books run out of depth. Among licensed routes the winner is{" "}
        {ranges.map((r, i) => (
          <span key={r.routeId + r.from}>
            <strong>{r.name}</strong> {rangeText(r.from, r.to, i === ranges.length - 1, i === 0)}
            {i < ranges.length - 2 ? ", " : i === ranges.length - 2 ? " and " : ". "}
          </span>
        ))}
        {wins.length === rows.length
          ? "The USDC rail beats all of them at every amount we test, on today's exchange premium."
          : wins.length === 0
            ? "The USDC rail does not beat the best licensed route at any amount we test today."
            : `The USDC rail beats them at ${wins.length} of ${rows.length} amounts, and loses at ${losesAt.map(usd).join(", ")}${
                Math.min(...losesAt) > Math.max(...wins) ? ", where selling into a thin USDC/INR book eats the premium" : ""
              }.`}
      </p>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>Send</th>
              <th>Best licensed route</th>
              <th className="r">Its cost</th>
              <th className="r">Chase wire</th>
              <th className="r">SWIFT in USD</th>
              <th className="r">USDC rail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const chase = row.routes.find((r) => r.id === HEADLINE_SWIFT_ROUTE);
              const swift = row.routes.find((r) => r.id === "swift-usd-sbi");
              const st = row.bestStablecoin;
              const stWins = st && st.receivedInr > row.bestLicensed.receivedInr;
              return (
                <tr key={row.amountUsd} className={row.amountUsd === currentAmount ? "current" : ""} onClick={() => onPick(row.amountUsd)}>
                  <td className="num">{usd(row.amountUsd)}</td>
                  <td>{row.bestLicensed.shortName}</td>
                  <td className="r num">
                    {inrSigned(row.bestLicensed.lossInr)} <small>{bps(row.bestLicensed.lossBps)}</small>
                  </td>
                  <td className="r num">{chase ? inrSigned(chase.lossInr) : "n/a"}</td>
                  <td className="r num">{swift ? inrSigned(swift.lossInr) : "n/a"}</td>
                  <td className={`r num ${stWins ? "gain" : ""}`}>
                    {st ? (
                      <>
                        {inrSigned(st.lossInr)} <small>{bps(st.lossBps)}</small>
                      </>
                    ) : (
                      "book too thin"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Negative numbers are money lost versus mid-market, positive numbers are money gained. Click a row to load that amount above.
      </p>
    </section>
  );
}
