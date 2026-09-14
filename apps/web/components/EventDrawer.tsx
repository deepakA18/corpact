'use client';

import { useEffect, useState } from 'react';
import { api, type IncomeDetail } from '../lib/api';
import { formatDateTime, formatQuantity, formatUsd, truncateDecimal } from '../lib/format';

const REASON_LABEL: Record<string, string> = {
  initial: 'First recognized',
  issuer_correction: 'Issuer correction',
  balance_history_changed: 'Balance history changed',
  valuation_changed: 'Valuation changed',
  no_longer_applicable: 'No longer applicable',
};

export function EventDrawer({ owner, id, onClose }: { owner: string; id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<IncomeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.incomeDetail(owner, id).then(
      (d) => !cancelled && setDetail(d),
      (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
    };
  }, [owner, id, onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer stack" role="dialog" aria-label="Event evidence" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <strong>Event evidence</strong>
          <button onClick={onClose}>Close</button>
        </div>
        {error && <p className="error">{error}</p>}
        {!detail && !error && <p className="muted">Loading…</p>}
        {detail && <Evidence detail={detail} />}
      </aside>
    </div>
  );
}

function Evidence({ detail }: { detail: IncomeDetail }) {
  const { chain, classification, issuerRecord } = detail.evidence;
  const notes = [...detail.warnings, ...detail.reasons];
  return (
    <>
      <p>{detail.headline}</p>
      {notes.length > 0 && (
        <ul className="gaps">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h2>On chain</h2>
      <dl className="evidence">
        <dt>Effective</dt>
        <dd>
          {formatDateTime(chain.effectiveAt)}
          {chain.immediate && <span className="muted"> (applied at publication; scheduled {formatDateTime(chain.scheduledAt)})</span>}
        </dd>
        <dt>Multiplier before</dt>
        <dd className="mono">{chain.multiplierBefore.exact ?? 'not observed'}</dd>
        <dt>Multiplier after</dt>
        <dd className="mono">{chain.multiplierAfter.exact}</dd>
        <dt>Written by</dt>
        <dd className="mono">
          <a href={chain.explorerUrl} target="_blank" rel="noreferrer">
            {chain.updateSignature}
          </a>
          <div className="muted">
            slot {chain.observedSlot}, instruction {chain.instructionPath.join('.')}
          </div>
        </dd>
        <dt>Timeline status</dt>
        <dd>{chain.status}</dd>
      </dl>

      <h2>Classification</h2>
      <dl className="evidence">
        <dt>Result</dt>
        <dd>{classification.result}</dd>
        {classification.classifierVersion && (
          <>
            <dt>Classifier</dt>
            <dd className="mono">{classification.classifierVersion}</dd>
          </>
        )}
        {classification.issuerEventId && (
          <>
            <dt>Issuer action</dt>
            <dd className="mono">
              {classification.issuerEventId} (revision {classification.issuerRevision})
            </dd>
          </>
        )}
        {classification.netCashPerShare && (
          <>
            <dt>Net cash / share</dt>
            <dd className="mono">${classification.netCashPerShare}</dd>
          </>
        )}
      </dl>

      <h2>History</h2>
      {detail.revision > 1 && (
        <p className="muted">
          Corrected {detail.revision - 1} time(s), most recently {formatDateTime(detail.correctedAt)}. Earlier recognitions are reversed, not
          erased.
        </p>
      )}
      {detail.history.length === 0 ? (
        <p className="muted">Not yet recorded in the ledger journal.</p>
      ) : (
        <ul className="gaps">
          {detail.history.map((h) => (
            <li key={h.id}>
              <strong>{h.entryType === 'reversal' ? 'Reversed' : 'Recognized'}</strong> {formatDateTime(h.recordedAt)}: {REASON_LABEL[h.changeReason]}
              {': '}
              {h.kind.replace('_', ' ')} {formatQuantity(truncateDecimal(h.quantity, 8))} units
              {h.usd !== null ? `, ${formatUsd(h.usd)}` : ''}
              {h.changeDetail && <div className="muted">{h.changeDetail}</div>}
            </li>
          ))}
        </ul>
      )}

      {issuerRecord && (
        <details>
          <summary>Issuer record ({issuerRecord.source === 'fixtures' ? 'recorded fixture' : 'live API'})</summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(issuerRecord.record, null, 2)}
          </pre>
          <div className="mono muted">sha256 {issuerRecord.evidenceSha256}</div>
        </details>
      )}
    </>
  );
}
