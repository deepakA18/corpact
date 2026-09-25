'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { CorpactApiError, api, type IncomeEntry, type Portfolio, type SyncStatus, type YieldResponse } from '../lib/api';
import { formatDate, formatDateTime, formatPercent, formatQuantity, formatUsd, shortAddress } from '../lib/format';

type PositionYield = YieldResponse['positions'][number];
import { EventDrawer } from './EventDrawer';

const ACTIVE: ReadonlyArray<SyncStatus['status']> = ['queued', 'running'];
/** A job queued this long without being claimed almost always means no worker is running. */
const WORKER_STALL_MS = 20_000;

const codeOf = (err: unknown) => (err instanceof CorpactApiError ? (err.body as { code?: string } | null)?.code : undefined);
const isUnregistered = (err: unknown) => err instanceof CorpactApiError && err.status === 404 && codeOf(err) === 'wallet_not_registered';
/** A read-only key cannot sync. That is a property of the key, not a failure worth a red banner. */
const isReadOnlyKey = (err: unknown) => err instanceof CorpactApiError && err.status === 403 && codeOf(err) === 'missing_scope';

const KIND_LABEL: Record<IncomeEntry['kind'], { text: string; tone: string }> = {
  dividend: { text: 'Verified dividend', tone: 'verified' },
  split: { text: 'Stock split', tone: '' },
  unclassified_adjustment: { text: 'Classification pending', tone: 'caution' },
};

export function WalletLedger({ owner }: { owner: string }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  // undefined until the request settles; null once it has settled without an answer. The two must stay
  // distinct: a row that has not loaded is not a row whose yield the engine declined to claim.
  const [yields, setYields] = useState<YieldResponse | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([api.portfolio(owner), api.income(owner)]);
      setPortfolio(p);
      setEntries(i.entries);
      // Supplementary: a yield failure should not hide the ledger.
      setYields(await api.yield(owner).catch(() => null));
      setSync(p.dataStatus);
      setNotRegistered(false);
      setError(null);
    } catch (err) {
      if (isUnregistered(err)) {
        // Not an error: this tenant simply has not synced the wallet yet.
        setPortfolio(null);
        setEntries([]);
        setNotRegistered(true);
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [owner]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!sync || !ACTIVE.includes(sync.status)) return;
    const timer = setInterval(async () => {
      try {
        const { sync: next } = await api.status(owner);
        setSync(next);
        if (next && !ACTIVE.includes(next.status)) void load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [owner, sync, load]);

  const requestSync = async () => {
    setRequesting(true);
    try {
      await api.sync(owner);
      const { sync: next } = await api.status(owner);
      setSync(next);
    } catch (err) {
      if (isReadOnlyKey(err)) setReadOnly(true);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  };

  const syncing = sync !== null && ACTIVE.includes(sync.status);
  const hasData = portfolio !== null && portfolio.positions.length > 0;

  return (
    <div className="stack">
      <header>
        <Link href="/" className="muted">
          ← Back
        </Link>
        <div className="row spread">
          <h1>Wallet ledger</h1>
          {readOnly ? (
            <span className="muted">Read-only key</span>
          ) : (
            <button onClick={() => void requestSync()} disabled={syncing || requesting}>
              {syncing ? 'Syncing…' : hasData ? 'Refresh history' : 'Sync on-chain history'}
            </button>
          )}
        </div>
        <Meta owner={owner} portfolio={portfolio} />
      </header>

      {error && <p className="error">Could not load the ledger: {error}</p>}
      <SyncBanner sync={sync} />

      {portfolio && !hasData && !syncing && (sync?.status === 'complete' || sync?.status === 'partial') && (
        <div className="banner">
          <strong>No xStock positions found</strong>
          <span className="muted">
            Checked {sync.transactionsFetched} transaction(s) of this wallet&apos;s history: it has never held a supported xStock directly.
          </span>
        </div>
      )}
      {notRegistered && !syncing && (
        <div className="banner">
          <strong>Not synced yet</strong>
          <span className="muted">Sync this address to reconstruct its xStock holdings from chain history.</span>
        </div>
      )}

      {portfolio && hasData && (
        <>
          <Headline portfolio={portfolio} />
          <Positions portfolio={portfolio} yields={yields} />
          <Events owner={owner} entries={entries} onSelect={setSelected} />
        </>
      )}

      {selected && <EventDrawer owner={owner} id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Address, data source and the window the ledger covers, on one line instead of a banner and a card. */
function Meta({ owner, portfolio }: { owner: string; portfolio: Portfolio | null }) {
  const gaps = portfolio
    ? [...new Set(portfolio.positions.flatMap((p) => p.coverage.gaps.map((g) => `${p.symbol}: ${g}`)))]
    : [];
  return (
    <>
      <div className="meta">
        <span className="mono" title={owner}>
          {shortAddress(owner)}
        </span>
        {portfolio && <span>{portfolio.dataset.kind === 'mainnet' ? 'Solana mainnet' : portfolio.dataset.kind}</span>}
        {portfolio?.coverage.trackingStart && <span>Tracked since {formatDate(portfolio.coverage.trackingStart)}</span>}
      </div>
      {gaps.length > 0 && (
        <details className="notes">
          <summary>{gaps.length} coverage note(s)</summary>
          <ul className="gaps">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function SyncBanner({ sync }: { sync: SyncStatus | null }) {
  if (!sync) return null;
  if (sync.status === 'queued' && Date.now() - new Date(sync.requestedAt).getTime() > WORKER_STALL_MS) {
    return (
      <div className="banner partial">
        <strong>Waiting for the worker</strong>
        <span className="muted">
          This sync has been queued since {formatDateTime(sync.requestedAt)} and nothing has picked it up. The background worker may not be
          running (start it with <span className="mono">pnpm start</span> in apps/worker).
        </span>
      </div>
    );
  }
  if (ACTIVE.includes(sync.status)) {
    const { phase, done, total } = sync.progress;
    const queued = sync.status === 'queued';
    return (
      <div className="banner banner-live">
        {/* A backfill runs for minutes and the phase line only changes every few polls: the orb is what
            says the page is still waiting rather than stuck. `breathing` while queued, `searching` once
            the worker is actually reading chain history. */}
        <ThinkingOrb
          state={queued ? 'breathing' : 'searching'}
          size={64}
          aria-label={queued ? 'Sync queued' : 'Reading on-chain history'}
        />
        <div>
          <strong>{queued ? 'Sync queued' : 'Reading on-chain history'}</strong>
          <span className="muted">
            {phase ?? 'Starting'}
            {done !== undefined && total !== undefined ? `: ${done} of ${total}` : ''}
          </span>
        </div>
      </div>
    );
  }
  if (sync.status === 'failed') {
    return (
      <div className="banner partial">
        <strong>The last sync failed</strong>
        <span className="mono">{sync.error}</span>
      </div>
    );
  }
  return null;
}

/**
 * The three numbers the engine exists to produce: what was recognized as income, how many balance
 * changes it accounted for, and how many it refused to guess at. Counts come from the position
 * rollups rather than the entry list, so they do not depend on the page size of /v1/income.
 */
function Headline({ portfolio }: { portfolio: Portfolio }) {
  const { totals, positions } = portfolio;
  const dividends = positions.reduce((n, p) => n + p.dividendEvents, 0);
  const unknown = totals.unvaluedDividendEvents + totals.unclassifiedAdjustments;
  const adjustments = dividends + totals.unclassifiedAdjustments;
  const active = positions.filter((p) => p.dividendEvents + p.unclassifiedAdjustments > 0).length;
  const unknownParts = [
    totals.unclassifiedAdjustments && `${totals.unclassifiedAdjustments} not yet classified`,
    totals.unvaluedDividendEvents && `${totals.unvaluedDividendEvents} the issuer never priced`,
  ].filter(Boolean);
  return (
    <div className="values">
      <div className="value">
        <div className="label">Dividend income</div>
        <div className="amount num">{formatUsd(totals.dividendIncomeUsd)}</div>
        <div className="note">
          {dividends - totals.unvaluedDividendEvents} dividend(s), priced from issuer-published net cash
        </div>
      </div>
      <div className="value">
        <div className="label">Balance adjustments</div>
        <div className="amount num">{adjustments}</div>
        <div className="note">
          Multiplier changes accounted for, across {active} of {positions.length} position(s)
        </div>
      </div>
      <div className="value">
        <div className="label">Held as unknown</div>
        <div className="amount num">{unknown}</div>
        <div className="note">{unknown === 0 ? 'Every change has issuer evidence' : `${unknownParts.join(', ')}. Never guessed.`}</div>
      </div>
    </div>
  );
}

/** The trailing year when it is claimable, else the tracked period (labelled with its span), else the reason neither is. */
function YieldCell({ position, state }: { position: PositionYield | undefined; state: 'loading' | 'unavailable' | 'ready' }) {
  if (state !== 'ready') {
    return (
      <span className="muted" title={state === 'loading' ? 'Loading yield metrics' : 'Yield metrics could not be loaded'}>
        -
      </span>
    );
  }
  const find = (name: PositionYield['windows'][number]['window']) => position?.windows.find((w) => w.window === name);
  const year = find('trailing_365d');
  const tracked = find('tracked');
  if (year?.shareYield != null) return <>{formatPercent(year.shareYield)}</>;
  if (tracked?.shareYield != null) {
    return (
      <>
        {formatPercent(tracked.shareYield)}
        <div className="sub">over {tracked.days} days</div>
      </>
    );
  }
  const reason = (tracked ?? year)?.excluded?.message ?? 'No yield is claimed for this position';
  return (
    <span className="muted" title={reason}>
      Not claimed
    </span>
  );
}

function Positions({ portfolio, yields }: { portfolio: Portfolio; yields: YieldResponse | null | undefined }) {
  const yieldByMint = new Map(yields?.positions.map((p) => [p.mint, p]));
  const yieldState = yields === undefined ? 'loading' : yields === null ? 'unavailable' : 'ready';
  return (
    <section>
      <h2>Positions</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th className="num">Quantity</th>
              <th className="num" title="The quantity no conversion may drop below, so a pending corporate action cannot be sold out from under you.">
                Protected floor
              </th>
              <th className="num">Dividend income</th>
              <th className="num" title={yields?.definitions.shareYield}>Share yield</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((p) => (
              <tr key={p.mint}>
                <td>
                  <strong>{p.symbol}</strong>
                  <div className="mono sub" title={p.mint}>
                    {shortAddress(p.mint)}
                  </div>
                  {p.status !== 'complete' && <div className="sub">Partial history</div>}
                  {!p.reconciled && p.status !== 'unsupported' && <div className="sub">Not reconciled</div>}
                </td>
                <td className="num">{formatQuantity(p.quantity)}</td>
                <td className="num">{p.protectedQuantity === null ? 'n/a' : formatQuantity(p.protectedQuantity)}</td>
                <td className="num">
                  {formatUsd(p.dividendIncomeUsd)}
                  {p.unvaluedDividendEvents > 0 && <div className="sub">+{p.unvaluedDividendEvents} unpriced</div>}
                </td>
                <td className="num">
                  <YieldCell position={yieldByMint.get(p.mint)} state={yieldState} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Events({ owner, entries, onSelect }: { owner: string; entries: IncomeEntry[]; onSelect: (id: string) => void }) {
  return (
    <section>
      <div className="row spread">
        <h2>Balance adjustments</h2>
        <div className="row">
          <a className="button" href={api.exportUrl(owner, 'journal')} title="Every recognition and reversal, for accounting">
            Journal CSV
          </a>
          <a className="button" href={api.exportUrl(owner, 'income')} title="Current income entries with revisions">
            Income CSV
          </a>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="muted">No multiplier changes affected these positions during the covered period.</p>
      ) : (
        <>
          <p className="hint">Select a row for the issuer evidence behind it.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Stock</th>
                  <th>Classification</th>
                  <th className="num">Change</th>
                  <th className="num">USD</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => onSelect(e.id)}>
                    <td>{formatDate(e.effectiveAt)}</td>
                    <td>{e.symbol}</td>
                    <td>
                      <span className={`badge ${KIND_LABEL[e.kind].tone}`}>{KIND_LABEL[e.kind].text}</span>
                      {e.revision > 1 && (
                        <span className="badge caution" title={`Corrected ${formatDateTime(e.correctedAt)}`} style={{ marginLeft: 6 }}>
                          corrected
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {e.kind === 'split' ? `×${formatQuantity(e.splitFactor ?? '')}` : formatQuantity(e.quantityDisplay)}
                    </td>
                    <td className="num">
                      {e.kind !== 'dividend' ? 'n/a' : e.usd === null ? <span className="muted">Unknown</span> : formatUsd(e.usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
