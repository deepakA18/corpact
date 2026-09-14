'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CorpactApiError, api, type IncomeEntry, type Portfolio, type SyncStatus } from '../lib/api';
import { formatDate, formatDateTime, formatQuantity, formatUsd, shortAddress } from '../lib/format';
import { EventDrawer } from './EventDrawer';

const ACTIVE: ReadonlyArray<SyncStatus['status']> = ['queued', 'running'];
/** A job queued this long without being claimed almost always means no worker is running. */
const WORKER_STALL_MS = 20_000;

const isUnregistered = (err: unknown) =>
  err instanceof CorpactApiError && err.status === 404 && (err.body as { code?: string } | null)?.code === 'wallet_not_registered';

const KIND_LABEL: Record<IncomeEntry['kind'], { text: string; tone: string }> = {
  dividend: { text: 'Verified dividend', tone: 'verified' },
  split: { text: 'Stock split', tone: '' },
  unclassified_adjustment: { text: 'Classification pending', tone: 'caution' },
};

export function Dashboard({ owner }: { owner: string }) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([api.portfolio(owner), api.income(owner)]);
      setPortfolio(p);
      setEntries(i.entries);
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRequesting(false);
    }
  };

  const syncing = sync !== null && ACTIVE.includes(sync.status);
  const hasData = portfolio !== null && portfolio.positions.length > 0;

  return (
    <div className="stack">
      <div className="row spread">
        <div>
          <Link href="/" className="muted">
            ← Back
          </Link>
          <h1>Wallet ledger</h1>
          <div className="muted">Corpact demo</div>
          <div className="mono muted" title={owner}>
            {owner}
          </div>
        </div>
        <button className="primary" onClick={() => void requestSync()} disabled={syncing || requesting}>
          {syncing ? 'Syncing…' : hasData ? 'Refresh history' : 'Sync on-chain history'}
        </button>
      </div>

      {error && <p className="error">Could not load the ledger: {error}</p>}
      <SyncBanner sync={sync} />

      {portfolio && !hasData && !syncing && (sync?.status === 'complete' || sync?.status === 'partial') && (
        <div className="banner">
          <strong>No xStock positions found</strong>
          <span className="muted">
            Checked {sync.transactionsFetched} transaction(s) of this wallet&apos;s history as of {formatDateTime(sync.asOfTime)}: it has never held a
            supported xStock directly. Holdings inside lending protocols, pools or exchanges are not tracked.
          </span>
        </div>
      )}
      {notRegistered && !syncing && (
        <div className="banner">
          <strong>Not synced yet</strong>
          <span className="muted">Sync this address to register it with the ledger and reconstruct its xStock holdings from chain history.</span>
        </div>
      )}

      {portfolio && hasData && (
        <>
          <CoverageBanner portfolio={portfolio} />
          <PrimaryValues portfolio={portfolio} />
          <Positions portfolio={portfolio} />
          <Events entries={entries} onSelect={setSelected} />
        </>
      )}

      {selected && <EventDrawer owner={owner} id={selected} onClose={() => setSelected(null)} />}
    </div>
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
    return (
      <div className="banner">
        <strong>{sync.status === 'queued' ? 'Sync queued' : 'Reading on-chain history'}</strong>
        <span className="muted">
          {phase ?? 'Starting'}
          {done !== undefined && total !== undefined ? ` — ${done} of ${total}` : ''}
        </span>
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

function CoverageBanner({ portfolio }: { portfolio: Portfolio }) {
  const { coverage } = portfolio;
  const gaps = [...new Set(portfolio.positions.flatMap((p) => p.coverage.gaps.map((g) => `${p.symbol}: ${g}`)))];
  return (
    <div className={`banner ${coverage.complete ? '' : 'partial'}`}>
      <strong>Tracking since {formatDate(coverage.trackingStart)}</strong>
      <span className="muted">
        {coverage.complete
          ? 'Every position is reconstructed from its first on-chain movement and reconciles exactly with current balances.'
          : `${coverage.partialPositions} partial and ${coverage.unsupportedPositions} unsupported position(s). Income outside the covered periods is not attributed — it is not counted as zero.`}{' '}
        As of slot {portfolio.asOfSlot ?? '—'} ({formatDateTime(portfolio.asOfTime)}).
      </span>
      {gaps.length > 0 && (
        <details>
          <summary>{gaps.length} coverage note(s)</summary>
          <ul className="gaps">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PrimaryValues({ portfolio }: { portfolio: Portfolio }) {
  const { totals } = portfolio;
  return (
    <div className="values">
      <div className="value">
        <div className="label">Dividend income</div>
        <div className="amount num">{formatUsd(totals.dividendIncomeUsd)}</div>
        <div className="note">
          From issuer-reported net cash.
          {totals.unvaluedDividendEvents > 0 && ` Plus ${totals.unvaluedDividendEvents} dividend(s) with no USD value.`}
        </div>
      </div>
      <div className="value">
        <div className="label">Available to convert</div>
        <div className="amount num">{totals.availableToConvert.positionsWithAvailable} position(s)</div>
        <div className="note">Shown per position in stock units. {totals.availableToConvert.reason}.</div>
      </div>
      <div className="value">
        <div className="label">USDC received</div>
        <div className="amount num">{formatUsd(totals.usdcReceived.usd)}</div>
        <div className="note">{totals.usdcReceived.reason}.</div>
      </div>
      <div className="value">
        <div className="label">Tracking start</div>
        <div className="amount">{formatDate(portfolio.coverage.trackingStart)}</div>
        <div className="note">{portfolio.coverage.complete ? 'Complete coverage' : 'Partial coverage — see notes above'}</div>
      </div>
    </div>
  );
}

function Positions({ portfolio }: { portfolio: Portfolio }) {
  return (
    <section>
      <h2>Positions</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th>Quantity</th>
              <th>Protected</th>
              <th>Available to convert</th>
              <th>Dividend income</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.positions.map((p) => (
              <tr key={p.mint}>
                <td>
                  <strong>{p.symbol}</strong>
                  <div className="mono muted" title={p.mint}>
                    {shortAddress(p.mint)}
                  </div>
                </td>
                <td className="num">{formatQuantity(p.quantity)}</td>
                <td className="num">{p.protectedQuantity === null ? '—' : formatQuantity(p.protectedQuantity)}</td>
                <td className="num">
                  {p.availableQuantity === null ? (
                    <span className="muted">Unavailable</span>
                  ) : (
                    formatQuantity(p.availableQuantity)
                  )}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.conversionDisabledReasons[0]}
                  </div>
                </td>
                <td className="num">
                  {formatUsd(p.dividendIncomeUsd)}
                  {p.unvaluedDividendEvents > 0 && <div className="muted">+{p.unvaluedDividendEvents} unvalued</div>}
                </td>
                <td>
                  <span className={`badge ${p.status === 'complete' ? 'verified' : 'caution'}`}>{p.status}</span>
                  {!p.reconciled && p.status !== 'unsupported' && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Not reconciled
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Events({ entries, onSelect }: { entries: IncomeEntry[]; onSelect: (id: string) => void }) {
  return (
    <section>
      <h2>Balance adjustments</h2>
      {entries.length === 0 ? (
        <p className="muted">No multiplier changes affected these positions during the covered period.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Stock</th>
                <th>Classification</th>
                <th>Units</th>
                <th>USD</th>
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
                  <td className="num">{e.kind !== 'dividend' ? '—' : e.usd === null ? <span className="muted">Unknown</span> : formatUsd(e.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
