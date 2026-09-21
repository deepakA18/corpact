'use client';

import { useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { Icon } from '@/components/Icon';
import { DEMO_API_KEY, DEMO_API_URL, DEMO_REQUESTS, curlFor } from '@/lib/demo-api';

/** Responses can be long; enough to show the shape without freezing the page. */
const MAX_CHARS = 6000;

interface Result {
  status: number;
  ms: number;
  body: string;
  truncated: boolean;
  /** The wallet has no rows yet, because its first sync is still backfilling archival history. */
  syncing: boolean;
}

/** A wallet response is empty while its first sync runs; say so instead of showing a bare empty list. */
function stillSyncing(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const body = parsed as { actions?: unknown[]; entries?: unknown[]; positions?: unknown[]; dataStatus?: { status?: string } | null };
  const lists = [body.actions, body.entries, body.positions].filter(Array.isArray);
  const empty = lists.length > 0 && lists.every((list) => list.length === 0);
  return empty || body.dataStatus?.status === 'running' || body.dataStatus?.status === 'queued';
}

export function TryIt() {
  const [selected, setSelected] = useState(DEMO_REQUESTS[0]!);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const choose = (id: string) => {
    setSelected(DEMO_REQUESTS.find((r) => r.id === id)!);
    setResult(null);
    setError(null);
  };

  async function run() {
    setRunning(true);
    setError(null);
    const started = performance.now();
    try {
      const response = await fetch(`${DEMO_API_URL}${selected.path}`, {
        headers: selected.path === '/v1/health' ? {} : { authorization: `Bearer ${DEMO_API_KEY}` },
      });
      const text = await response.text();
      let body = text;
      let syncing = false;
      try {
        const parsed: unknown = JSON.parse(text);
        body = JSON.stringify(parsed, null, 2);
        syncing = response.ok && stillSyncing(parsed);
      } catch {
        // Not JSON (an export, or an error page): show it as it came back.
      }
      setResult({
        status: response.status,
        ms: Math.round(performance.now() - started),
        body: body.slice(0, MAX_CHARS),
        truncated: body.length > MAX_CHARS,
        syncing,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed');
    } finally {
      setRunning(false);
    }
  }

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curlFor(selected));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="tryit">
      <div className="tryit-tabs" role="tablist" aria-label="Demo requests">
        {DEMO_REQUESTS.map((request) => (
          <button
            key={request.id}
            role="tab"
            type="button"
            aria-selected={request.id === selected.id}
            className={request.id === selected.id ? 'active' : ''}
            onClick={() => choose(request.id)}
          >
            {request.label}
          </button>
        ))}
      </div>

      <p className="tryit-summary">{selected.summary}</p>

      <div className="tryit-request">
        <span className="method get">{selected.method}</span>
        <code>{selected.path}</code>
        <button type="button" className="tryit-copy" onClick={copyCurl}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'Copied' : 'Copy as curl'}
        </button>
        <button type="button" className="btn btn-accent btn-sm" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* The previous response stays on screen while the next one is in flight, so say which state the panel is in. */}
      {running && (
        <div className="tryit-running">
          <ThinkingOrb state="working" size={20} aria-label="Waiting for the demo API" />
          <span>Waiting for the demo API…</span>
        </div>
      )}

      {(result || error) && (
        <div className="tryit-result">
          <div className="tryit-status">
            {error ? (
              <span className="bad">Request failed</span>
            ) : (
              <>
                <span className={result!.status < 300 ? 'ok' : 'bad'}>{result!.status}</span>
                <span className="tryit-ms">{result!.ms} ms</span>
                {result!.truncated && <span className="tryit-ms">response truncated</span>}
              </>
            )}
          </div>
          {result?.syncing && (
            <div className="tryit-note">
              <ThinkingOrb state="searching" size={64} aria-label="Replaying archival history" />
              <p>
                This wallet’s first sync is still running: Corpact replays its whole archival history before it reports anything, so the list is empty until
                that finishes. Try <strong>Taxonomy</strong> or <strong>Assets</strong> meanwhile, both of which return data now.
              </p>
            </div>
          )}
          <pre>{error ?? result!.body}</pre>
        </div>
      )}
    </div>
  );
}
