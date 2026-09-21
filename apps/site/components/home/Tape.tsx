/**
 * 654 recorded multiplier changes, one 8px cell each, grouped by the reason the issuer's multiplier
 * feed gave them. Counts are exact, from fixtures/xstocks/recorded-20260913/multiplier-history.json:
 *
 *   jq -r '[.bySymbol[][]] | group_by(.reason)
 *          | map({reason: .[0].reason, n: length}) | sort_by(-.n)[] | "\(.n)\t\(.reason)"'
 *   → 641 Dividend · 8 Split · 3 Administrative · 2 ReverseSplit   (sum 654)
 *
 * Grouped, not chronological, because the 98% has to be legible before a word is read.
 *
 * The cells are decorative: an 8px cell cannot be an accessible control (WCAG 2.5.8 wants 24px), and
 * a hover-only readout would strand touch and keyboard. Four cells are filled in the ink colour to
 * mark the exceptions, and those four are printed in full in the key table below, at every width.
 *
 * Only four cells are marked: the ones this page names elsewhere. The nine label/record
 * disagreements and the five unpublished changes are stated in copy and deliberately NOT encoded
 * here - identifying which cells they are needs the resolver's own matching logic, and a graphic
 * that disagreed with /v2/actions by two cells would be the worst possible bug for this product.
 */

const GROUPS: Array<{ key: string; legend: string; total: number; marked: number }> = [
  { key: 'dividend', legend: 'Dividend · 641', total: 641, marked: 2 },
  { key: 'split', legend: 'Split · 8', total: 8, marked: 0 },
  { key: 'administrative', legend: 'Administrative · 3', total: 3, marked: 2 },
  { key: 'reversesplit', legend: 'ReverseSplit · 2', total: 2, marked: 0 },
];

const KEYS: Array<{ symbol: string; date: string; change: string; feed: string; booked: string }> = [
  { symbol: 'HONx', date: '29 Jun 2026', change: '+95.11%', feed: 'Administrative', booked: 'Spin-off. Not income.' },
  { symbol: 'KRAQx', date: '26 Mar 2026', change: '+1.38%', feed: 'Administrative', booked: 'Rights distribution. Not income.' },
  { symbol: 'SCCOx', date: '12 Aug 2026', change: '+1.53%', feed: 'Dividend', booked: 'Stock dividend. Not income.' },
  { symbol: 'STRCx', date: '30 Nov 2025', change: '+0.00007%', feed: 'Dividend', booked: 'Cash dividend, usd null.' },
];

export function Tape() {
  return (
    <div className="tape-unit frame">
      <p className="frame-bar pix">
        <span className="frame-dots" aria-hidden="true" />
        ledger.labels · feed reason · n=654
      </p>

      <p className="tape-readout pix">654 changes · 24 Jun 2025 to 13 Sep 2026 · four cells are marked</p>

      <p className="sr-only">
        654 recorded multiplier changes, grouped by the reason the issuer’s feed gave them: 641 Dividend, 8 Split, 3
        Administrative, 2 ReverseSplit. The four marked cells are listed in the table that follows.
      </p>

      <div className="tape-groups" aria-hidden="true">
        {GROUPS.map((g) => (
          <div className="tape-group" key={g.key} data-g={g.key}>
            <p className="tape-legend pix">{g.legend}</p>
            <div className="tape">
              {Array.from({ length: g.marked }, (_, i) => (
                <span key={`m${i}`} data-marked="true" />
              ))}
              {Array.from({ length: g.total - g.marked }, (_, i) => (
                <span key={i} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <table className="tape-keys">
        <caption className="sr-only">The four marked changes, and what Corpact books for each.</caption>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Change</th>
            <th scope="col">Feed says</th>
            <th scope="col">Corpact books</th>
          </tr>
        </thead>
        <tbody>
          {KEYS.map((k) => (
            <tr key={k.symbol}>
              <th scope="row">
                {k.symbol}
                <span>{k.date}</span>
              </th>
              <td className="num" data-label="Change">
                {k.change}
              </td>
              <td className="feed" data-label="Feed says">
                {k.feed}
              </td>
              <td className="booked" data-label="Corpact books">
                {k.booked}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
