import { Icon } from '../Icon';

/** Deterministic glyph texture behind the hero (no randomness, so server and client agree). */
export function Glyphs() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+*#&<>=$@';
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647);
  const rows = Array.from({ length: 34 }, () =>
    Array.from({ length: 110 }, () => (next() % 5 === 0 ? alphabet[next() % alphabet.length] : ' ')).join(''),
  );
  return (
    <div className="glyphs" aria-hidden="true">
      {rows.map((row, i) => (
        <div key={i}>{row}</div>
      ))}
    </div>
  );
}

/** The balance-with-no-transfer moment: a flat raw balance, a displayed quantity that steps up. */
export function NoTransferTimeline() {
  return (
    <div className="card timeline">
      <h3>Income with no transfer</h3>
      <svg viewBox="0 0 320 150" role="img" aria-label="Raw balance stays flat while displayed quantity steps up at activation">
        <defs>
          <linearGradient id="step-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b76ff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#5b76ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M10 92 H168 V52 H310 V140 H10 Z" fill="url(#step-fill)" />
        <path d="M10 92 H168 V52 H310" fill="none" stroke="#6f8bff" strokeWidth="2.5" />
        <path d="M10 112 H310" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="5 6" />
        <line x1="168" y1="18" x2="168" y2="140" stroke="currentColor" strokeOpacity="0.25" strokeDasharray="3 5" />
        <circle cx="168" cy="52" r="5" fill="#fff" stroke="#5b76ff" strokeWidth="3" />
        <text x="176" y="30" fontSize="11" fill="currentColor" opacity="0.7">activation 23:55:00</text>
        <text x="14" y="84" fontSize="11" fill="currentColor" opacity="0.7">displayed quantity</text>
        <text x="14" y="130" fontSize="11" fill="currentColor" opacity="0.55">raw balance · unchanged</text>
      </svg>
      <div className="chips" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <span className="chip">0 transactions</span>
        <span className="chip green">+0.35 shares</span>
        <span className="chip accent">$35.00 retained in stock</span>
      </div>
    </div>
  );
}

export function EvidenceCore() {
  return (
    <div className="card core">
      <h3>Evidence, not guesswork</h3>
      <p className="core-sub">Every multiplier change is matched to the issuer’s own record, or it is not booked as income.</p>
      <div className="chips">
        <span className="chip green">CashDividend · verified</span>
        <span className="chip red">Spin-off · basis, not income</span>
        <span className="chip amber">USD unknown · never zero</span>
      </div>
      <div className="core-arc" aria-hidden="true">
        <div>1001010110 0101 1100 010110 1001</div>
        <div>0110 1001010110 0010 11010</div>
        <div>100110 0101 1001 0110</div>
      </div>
      <div className="orb" aria-hidden="true" />
    </div>
  );
}

export function PipelineCard() {
  return (
    <div className="card">
      <h3>Chain to ledger</h3>
      <div className="pipeline">
        <div className="pipeline-steps">
          <span>Observe multiplier writes</span>
          <span>Settle on finalized time</span>
          <span>Match issuer evidence</span>
          <span>Replay & reconcile</span>
        </div>
        <span className="pipeline-out">Ledger via API</span>
      </div>
    </div>
  );
}

export function CoverageStat() {
  return (
    <div className="card">
      <div className="stat-big">654</div>
      <div className="stat-label">real multiplier changes, every one accounted for</div>
      <div className="bars" aria-hidden="true">
        <span style={{ width: '96%' }} />
        <span style={{ width: '62%' }} />
        <span className="amber" style={{ width: '30%' }} />
        <span className="red" style={{ width: '18%' }} />
      </div>
    </div>
  );
}

export function ClassifierCard() {
  const rows = [
    { sym: 'KOx', what: '+0.45% · CashDividend', tag: 'Dividend $0.371', tone: 'green' },
    { sym: 'NFLXx', what: '+900% · ForwardSplit', tag: 'Split 10:1', tone: 'accent' },
    { sym: 'HONx', what: '+95.11% · SpinOff', tag: 'Basis, not income', tone: 'red' },
    { sym: 'STRCx', what: 'implies $953,728/share', tag: 'USD unknown', tone: 'amber' },
  ];
  return (
    <div className="card">
      <h3>Classified from evidence</h3>
      <div className="classify">
        {rows.map((r) => (
          <div className="classify-row" key={r.sym}>
            <span className="sym">{r.sym}</span>
            <span className="what">{r.what}</span>
            <span className={`chip ${r.tone}`}>{r.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProviderShield() {
  return (
    <div className="card shield-card">
      <h3>Two providers, one truth</h3>
      <div className="shield">
        <svg width="112" height="124" viewBox="0 0 112 124" aria-hidden="true">
          <defs>
            <linearGradient id="shield-fill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#5a6788" />
              <stop offset="1" stopColor="#2a3350" />
            </linearGradient>
          </defs>
          <path d="M56 6 12 22v34c0 30 19 52 44 62 25-10 44-32 44-62V22z" fill="url(#shield-fill)" stroke="rgba(255,255,255,.18)" />
          <path d="m36 62 14 14 28-30" fill="none" stroke="#6f8bff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="card-note">Balances and multiplier state are cross-checked against an independent RPC. A disagreement pauses conversion; it never edits the ledger.</p>
    </div>
  );
}

export function ChecksGauge() {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="card">
      <div className="gauge">
        <svg width="170" height="170" viewBox="0 0 170 170" aria-hidden="true">
          {ticks.map((i) => {
            const a = (i / 60) * Math.PI * 2;
            const inner = 62;
            const outer = i % 5 === 0 ? 80 : 74;
            return (
              <line
                key={i}
                x1={85 + Math.cos(a) * inner}
                y1={85 + Math.sin(a) * inner}
                x2={85 + Math.cos(a) * outer}
                y2={85 + Math.sin(a) * outer}
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeWidth={1.4}
              />
            );
          })}
        </svg>
        <div style={{ textAlign: 'center' }}>
          <div className="stat-big">59/59</div>
          <div className="stat-label">demo checks</div>
        </div>
      </div>
    </div>
  );
}

export function JournalActivity() {
  return (
    <div className="card">
      <h3>Corrections, journaled</h3>
      <div className="activity">
        <div className="activity-row">
          <span className="dot" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>#1</span>
          <span>
            Dividend recognized<small>issuer revision 1</small>
          </span>
          <span className="amt strike">$35.00</span>
        </div>
        <div className="activity-row">
          <span className="dot" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>#3</span>
          <span>
            Reversal of #1<small>issuer_correction</small>
          </span>
          <span className="amt">−$35.00</span>
        </div>
        <div className="activity-row">
          <span className="dot" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>#4</span>
          <span>
            Replacement<small>issuer revision 2</small>
          </span>
          <span className="amt">$33.00</span>
        </div>
      </div>
    </div>
  );
}

export function IconTile({ name, dark = false }: { name: 'link' | 'code' | 'layers' | 'clock'; dark?: boolean }) {
  return (
    <div className={`tile ${dark ? 'dark' : ''}`}>
      <Icon name={name} size={40} />
    </div>
  );
}
