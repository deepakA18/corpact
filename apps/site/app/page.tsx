import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  ChecksGauge,
  ClassifierCard,
  CoverageStat,
  EvidenceCore,
  Glyphs,
  IconTile,
  JournalActivity,
  NoTransferTimeline,
  PipelineCard,
  ProviderShield,
} from '@/components/home/Visuals';
import { highlight } from '@/lib/highlight';

const SDK_SAMPLE = `
import { createCorpactClient } from '@corpact/client';

const corpact = createCorpactClient({
  baseUrl: 'https://api.corpact.example',
  apiKey: process.env.CORPACT_API_KEY,
});

await corpact.requestSync(wallet);
const { entries } = await corpact.income(wallet);
`;

const RESPONSE_SAMPLE = `
{
  "kind": "dividend",
  "symbol": "KOx",
  "effectiveAt": "2026-06-14T23:55:00.000Z",
  "quantityDisplay": "0.09059763",
  "usd": "7.4851762504",
  "valuation": "issuer_net_cash",
  "revision": 1,
  "headline": "Your KOx position gained 0.09059763 stock-equivalent units from a verified dividend adjustment. This remains invested in the stock."
}
`;

const STEPS: Array<{ title: string; body: string }> = [
  { title: 'Observe', body: 'Reads every Token-2022 multiplier write and scheduled activation, settled on the finalized cluster clock.' },
  { title: 'Match', body: 'Pairs each change with the issuer’s corporate action on exact multipliers and activation time. No match, no income.' },
  { title: 'Account', body: 'Replays balances into a protected stock floor, adjusts for splits, and values only from issuer-reported cash.' },
  { title: 'Prove', body: 'Reconciles to the raw chain balance, cross-checks an independent RPC, and journals every correction.' },
];

const AUDIENCES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'layers', title: 'Exchanges & custodians', body: 'Show customers the dividends their tokenized stocks earned — a number that never arrives as a transfer.' },
  { icon: 'link', title: 'Protocols & wallets', body: 'Separate dividend growth from principal, so lending, vaults and portfolio views stop treating a split as yield.' },
  { icon: 'book', title: 'Tax & accounting tools', body: 'Export an append-only journal with evidence, revisions and coverage on every row — defensible in an audit.' },
];

const REFUSALS: Array<{ q: string; a: string }> = [
  { q: 'No trustworthy price?', a: 'USD is null — never zero — and the event is counted as unvalued.' },
  { q: 'History incomplete?', a: 'The position is marked partial and no yield is claimed for it.' },
  { q: 'Change the issuer never explained?', a: 'It is shown as pending classification, not income.' },
  { q: 'Issuer revises an action?', a: 'A reversal and a replacement are appended. Nothing is edited.' },
];

export default async function Home() {
  const [sdk, response] = await Promise.all([highlight(SDK_SAMPLE, 'ts'), highlight(RESPONSE_SAMPLE, 'json')]);

  return (
    <div className="site">
      <header className="site-header">
        <Logo />
        <nav className="site-nav" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#traps">What it catches</a>
          <a href="#developers">Developers</a>
          <Link href="/docs">Docs</Link>
        </nav>
        <div className="site-header-end">
          <ThemeToggle />
          <Link href="/docs/quickstart" className="btn btn-ghost btn-sm">
            Get started
          </Link>
        </div>
      </header>

      <section className="hero">
        <Glyphs />
        <span className="eyebrow">
          <b>Private preview</b> Tokenized stocks on Solana
        </span>
        <h1>
          Corporate Actions,
          <br />
          Reconciled to the Chain
        </h1>
        <p className="hero-sub">
          Corpact is an API-first ledger for tokenized stocks. It turns multiplier changes that arrive with no transaction into evidence-backed dividends, splits and
          corrections — so your product can show holders what they actually earned.
        </p>
        <div className="hero-cta">
          <Link href="/docs/quickstart" className="btn btn-accent">
            Get Started
          </Link>
          <Link href="/docs" className="btn btn-ghost">
            Read the docs <Icon name="arrow" size={16} />
          </Link>
        </div>

        <div className="bento">
          <div className="bento-col side">
            <div className="row">
              <CoverageStat />
              <IconTile name="clock" />
            </div>
            <PipelineCard />
            <JournalActivity />
          </div>
          <div className="bento-col center">
            <EvidenceCore />
            <NoTransferTimeline />
          </div>
          <div className="bento-col side">
            <ClassifierCard />
            <div className="row">
              <IconTile name="code" dark />
              <ChecksGauge />
            </div>
            <ProviderShield />
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-head center">
          <span className="kicker">How it works</span>
          <h2>From a silent multiplier change to a ledger entry you can defend</h2>
          <p className="section-sub">
            Tokenized stocks pay dividends by changing a multiplier on the mint. Wallet balances never move, so transfer-based indexers see nothing. Corpact reads
            the change, proves what it was, and accounts for it.
          </p>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title}>
              <span className="step-num">{i + 1}</span>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="traps">
        <div className="section-head">
          <span className="kicker">What it catches</span>
          <h2>The obvious reading is wrong often enough to matter</h2>
          <p className="section-sub">From the recorded issuer data set: 654 real multiplier changes, run through the production classifier.</p>
        </div>
        <div className="traps">
          <div className="trap">
            <span className="trap-sym">HONx · 2026-06-29</span>
            <h4>A +95% change that is a spin-off</h4>
            <div className="verdict naive">
              <b>Naive reading</b>Books 95.11% more shares as dividend income.
            </div>
            <div className="verdict ours">
              <b>Corpact</b>Unclassified adjustment. The issuer record is a SpinOff, so no income is booked.
            </div>
            <p className="trap-foot">24 multiplier increases in the data set are not cash dividends.</p>
          </div>
          <div className="trap">
            <span className="trap-sym">STRCx · 2025-11-30</span>
            <h4>Issuer cash the shares can’t support</h4>
            <div className="verdict naive">
              <b>Naive reading</b>Books $0.627 of income per share held.
            </div>
            <div className="verdict ours">
              <b>Corpact</b>Dividend kept, USD unknown: the cash implies $953,728 per share against a $94.80 median.
            </div>
            <p className="trap-foot">7 dividends refuse an implausible issuer valuation.</p>
          </div>
          <div className="trap">
            <span className="trap-sym">14 changes</span>
            <h4>The label says “Dividend”; the evidence disagrees</h4>
            <div className="verdict naive">
              <b>Naive reading</b>Trusts the multiplier-history reason field.
            </div>
            <div className="verdict ours">
              <b>Corpact</b>Classifies from the issuer corporate action — spin-offs, a stock dividend, a merger and unexplained changes are not income.
            </div>
            <p className="trap-foot">628 verified dividends · 9 reconciled splits · 17 not attributed.</p>
          </div>
        </div>
        <p className="provenance">Figures come from xStocks issuer responses recorded on 2026-09-13 and replayed offline. No market prices are used.</p>
      </section>

      <section className="section" id="audiences">
        <div className="section-head center">
          <span className="kicker">Built for</span>
          <h2>Teams who owe holders an accurate number</h2>
        </div>
        <div className="audience">
          {AUDIENCES.map((a) => (
            <div className="step" key={a.title}>
              <span className="step-num">
                <Icon name={a.icon} size={18} />
              </span>
              <h4>{a.title}</h4>
              <p>{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="developers">
        <div className="dev">
          <div>
            <span className="kicker">Developers</span>
            <h2>One API. Typed end to end.</h2>
            <p className="section-sub">
              A JSON-schema contract generates the OpenAPI document, the server validation and the TypeScript client. Scoped keys, tenant isolation and CSV exports are
              built in.
            </p>
            <ul className="endpoints">
              <li>
                <span className="method post">POST</span>
                <code>/v1/wallets/sync</code> register and sync a wallet
              </li>
              <li>
                <span className="method get">GET</span>
                <code>/v1/portfolio</code> positions, floor and coverage
              </li>
              <li>
                <span className="method get">GET</span>
                <code>/v1/income</code> dividends, splits, pending changes
              </li>
              <li>
                <span className="method get">GET</span>
                <code>/v1/journal</code> append-only audit trail
              </li>
              <li>
                <span className="method get">GET</span>
                <code>/v1/export</code> accountant-ready CSV
              </li>
            </ul>
            <div className="hero-cta" style={{ justifyContent: 'flex-start' }}>
              <Link href="/docs/quickstart" className="btn btn-accent">
                Quickstart
              </Link>
              <Link href="/docs/api-reference" className="btn btn-ghost">
                API reference
              </Link>
            </div>
          </div>
          <div className="window">
            <div className="window-bar">
              <i />
              <i />
              <i />
              <span>income.ts</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: sdk }} />
            <div className="window-bar split">
              <span style={{ marginLeft: 0 }}>GET /v1/income → entries[0]</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: response }} />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head center">
          <span className="kicker">What we refuse to guess</span>
          <h2>Honest by construction</h2>
        </div>
        <div className="refuse">
          {REFUSALS.map((r) => (
            <div className="refuse-item" key={r.q}>
              <span className="icon">
                <Icon name="shield" size={20} />
              </span>
              <div>
                <div className="q">{r.q}</div>
                <p>{r.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2>See your first verified dividend in minutes</h2>
        <p>Run the demo on a local network, or point the worker at mainnet and sync a real wallet.</p>
        <div className="hero-cta">
          <Link href="/docs/quickstart" className="btn btn-accent">
            Get Started
          </Link>
          <Link href="/docs/operations/demo" className="btn btn-ghost">
            Run the demo
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <Logo />
        <nav aria-label="Footer">
          <Link href="/docs">Docs</Link>
          <Link href="/docs/api-reference">API reference</Link>
          <Link href="/docs/concepts/classification">How classification works</Link>
        </nav>
        <span>© 2026 Corpact</span>
      </footer>
    </div>
  );
}
