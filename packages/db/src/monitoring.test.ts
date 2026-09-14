import { describe, expect, it } from 'vitest';
import { evaluateChecks, toPrometheus, type MonitoringSnapshot } from './monitoring';

const NOW = 1_789_400_000;
const healthy = (overrides: Partial<MonitoringSnapshot> = {}): MonitoringSnapshot => ({
  nowUnix: NOW,
  workers: [{ workerId: 'w1', lastSeenUnix: NOW - 10, mintPollSeconds: 45, rpcRequests: 120, rpcRetries: 3, rpcFailures: 0 }],
  lastMintPoll: { polledUnix: NOW - 30, clockUnix: NOW - 35, slot: '446800000', mints: 5 },
  overdueActivations: 0,
  pendingOverdueJobs: 0,
  failedJobs24h: 0,
  unreconciledPositions: 0,
  partialPositions: 2,
  failedWalletSyncs: 0,
  mintsWithTimelineGaps: 0,
  issuerFeed: { source: 'fixtures', lastIngestedUnix: NOW - 86_400 },
  ...overrides,
});

const statusOf = (s: MonitoringSnapshot, name: string) => evaluateChecks(s).checks.find((c) => c.name === name)?.status;

describe('evaluateChecks', () => {
  it('is ok for a healthy system, and partial coverage alone is informational', () => {
    expect(evaluateChecks(healthy()).status).toBe('ok');
  });

  it('is critical when no worker is alive or the last heartbeat is stale', () => {
    expect(statusOf(healthy({ workers: [] }), 'worker_heartbeat')).toBe('critical');
    const stale = healthy({ workers: [{ workerId: 'w1', lastSeenUnix: NOW - 500, mintPollSeconds: 45, rpcRequests: 0, rpcRetries: 0, rpcFailures: 0 }] });
    expect(evaluateChecks(stale).status).toBe('critical');
  });

  it('flags a stale poll and a lagging finalized clock separately', () => {
    expect(statusOf(healthy({ lastMintPoll: null }), 'mint_poll_freshness')).toBe('warn');
    expect(statusOf(healthy({ lastMintPoll: { polledUnix: NOW - 600, clockUnix: NOW - 601, slot: '1', mints: 1 } }), 'mint_poll_freshness')).toBe('critical');
    expect(statusOf(healthy({ lastMintPoll: { polledUnix: NOW - 10, clockUnix: NOW - 400, slot: '1', mints: 1 } }), 'chain_clock_lag')).toBe('critical');
  });

  it('treats unsettled activations and reconciliation mismatches as critical', () => {
    expect(statusOf(healthy({ overdueActivations: 1 }), 'overdue_activations')).toBe('critical');
    const mismatch = evaluateChecks(healthy({ unreconciledPositions: 2 })).checks.find((c) => c.name === 'balance_reconciliation');
    expect(mismatch).toMatchObject({ status: 'critical', value: 2 });
    expect(mismatch?.message).toMatch(/conversion is disabled/);
  });

  it('warns on failures that need attention but do not stop the ledger', () => {
    const s = healthy({ failedJobs24h: 1, failedWalletSyncs: 1, mintsWithTimelineGaps: 3 });
    expect(evaluateChecks(s).status).toBe('warn');
  });

  it('accepts recorded fixtures by design but warns on a stale live issuer feed', () => {
    expect(statusOf(healthy(), 'issuer_feed')).toBe('ok');
    expect(statusOf(healthy({ issuerFeed: { source: 'live', lastIngestedUnix: NOW - 5 * 86_400 } }), 'issuer_feed')).toBe('warn');
    expect(statusOf(healthy({ issuerFeed: { source: null, lastIngestedUnix: null } }), 'issuer_feed')).toBe('warn');
  });
});

describe('toPrometheus', () => {
  it('emits typed metric families with check severities and worker counters', () => {
    const s = healthy({ overdueActivations: 1 });
    const text = toPrometheus(s, evaluateChecks(s));
    expect(text).toContain('# TYPE corpact_check_status gauge');
    expect(text).toContain('corpact_check_status{check="overdue_activations"} 2');
    expect(text).toContain('corpact_check_status{check="worker_heartbeat"} 0');
    expect(text).toContain('corpact_rpc_requests_total{worker="w1"} 120');
    expect(text).toContain('corpact_chain_clock_lag_seconds 5');
    expect(text.endsWith('\n')).toBe(true);
  });
});
