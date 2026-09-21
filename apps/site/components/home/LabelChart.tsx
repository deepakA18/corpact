/**
 * What the issuer's multiplier feed calls each of the 654 recorded changes.
 *
 * Counts are exact, from fixtures/xstocks/recorded-20260913/multiplier-history.json:
 *
 *   jq -r '[.bySymbol[][]] | group_by(.reason)
 *          | map({reason: .[0].reason, n: length}) | sort_by(-.n)[] | "\(.n)\t\(.reason)"'
 *   → 641 Dividend · 8 Split · 3 Administrative · 2 ReverseSplit   (sum 654)
 *
 * Form is EMPHASIS, not categorical: one series, the leading bar in full ink and the rest in the
 * recessive grey. The story is that a single label covers 98% of the data, and emphasis states it
 * without spending four colours on a page that has none.
 *
 * It is marked up as a real table. That is the accessible view and the chart at once - screen
 * readers and no-CSS get the numbers, everyone else gets the bars - so there is no separate
 * "table view" to keep in sync, and no hover-only data to strand touch and keyboard. Every value
 * is directly labelled, so a tooltip would restate what is already on screen.
 */

const TOTAL = 654;

const ROWS: Array<{ label: string; n: number; lead?: boolean }> = [
  { label: 'Dividend', n: 641, lead: true },
  { label: 'Split', n: 8 },
  { label: 'Administrative', n: 3 },
  { label: 'ReverseSplit', n: 2 },
];

const MAX = Math.max(...ROWS.map((r) => r.n));
const pct = (n: number) => ((n / TOTAL) * 100).toFixed(1);

export function LabelChart() {
  return (
    <figure className="chart">
      <figcaption className="chart-cap pix">feed reason · n=654</figcaption>
      <table className="chart-bars">
        <caption className="sr-only">
          The reason the multiplier feed gives for each of the 654 recorded changes, by count.
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Feed reason</th>
            <th scope="col">Changes</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label} className={r.lead ? 'lead' : undefined}>
              <th scope="row">{r.label}</th>
              <td className="chart-track">
                {/* The bar is presentation; the number beside it is the data. */}
                <span className="chart-bar" style={{ width: `${(r.n / MAX) * 100}%` }} aria-hidden="true" />
              </td>
              <td className="chart-val">
                {r.n}
                <span className="sr-only"> changes, {pct(r.n)} percent of 654</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
