'use client';

import { useState } from 'react';

/**
 * HONx's balance multiplier over the recording - what one share held actually became.
 *
 * Every row is verbatim from fixtures/xstocks/recorded-20260913/multiplier-history.json, and every
 * `actual` type is the issuer's own caType from corporate-actions-history.json for the same
 * activation second:
 *
 *   node -e "…multiplier-history.json… bySymbol.HONx sorted by activationDateTime"
 *   → 1 → 1.0016554 → 1.0126918 → 1.0166756 → 1.0201914 → 1.0240947 → 0.5120474 → 0.9990655 → 1.0011577
 *
 * This is recorded MAINNET chain history, not sample data. It is inlined rather than fetched
 * because no API route serves a multiplier series: /v2/actions carries an action's quantity and
 * factor, never the mint's multiplier timeline. Do not edit a number here without re-running that
 * query.
 *
 * Form is a STEP line, not a smooth one: a multiplier holds flat between activations and jumps at
 * one instant. Drawing it as a slope would claim the balance drifted, which never happens.
 */

interface Point {
  t: string;
  /** The multiplier after this activation. */
  m: number;
  /** The reason the multiplier feed gave. */
  feed: string;
  /** The issuer's own corporate-action type for the same second. */
  actual: string;
  /** Structural events get a heavier marker; routine dividends do not. */
  key?: boolean;
}

const START_M = 1;
const T0 = '2025-08-16T00:00:00.000Z';
const T1 = '2026-09-13T00:00:00.000Z';

const POINTS: Point[] = [
  { t: '2025-09-05T23:55:00.000Z', m: 1.0016554, feed: 'Dividend', actual: 'Cash dividend' },
  { t: '2025-10-30T23:55:00.000Z', m: 1.0126918, feed: 'Dividend', actual: 'Spin-off', key: true },
  { t: '2025-12-05T23:55:00.000Z', m: 1.0166756, feed: 'Dividend', actual: 'Cash dividend' },
  { t: '2026-02-27T01:30:00.000Z', m: 1.0201914, feed: 'Dividend', actual: 'Cash dividend' },
  { t: '2026-05-15T00:30:00.000Z', m: 1.0240947, feed: 'Dividend', actual: 'Cash dividend' },
  { t: '2026-06-29T15:30:00.000Z', m: 0.5120474, feed: 'ReverseSplit', actual: 'Reverse split', key: true },
  { t: '2026-06-29T23:55:00.000Z', m: 0.9990655, feed: 'Administrative', actual: 'Spin-off', key: true },
  { t: '2026-08-14T00:30:00.000Z', m: 1.0011577, feed: 'Dividend', actual: 'Cash dividend' },
];

const W = 760;
const H = 300;
const L = 46;
const R = 14;
const TOP = 18;
const BOT = 262;

const Y_MIN = 0.46;
const Y_MAX = 1.08;
const TICKS = [0.5, 0.75, 1.0];

const ms = (iso: string) => Date.parse(iso);
const x = (iso: string) => L + ((ms(iso) - ms(T0)) / (ms(T1) - ms(T0))) * (W - L - R);
const y = (m: number) => BOT - ((m - Y_MIN) / (Y_MAX - Y_MIN)) * (BOT - TOP);

function stepPath(): string {
  let d = `M ${x(T0).toFixed(1)} ${y(START_M).toFixed(1)}`;
  let prev = START_M;
  for (const p of POINTS) {
    d += ` L ${x(p.t).toFixed(1)} ${y(prev).toFixed(1)} L ${x(p.t).toFixed(1)} ${y(p.m).toFixed(1)}`;
    prev = p.m;
  }
  return `${d} L ${x(T1).toFixed(1)} ${y(prev).toFixed(1)}`;
}

const pct = (from: number, to: number) => `${to >= from ? '+' : '−'}${Math.abs((to / from - 1) * 100).toFixed(2)}%`;
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function MultiplierChart() {
  const [active, setActive] = useState<number | null>(null);
  const before = (i: number) => (i === 0 ? START_M : POINTS[i - 1]!.m);
  const p = active === null ? null : POINTS[active]!;

  /**
   * Nearest-point hover on the CONTAINER, not on per-mark SVG rects: the pointer only has to be
   * closest to a date, never on the 2px line. Handlers live on the HTML div because React does not
   * reliably hydrate event props onto SVG children here - the rects rendered but never got fibers.
   */
  const track = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const svgX = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let bestD = Infinity;
    POINTS.forEach((pt, i) => {
      const d = Math.abs(x(pt.t) - svgX);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  };

  return (
    <figure className="chart">
      <figcaption className="chart-cap pix">HONx · balance multiplier · 8 activations · mainnet</figcaption>

      <div className="chart-plot" onPointerMove={track} onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="HONx balance multiplier by activation" preserveAspectRatio="xMidYMid meet">
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="mc-grid" />
              <text x={L - 10} y={y(t) + 4} className="mc-tick" textAnchor="end">
                {t.toFixed(2)}
              </text>
            </g>
          ))}

          {/* The crosshair finds the X: readers aim at a date, never at a 2px line. */}
          {p && <line x1={x(p.t)} x2={x(p.t)} y1={TOP} y2={BOT} className="mc-cross" />}

          <path d={stepPath()} className="mc-line" fill="none" />

          {POINTS.map((pt, i) => (
            <circle
              key={pt.t}
              cx={x(pt.t)}
              cy={y(pt.m)}
              r={active === i ? 6.5 : pt.key ? 5 : 3.5}
              className={`mc-dot${pt.key ? ' key' : ''}${active === i ? ' on' : ''}`}
            />
          ))}

          <text x={x('2025-10-30T23:55:00.000Z') + 10} y={y(1.0126918) + 20} className="mc-note">
            30 Oct · spin-off
          </text>
          <text x={x('2025-10-30T23:55:00.000Z') + 10} y={y(1.0126918) + 34} className="mc-note dim">
            feed said &ldquo;Dividend&rdquo;
          </text>
          <text x={x('2026-06-29T15:30:00.000Z') - 14} y={y(0.88) - 6} className="mc-note" textAnchor="end">
            29 Jun · reverse split &minus;50%,
          </text>
          <text x={x('2026-06-29T15:30:00.000Z') - 14} y={y(0.88) + 8} className="mc-note" textAnchor="end">
            then spin-off +95.11%
          </text>
          <text x={x('2026-06-29T15:30:00.000Z') - 14} y={y(0.88) + 22} className="mc-note dim" textAnchor="end">
            eight hours apart
          </text>

          <line x1={L} x2={W - R} y1={BOT} y2={BOT} className="mc-axis" />
          <text x={L} y={BOT + 20} className="mc-tick">Sep 2025</text>
          <text x={W - R} y={BOT + 20} className="mc-tick" textAnchor="end">Sep 2026</text>

        </svg>

        {p && active !== null && (
          <div
            className="mc-tip"
            style={{ left: `${(x(p.t) / W) * 100}%` }}
            data-side={x(p.t) > W * 0.62 ? 'left' : 'right'}
            role="status"
          >
            {/* Values lead, labels follow: the reader already has the series and wants the number. */}
            <span className="mc-tip-v">{p.m.toFixed(7)}</span>
            <span className="mc-tip-d">{pct(before(active), p.m)}</span>
            <span className="mc-tip-l">{dayLabel(p.t)}</span>
            <span className="mc-tip-l">
              Issuer record: <strong>{p.actual}</strong>
            </span>
            <span className={`mc-tip-l${p.feed.toLowerCase() !== p.actual.toLowerCase().replace(/[^a-z]/g, '') ? ' flag' : ''}`}>
              Feed said: {p.feed}
            </span>
          </div>
        )}
      </div>

      {/* Keyboard parity: the same readout on focus, from real buttons rather than SVG nodes. */}
      <div className="mc-keys">
        {POINTS.map((pt, i) => (
          <button
            key={pt.t}
            type="button"
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            {dayLabel(pt.t)}: multiplier {pt.m.toFixed(7)}, {pct(before(i), pt.m)}, issuer record {pt.actual}
          </button>
        ))}
      </div>

      <table className="sr-only">
        <caption>HONx balance multiplier by activation</caption>
        <thead>
          <tr>
            <th scope="col">Activation</th>
            <th scope="col">Feed reason</th>
            <th scope="col">Issuer record</th>
            <th scope="col">Change</th>
            <th scope="col">Multiplier</th>
          </tr>
        </thead>
        <tbody>
          {POINTS.map((pt, i) => (
            <tr key={pt.t}>
              <th scope="row">{pt.t}</th>
              <td>{pt.feed}</td>
              <td>{pt.actual}</td>
              <td>{pct(before(i), pt.m)}</td>
              <td>{pt.m.toFixed(7)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
