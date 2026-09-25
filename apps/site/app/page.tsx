import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { HeroPixels } from '@/components/home/HeroPixels';
import { MultiplierChart } from '@/components/home/MultiplierChart';
import { DEMO_API_KEY, DEMO_API_URL, DEMO_WALLET } from '@/lib/demo-api';

/**
 * Every figure on this page is checked against fixtures/xstocks/recorded-20260913.
 *   654 = jq '[.bySymbol[] | length] | add'            multiplier-history.json
 *   832 = jq '.nodes | length'                          assets.json
 *   348 = symbols with at least one recorded change     multiplier-history.json
 *   446 = elapsed days from 2025-06-24 to 2026-09-13 (inclusive of both endpoints it is 447)
 *
 * Section 01's two counts come from joining each multiplier row to the latest standing issuer
 * record on (symbol, effectiveTimeUtc) in corporate-actions-history.json:
 *   9 rows where the feed's `reason` disagrees with the issuer's own `caType`
 *     (4 of them spin-offs the feed called Dividend: GMEx, HONx 2025-10-30, DFDVx, OPENx)
 *   5 rows with no issuer record at all (STRCx x2, TQQQx, CMCSAx, JPMx)
 * The two sets are disjoint by construction: a row with no record cannot disagree with one.
 *
 * Do not edit a number here without re-running the query that produced it.
 */
const SPECS: Array<{ n: string; label: string }> = [
  { n: '654', label: 'Changes recorded' },
  { n: '832', label: 'Stocks tracked' },
  { n: '348', label: 'Stocks that moved' },
  { n: '446', label: 'Days recorded' },
];

const CASES: Array<{
  symbol: string;
  date: string;
  change: string;
  feed: string;
  naive: string;
  booked: string;
  tone: 'accent' | 'amber';
  note: string;
}> = [
  {
    symbol: 'HONx',
    date: '29 Jun 2026',
    change: '+95.11%',
    feed: 'Administrative',
    naive: '95.11% more shares as dividend income',
    booked: 'Spin-off',
    tone: 'accent',
    note: 'Not income. 48.75% of the position\u2019s value came from the spin-off, and the issuer reinvested the proceeds into the parent.',
  },
];

/** One cell is 0.1%. The final row is cut at the track edge; at this scale it would need 951. */
const SIZES: Array<{ who: string; kind: 'dividend' | 'spinoff'; what: string; pct: string; cells: number; cut?: boolean }> = [
  { who: 'WHGROx', kind: 'dividend', what: 'cash dividend', pct: '+2.93%', cells: 29 },
  { who: 'GMEx', kind: 'spinoff', what: 'spin-off', pct: '+0.53%', cells: 5 },
  { who: 'HONx', kind: 'spinoff', what: 'spin-off', pct: '+1.10%', cells: 11 },
  { who: 'DFDVx', kind: 'spinoff', what: 'spin-off', pct: '+1.47%', cells: 15 },
  { who: 'OPENx', kind: 'spinoff', what: 'spin-off', pct: '+2.08%', cells: 21 },
  { who: 'CMCSAx', kind: 'spinoff', what: 'spin-off', pct: '+4.72%', cells: 47 },
  { who: 'HONx', kind: 'spinoff', what: 'spin-off', pct: '+95.11%', cells: 120, cut: true },
];

const ENDPOINTS: Array<{ method: 'GET' | 'POST'; path: string; what: string }> = [
  { method: 'POST', path: '/v1/wallets/sync', what: 'register a wallet, pull its Token-2022 balances' },
  { method: 'GET', path: '/v2/actions', what: 'typed actions with evidence and validation state' },
  { method: 'GET', path: '/v2/actions/{id}', what: 'every issuer revision, its hash, the journal history' },
  { method: 'GET', path: '/v1/portfolio', what: 'positions with basis after each action' },
  { method: 'GET', path: '/v1/journal', what: 'the append-only trail of recognitions and reversals' },
  { method: 'GET', path: '/v1/export', what: 'CSV of the journal, RFC 4180' },
];

export default function Home() {
  return (
    <div className="site">
      <header className="site-header">
        <Logo />
        <div className="site-header-end">
          <ThemeToggle />
          <Link href="/docs/try-it" className="btn btn-sm">
            See a live response
          </Link>
        </div>
      </header>

      <div className="hero-screen">
        <div className="hero-stage">
          <HeroPixels />
          <section className="hero">
          <h1>Corporate actions for tokenized stocks</h1>
          <p className="hero-sub">
            Every on-chain balance change, matched to the issuer’s record and booked as what it actually was.
          </p>
          <p className="hero-cta">
            <a href="#demo" className="btn btn-accent">
              See it working
            </a>
            <Link href="/docs" className="btn">
              Read the docs
            </Link>
          </p>
          </section>
        </div>

        {/* Inside the screen, after the stage: the strip takes its height first and the stage gets
            the rest, so the whole band always lands within the first viewport instead of being
            sliced through the numerals by the fold. */}
        <dl className="specstrip">
          {SPECS.map((s) => (
            <div key={s.label}>
              <dd>{s.n}</dd>
              <dt className="pix">{s.label}</dt>
            </div>
          ))}
        </dl>
      </div>
      <p className="hero-note">
        Chain data is live Solana mainnet, polled continuously. The counts below come from a verified recording of the
        issuer&rsquo;s reference feed (<code>fixtures/xstocks/recorded-20260913</code>, 24 June 2025 to 13
        September 2026), which Corpact runs from until that feed&rsquo;s licence is signed.
      </p>

      {/* Front and centre, directly under the fold: the demo view is the proof this is a product and
          not a library. Every figure in the shot comes from the same public API the page documents. */}
      <section className="showcase" id="demo" aria-labelledby="demo-h">
        <div className="shell showcase-grid">
          <div className="showcase-copy">
            <p className="section-index pix">See it working</p>
            <h2 id="demo-h">A wallet, read end to end.</h2>
            <p>
              This demo view is a reference client with no logic of its own. Every number in it comes from the
              same public API. This is a real mainnet wallet: five positions, the dividend income Corpact will stand
              behind, and the two rows it refuses to.
            </p>
            <ul className="showcase-points">
              <li>
                <strong>KOx, 15 Sep 2026.</strong> The issuer has published only a scheduled announcement, not a
                confirmed record carrying the multipliers that were delivered. An announcement is never evidence, so
                nothing is booked and the row reads <em>Classification pending</em>.
              </li>
              <li>
                <strong>NVDAx, 2 Apr 2026.</strong> A real dividend the issuer cancelled and re-published to correct a
                typo. The corrected version carries no net cash figure, so the units are booked and the USD is left{' '}
                <em>Unknown</em>.
              </li>
            </ul>
            <p className="showcase-run">Point it at the hosted API and run it. No database, no worker, no key of your own:</p>
            <div className="well">
              <pre>
                <code>
                  {`pnpm install \\\n`}
                  {`CORPACT_API_URL=${DEMO_API_URL} \\\n`}
                  {`CORPACT_API_KEY=${DEMO_API_KEY} \\\n`}
                  {`pnpm --filter @corpact/web dev`}
                </code>
              </pre>
            </div>
          </div>

          <div className="frame showcase-shot">
            <p className="frame-bar pix">
              <span className="frame-dots" aria-hidden="true" />
              corpact demo view · mainnet wallet
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/demo-view.png"
              width={1600}
              height={1310}
              alt="The Corpact demo view showing five tokenized stock positions with quantity, protected floor and dividend income, above a list of balance adjustments. One row, KOx on 15 September 2026, is marked Classification pending with no USD value. Another, NVDAx on 2 April 2026, is a verified dividend whose USD value reads Unknown."
            />
          </div>
        </div>
      </section>

      <main>
        <section className="section shell" id="label" aria-labelledby="label-h">
          <p className="section-index pix">01 / What happens</p>
          <h2 id="label-h">What actually happens</h2>
          <div className="section-copy">
            <p>
              This is HONx: what one share became after each on-chain multiplier change. Most steps are cash dividends,
              a fraction of a percent. Two are not. On 30 October the feed labelled a step Dividend; the issuer’s record
              is a spin-off. On 29 June a reverse split cut the units in half, and eight hours later a spin-off put them
              almost back. Corpact books each step from that record, not the feed label, and keeps doing so as new
              changes land.
            </p>
          </div>
          <MultiplierChart />
        </section>

        <section className="section shell" id="cases" aria-labelledby="cases-h">
          <p className="section-index pix">02 / Example</p>
          <h2 id="cases-h">An example</h2>
          <div className="frame">
            <p className="frame-bar pix">
              <span className="frame-dots" aria-hidden="true" />
              ledger.cases · 1 of 654
            </p>
            <table className="cases">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Change</th>
                  <th scope="col">Feed says</th>
                  <th scope="col">A naive ledger books</th>
                  <th scope="col">Corpact books</th>
                </tr>
              </thead>
              <tbody>
                {CASES.map((c) => (
                  <tr key={c.symbol}>
                    <th scope="row">
                      {c.symbol}
                      <span>{c.date}</span>
                    </th>
                    <td className="cases-num" data-label="Change">
                      {c.change}
                    </td>
                    <td className="cases-feed" data-label="Feed says">
                      {c.feed}
                    </td>
                    <td className="cases-naive" data-label="A naive ledger books">
                      <s>{c.naive}</s>
                    </td>
                    <td data-label="Corpact books">
                      <span className={`chip ${c.tone}`}>{c.booked}</span>
                      <span className="cases-note">{c.note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section shell" id="size" aria-labelledby="size-h">
          <p className="section-index pix">03 / Size</p>
          <h2 id="size-h">Why size doesn’t work</h2>
          <div className="section-copy">
            <p>
              The largest real cash dividend in 446 days moved the multiplier 2.93%, and four of the six spin-offs moved
              it less. No threshold separates income from a change in basis.
            </p>
          </div>
          <div className="sizechart">
            {SIZES.map((s, i) => (
              <div className="sizerow" key={`${s.who}-${i}`} data-kind={s.kind} data-cut={s.cut ? 'true' : undefined}>
                <p className="who">
                  <b>{s.who}</b> · {s.what}
                </p>
                <div className="bar" aria-hidden="true">
                  {Array.from({ length: s.cells }, (_, n) => (
                    <i key={n} />
                  ))}
                </div>
                <p className="val">{s.pct}</p>
              </div>
            ))}
          </div>
          <p className="sizenote">
            One cell is 0.1%. Top row: the largest cash dividend in the recording. Below it: every spin-off. The last is
            cut at the chart edge, where it would need 951 cells.
          </p>
        </section>

        <section className="section shell" id="api" aria-labelledby="api-h">
          <p className="section-index pix">04 / API</p>
          <h2 id="api-h">The API</h2>
          <div className="api">
            <div>
              <div className="section-copy">
                <p>
                  Register a wallet, sync it, read typed actions - each with its treatment, lifecycle state, the issuer
                  revision it resolved on, and the SHA-256 of its evidence.
                </p>
              </div>
              <ul className="endpoints">
                {ENDPOINTS.map((e) => (
                  <li key={e.path}>
                    <span className={`method ${e.method.toLowerCase()}`}>{e.method}</span>
                    <code>{e.path}</code>
                    <span className="what">{e.what}</span>
                  </li>
                ))}
              </ul>
              <Link href="/docs/api-reference" className="section-link">
                API reference
              </Link>
            </div>

            <div>
              <div className="frame">
                <p className="frame-bar pix">
                  <span className="frame-dots" aria-hidden="true" />
                  curl · read-only · public key
                </p>
                <div className="well">
                  <pre>
                    <code>
                      {`curl -s "${DEMO_API_URL}/v2/actions`}
                      <span className="tok-flag">{'?owner='}</span>
                      {DEMO_WALLET}
                      <span className="tok-flag">{'&limit='}</span>
                      {'5" \\\n  -H "'}
                      <span className="tok-str">x-api-key</span>
                      {`: ${DEMO_API_KEY}"`}
                    </code>
                  </pre>
                </div>
              </div>
              <div className="section-copy">
                <p>
                  That key is read-only, on its own tenant, and public on purpose. The host sleeps when idle, so the
                  first request can take a few seconds.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section shell" id="status" aria-labelledby="status-h">
          <p className="section-index pix">05 / Status</p>
          <h2 id="status-h">Status</h2>
          <dl className="status">
            <div>
              <dt className="pix">Data</dt>
              <dd>
                Chain data is live Solana mainnet: the worker polls mint state continuously and classifies each change
                as it activates. The issuer&rsquo;s reference feed is a licensed third-party product, and Corpact runs
                it from a verified recording of 654 changes over 446 days because the provider&rsquo;s terms prohibit
                automated retrieval until that licence is signed. Switching to the live feed is one environment
                variable, <code>ISSUER_SOURCE=live</code>, and no code change.
              </dd>
            </div>
            <div>
              <dt className="pix">Evidence</dt>
              <dd>
                244 tests, and 59 of 59 end-to-end checks on both Surfpool and solana-test-validator. The journal is
                append-only, enforced by <code>forbid_mutation()</code> triggers on ten tables.
              </dd>
            </div>
            <div>
              <dt className="pix">Scope</dt>
              <dd>
                Corpact accounts for corporate actions. It does not move, convert or harvest anything, and nothing is
                priced or billed.
              </dd>
            </div>
          </dl>
        </section>

      </main>

      <footer className="site-footer">
        <div className="shell site-footer-top">
          <div className="site-footer-brand">
            <Logo />
            <p>Corporate actions for tokenized stocks, booked from the issuer&rsquo;s own record.</p>
          </div>
          <nav className="pix" aria-label="Footer">
            <Link href="/docs">Docs</Link>
            <Link href="/docs/api-reference">API reference</Link>
            <Link href="/docs/actions">Corporate actions</Link>
            <Link href="/docs/concepts/classification">Classification</Link>
          </nav>
        </div>
        <div className="shell site-footer-base">
          <span>FIXTURES: XSTOCKS/RECORDED-20260913 · 654 CHANGES</span>
          <span>© Corpact</span>
        </div>
      </footer>
    </div>
  );
}
