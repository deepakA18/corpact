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
const { actions } = await corpact.v2.actions(wallet);
`;

const RESPONSE_SAMPLE = `
{
  "type": "spin_off",
  "symbol": "HONx",
  "treatment": "basis_allocation",
  "validation": { "status": "validated", "realInstances": 6 },
  "lifecycle": { "state": "activated" },
  "distributedFraction": "0.48747",
  "usd": null,
  "headline": "HONx: spin-off delivered as cash reinvested in the parent. No income."
}
`;

const PROOF: Array<{ value: string; label: string }> = [
  { value: '654', label: 'real corporate actions replayed and classified' },
  { value: '18', label: 'action types, each with a stated validation status' },
  { value: '59/59', label: 'end-to-end checks through the live API' },
  { value: '0', label: 'values guessed: unknown is never shown as zero' },
];

const PAINS: Array<{ title: string; body: string }> = [
  {
    title: 'The income never arrives as a transfer',
    body: 'Tokenized stocks pay dividends by rewriting a multiplier on the mint. Balances do not move, so transfer-based indexers and wallets record nothing.',
  },
  {
    title: 'The obvious signals are wrong',
    body: 'A spin-off can look like a 95% dividend. A stock dividend, a rights sale and an ADR conversion all hide behind misleading labels in the issuer’s own feeds.',
  },
  {
    title: 'Every mistake reaches a customer',
    body: 'Overstated income ends up in portfolio views, lending limits and tax reports. Correcting it later means explaining it to holders and auditors.',
  },
];

const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'shield',
    title: 'Classified from evidence',
    body: 'Every change is matched to the issuer’s record on exact multipliers and activation time. Never on size, never on a label.',
  },
  {
    icon: 'layers',
    title: 'Every basis event handled',
    body: 'Cash dividends, withholding refunds, splits, stock dividends, spin-offs, rights and identity changes, each booked with the right treatment.',
  },
  {
    icon: 'link',
    title: 'Position lineage',
    body: 'When an underlying changes form, cost basis is carried across exactly and the full chain of identities stays traceable.',
  },
  {
    icon: 'book',
    title: 'Append-only journal',
    body: 'Issuer corrections become a reversal plus a replacement. Nothing is edited, so every number you showed can be explained later.',
  },
  {
    icon: 'check',
    title: 'Reconciled to the chain',
    body: 'Positions replay to the exact raw on-chain balance and are cross-checked against an independent RPC provider.',
  },
  {
    icon: 'code',
    title: 'One typed API',
    body: 'A single JSON-schema contract generates the OpenAPI document, server validation and a TypeScript client. Scoped keys and tenancy built in.',
  },
];

const STEPS: Array<{ title: string; body: string }> = [
  { title: 'Observe', body: 'Read every multiplier write and scheduled activation, settled on finalized chain time.' },
  { title: 'Match', body: 'Pair each change with the issuer’s corporate action. No evidence, no booking.' },
  { title: 'Account', body: 'Book income, basis adjustments and lineage with exact arithmetic.' },
  { title: 'Prove', body: 'Reconcile to the chain, cross-check a second provider and journal every correction.' },
];

const USE_CASES: Array<{ icon: IconName; title: string; body: string; points: string[] }> = [
  {
    icon: 'layers',
    title: 'Exchanges and custodians',
    body: 'Show customers what their tokenized stocks actually earned.',
    points: ['Dividend history per position', 'Splits and spin-offs explained in plain language', 'Coverage stated, never implied'],
  },
  {
    icon: 'link',
    title: 'Protocols and wallets',
    body: 'Separate real yield from principal before it reaches a limit or a vault.',
    points: ['Protected principal floor per position', 'Convertible amount only when fully reconciled', 'Pauses automatically when data sources disagree'],
  },
  {
    icon: 'book',
    title: 'Tax and accounting tools',
    body: 'Import corporate actions with the evidence an auditor asks for.',
    points: ['Allocation factors for spin-offs and rights', 'Lifecycle and every issuer revision', 'CSV export of the append-only journal'],
  },
];

const COMPARISON: Array<[string, string, string]> = [
  ['Dividend detection', 'Build a multiplier timeline reader and handle scheduled activations', 'Included'],
  ['Spin-offs, stock dividends, rights, ADR conversions', 'Research each issuer’s delivery method case by case', 'Classified and validated on real data'],
  ['Issuer corrections', 'Overwrite history or build a journal', 'Reversal plus replacement, append-only'],
  ['Mislabelled and implausible issuer data', 'Discovered by customers', 'Caught and flagged with a stated reason'],
  ['Reconciliation', 'Custom scripts per asset', 'Exact raw-balance match plus a second RPC provider'],
  ['Audit trail', 'Logs, if kept', 'Evidence hashes, timestamps and lineage on every action'],
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Which tokenized stocks are supported?', a: 'xStocks on Solana today, across every recorded asset. Additional issuers are added together with design partners.' },
  { q: 'Does Corpact hold or move funds?', a: 'No. Corpact is read-only. It never signs a transaction and never takes custody.' },
  { q: 'What happens when the evidence is missing?', a: 'The change is shown as pending classification with its reason. No income is booked and nothing is made convertible.' },
  { q: 'Do you provide tax advice?', a: 'No. Corpact supplies allocation factors, lineage and evidence. Tax treatment stays with your tax engine and its counsel.' },
];

export default async function Home() {
  const [sdk, response] = await Promise.all([highlight(SDK_SAMPLE, 'ts'), highlight(RESPONSE_SAMPLE, 'json')]);

  return (
    <div className="site">
      <header className="site-header">
        <Logo />
        <nav className="site-nav" aria-label="Main">
          <a href="#product">Product</a>
          <a href="#use-cases">Use cases</a>
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
          <b>Private preview</b> Built for tokenized stock platforms
        </span>
        <h1>
          Every Corporate Action,
          <br />
          Accounted For
        </h1>
        <p className="hero-sub">
          Dividends, splits and spin-offs reach tokenized stocks as silent changes on chain. Corpact turns them into an audit-ready ledger your exchange, wallet or tax
          product can trust, through one API.
        </p>
        <div className="hero-cta">
          <Link href="/docs/quickstart" className="btn btn-accent">
            Start building
          </Link>
          <a href="#proof" className="btn btn-ghost">
            See the proof <Icon name="arrow" size={16} />
          </a>
        </div>

        <div className="proof-strip">
          {PROOF.map((p) => (
            <div className="proof-item" key={p.label}>
              <strong>{p.value}</strong>
              <span>{p.label}</span>
            </div>
          ))}
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

      <section className="section" id="problem">
        <div className="section-head center">
          <span className="kicker">The problem</span>
          <h2>Tokenized stock income is invisible to the tools you already have</h2>
          <p className="section-sub">Reading it wrong is easy. Explaining the mistake to a customer is not.</p>
        </div>
        <div className="pains">
          {PAINS.map((p, i) => (
            <div className="pain" key={p.title}>
              <span className="pain-num">0{i + 1}</span>
              <h4>{p.title}</h4>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="product">
        <div className="section-head center">
          <span className="kicker">The product</span>
          <h2>A corporate-actions engine you can put in front of customers</h2>
          <p className="section-sub">Everything needed to turn raw chain data into numbers your holders, partners and auditors will accept.</p>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <span className="feature-icon">
                <Icon name={f.icon} size={20} />
              </span>
              <h4>{f.title}</h4>
              <p>{f.body}</p>
            </div>
          ))}
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

      <section className="section" id="proof">
        <div className="section-head">
          <span className="kicker">Proven on real data</span>
          <h2>Where the obvious reading fails, Corpact gets it right</h2>
          <p className="section-sub">Every real multiplier change published for xStocks on Solana, replayed through the production engine.</p>
        </div>
        <div className="traps">
          <div className="trap">
            <span className="trap-sym">HONx spin-off</span>
            <h4>A +95% change that is not income</h4>
            <div className="verdict naive">
              <b>Naive reading</b>Books 95.11% more shares as dividend income.
            </div>
            <div className="verdict ours">
              <b>Corpact</b>Books a basis allocation: 48.75% of the position’s value arrived as principal. No income.
            </div>
            <p className="trap-foot">22 multiplier increases in the data set are not cash dividends.</p>
          </div>
          <div className="trap">
            <span className="trap-sym">KRAQx rights sale</span>
            <h4>Labelled a unit split by the issuer</h4>
            <div className="verdict naive">
              <b>Naive reading</b>Trusts the label and books a split, or books +1.38% as income.
            </div>
            <div className="verdict ours">
              <b>Corpact</b>Reads the issuer’s note, recognises warrants sold and reinvested, and allocates basis. No income.
            </div>
            <p className="trap-foot">12 changes carry a label the evidence contradicts.</p>
          </div>
          <div className="trap">
            <span className="trap-sym">LINx withholding refund</span>
            <h4>Tax refunded as a “new dividend”</h4>
            <div className="verdict naive">
              <b>Naive reading</b>Lets the refund replace the original dividend, or double-counts it.
            </div>
            <div className="verdict ours">
              <b>Corpact</b>Keeps both, labels the refund, and deducts withholding exactly once.
            </div>
            <p className="trap-foot">628 cash dividends · 2 refunds · 10 splits · 7 spin-offs and rights · 1 identity change.</p>
          </div>
        </div>
      </section>

      <section className="section" id="use-cases">
        <div className="section-head center">
          <span className="kicker">Use cases</span>
          <h2>Built for teams who owe holders an accurate number</h2>
        </div>
        <div className="usecases">
          {USE_CASES.map((u) => (
            <div className="feature usecase" key={u.title}>
              <span className="feature-icon">
                <Icon name={u.icon} size={20} />
              </span>
              <h4>{u.title}</h4>
              <p>{u.body}</p>
              <ul>
                {u.points.map((point) => (
                  <li key={point}>
                    <Icon name="check" size={16} />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="compare">
        <div className="section-head center">
          <span className="kicker">Build or buy</span>
          <h2>Skip the year of edge cases</h2>
          <p className="section-sub">What it takes to get corporate actions right in-house, and what you get with Corpact on day one.</p>
        </div>
        <div className="compare">
          <div className="compare-row compare-head">
            <span />
            <span>Building in-house</span>
            <span>With Corpact</span>
          </div>
          {COMPARISON.map(([topic, diy, corpact]) => (
            <div className="compare-row" key={topic}>
              <span className="compare-topic">{topic}</span>
              <span className="compare-diy">{diy}</span>
              <span className="compare-ours">
                <Icon name="check" size={16} />
                {corpact}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="developers">
        <div className="dev">
          <div>
            <span className="kicker">Developers</span>
            <h2>Integrate in an afternoon</h2>
            <p className="section-sub">Register a wallet, sync it and read typed corporate actions. Every response carries its evidence, validation status and lifecycle.</p>
            <ul className="endpoints">
              <li>
                <span className="method post">POST</span>
                <code>/v1/wallets/sync</code> register and sync a wallet
              </li>
              <li>
                <span className="method get">GET</span>
                <code>/v2/actions</code> type, lifecycle, evidence, validation
              </li>
              <li>
                <span className="method get">GET</span>
                <code>/v1/portfolio</code> positions, floor and coverage
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
              <span>actions.ts</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: sdk }} />
            <div className="window-bar split">
              <span style={{ marginLeft: 0 }}>GET /v2/actions: one action (excerpt)</span>
            </div>
            <div dangerouslySetInnerHTML={{ __html: response }} />
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="section-head center">
          <span className="kicker">Questions</span>
          <h2>What teams ask first</h2>
        </div>
        <div className="refuse">
          {FAQ.map((f) => (
            <div className="refuse-item" key={f.q}>
              <span className="icon">
                <Icon name="shield" size={20} />
              </span>
              <div>
                <div className="q">{f.q}</div>
                <p>{f.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2>Give your holders numbers they can trust</h2>
        <p>Start with the quickstart, or run the full demo locally with one command.</p>
        <div className="hero-cta">
          <Link href="/docs/quickstart" className="btn btn-accent">
            Start building
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
          <Link href="/docs/actions">Corporate actions</Link>
        </nav>
        <span>© Corpact</span>
      </footer>
    </div>
  );
}
