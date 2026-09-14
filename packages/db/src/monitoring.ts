import type { Queryable } from './pool';

export type CheckStatus = 'ok' | 'warn' | 'critical';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  value: number | null;
  threshold: string;
  message: string;
}

export interface MonitoringSnapshot {
  nowUnix: number;
  workers: Array<{ workerId: string; lastSeenUnix: number; mintPollSeconds: number; rpcRequests: number; rpcRetries: number; rpcFailures: number }>;
  lastMintPoll: { polledUnix: number; clockUnix: number; slot: string; mints: number } | null;
  overdueActivations: number;
  pendingOverdueJobs: number;
  failedJobs24h: number;
  unreconciledPositions: number;
  partialPositions: number;
  failedWalletSyncs: number;
  mintsWithTimelineGaps: number;
  issuerFeed: { source: string | null; lastIngestedUnix: number | null };
  /** Independent reconciliation provider, as reported by the freshest worker. */
  providers: { reconciliationHost: string | null; currentDisagreements: number; lastCheckedUnix: number | null };
}

export interface Thresholds {
  heartbeatSeconds: number;
  chainLagSeconds: number;
  stuckJobSeconds: number;
  activationGraceSeconds: number;
  liveIssuerStaleSeconds: number;
  providerCheckStaleSeconds: number;
}

/** PLAN §14 targets: alert above 2 minutes of lag; activations are the case a subscription-only design misses. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  heartbeatSeconds: 120,
  chainLagSeconds: 120,
  stuckJobSeconds: 1800,
  activationGraceSeconds: 300,
  liveIssuerStaleSeconds: 2 * 86_400,
  // Agreeing mint checks are recorded at most hourly.
  providerCheckStaleSeconds: 2 * 3600,
};

export async function collectSnapshot(q: Queryable, t: Thresholds = DEFAULT_THRESHOLDS): Promise<MonitoringSnapshot> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const count = async (sql: string, params: unknown[] = []) => Number((await q.query(sql, params)).rows[0]?.n ?? 0);

  const workers = await q.query(
    `SELECT worker_id, extract(epoch FROM last_seen_at)::bigint AS last_seen, mint_poll_seconds, rpc_requests, rpc_retries, rpc_failures,
            reconciliation_rpc_host
       FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 20`,
  );
  const providerChecks = await q.query(
    `SELECT (SELECT count(*) FROM (SELECT DISTINCT ON (kind, subject) outcome FROM provider_checks ORDER BY kind, subject, id DESC) latest
              WHERE outcome = 'disagree')::int AS disagreements,
            (SELECT extract(epoch FROM max(checked_at))::bigint FROM provider_checks) AS last_checked`,
  );
  const poll = await q.query(`SELECT state FROM sync_cursors WHERE stream = 'mint-poll'`);
  const positions = await q.query(
    `SELECT count(*) FILTER (WHERE replay_complete AND NOT reconciled)::int AS unreconciled,
            count(*) FILTER (WHERE status = 'partial')::int AS partial
       FROM position_epochs`,
  );
  const issuer = await q.query(`SELECT source, extract(epoch FROM ingested_at)::bigint AS at FROM corporate_actions ORDER BY ingested_at DESC LIMIT 1`);
  const pollState = poll.rows[0]?.state as { polledUnix?: number; clockUnix?: number; slot?: string; mints?: number } | undefined;

  return {
    nowUnix,
    workers: workers.rows.map((r) => ({
      workerId: r.worker_id,
      lastSeenUnix: Number(r.last_seen),
      mintPollSeconds: r.mint_poll_seconds,
      rpcRequests: Number(r.rpc_requests),
      rpcRetries: Number(r.rpc_retries),
      rpcFailures: Number(r.rpc_failures),
    })),
    lastMintPoll:
      pollState?.polledUnix !== undefined && pollState.clockUnix !== undefined
        ? { polledUnix: pollState.polledUnix, clockUnix: pollState.clockUnix, slot: pollState.slot ?? '', mints: pollState.mints ?? 0 }
        : null,
    overdueActivations: await count(
      `SELECT count(*)::int AS n FROM multiplier_versions WHERE status = 'scheduled' AND effective_unix < $1`,
      [nowUnix - t.activationGraceSeconds],
    ),
    pendingOverdueJobs: await count(
      `SELECT count(*)::int AS n FROM jobs_outbox WHERE status = 'pending' AND run_after < now() - make_interval(secs => $1)`,
      [t.stuckJobSeconds],
    ),
    failedJobs24h: await count(`SELECT count(*)::int AS n FROM jobs_outbox WHERE status = 'failed' AND updated_at > now() - interval '24 hours'`),
    unreconciledPositions: Number(positions.rows[0]?.unreconciled ?? 0),
    partialPositions: Number(positions.rows[0]?.partial ?? 0),
    failedWalletSyncs: await count(`SELECT count(*)::int AS n FROM wallet_syncs WHERE status = 'failed'`),
    mintsWithTimelineGaps: await count(
      `SELECT count(*)::int AS n FROM sync_cursors WHERE stream LIKE 'multiplier-timeline:%' AND jsonb_array_length(gaps) > 0`,
    ),
    issuerFeed: { source: issuer.rows[0]?.source ?? null, lastIngestedUnix: issuer.rows[0] ? Number(issuer.rows[0].at) : null },
    providers: {
      reconciliationHost: workers.rows[0]?.reconciliation_rpc_host ?? null,
      currentDisagreements: Number(providerChecks.rows[0]?.disagreements ?? 0),
      lastCheckedUnix: providerChecks.rows[0]?.last_checked == null ? null : Number(providerChecks.rows[0].last_checked),
    },
  };
}

const RANK: Record<CheckStatus, number> = { ok: 0, warn: 1, critical: 2 };

/** Grades a snapshot. Pure, so thresholds and messages are unit-tested. */
export function evaluateChecks(s: MonitoringSnapshot, t: Thresholds = DEFAULT_THRESHOLDS): { status: CheckStatus; checks: CheckResult[] } {
  const checks: CheckResult[] = [];
  const add = (name: string, status: CheckStatus, value: number | null, threshold: string, message: string) =>
    checks.push({ name, status, value, threshold, message });

  const freshest = s.workers[0];
  const heartbeatAge = freshest ? s.nowUnix - freshest.lastSeenUnix : null;
  if (heartbeatAge === null) add('worker_heartbeat', 'critical', null, `≤ ${t.heartbeatSeconds}s`, 'No worker has ever reported a heartbeat');
  else if (heartbeatAge > t.heartbeatSeconds) {
    add('worker_heartbeat', 'critical', heartbeatAge, `≤ ${t.heartbeatSeconds}s`, `Freshest worker (${freshest!.workerId}) last seen ${heartbeatAge}s ago`);
  } else add('worker_heartbeat', 'ok', heartbeatAge, `≤ ${t.heartbeatSeconds}s`, `Worker ${freshest!.workerId} seen ${heartbeatAge}s ago`);

  const pollLimit = Math.max(180, 3 * (freshest?.mintPollSeconds ?? 45));
  if (!s.lastMintPoll) add('mint_poll_freshness', 'warn', null, `≤ ${pollLimit}s`, 'Mint state has never been polled');
  else {
    const age = s.nowUnix - s.lastMintPoll.polledUnix;
    add(
      'mint_poll_freshness',
      age > pollLimit ? 'critical' : 'ok',
      age,
      `≤ ${pollLimit}s`,
      age > pollLimit ? `Mint state last polled ${age}s ago; scheduled activations may go unnoticed` : `Polled ${s.lastMintPoll.mints} tracked mint(s) ${age}s ago`,
    );
    const lag = s.lastMintPoll.polledUnix - s.lastMintPoll.clockUnix;
    add(
      'chain_clock_lag',
      lag > t.chainLagSeconds ? 'critical' : 'ok',
      lag,
      `≤ ${t.chainLagSeconds}s`,
      lag > t.chainLagSeconds ? `Finalized chain clock was ${lag}s behind at the last poll; the RPC provider is stale` : `Finalized clock ${lag}s behind wall time`,
    );
  }

  add(
    'overdue_activations',
    s.overdueActivations > 0 ? 'critical' : 'ok',
    s.overdueActivations,
    `0 unsettled ${t.activationGraceSeconds}s past schedule`,
    s.overdueActivations > 0
      ? `${s.overdueActivations} scheduled multiplier activation(s) are past due and not settled; income for them is not published`
      : 'Every scheduled activation has settled',
  );
  add(
    'job_queue_draining',
    s.pendingOverdueJobs > 0 ? 'critical' : 'ok',
    s.pendingOverdueJobs,
    `0 pending > ${t.stuckJobSeconds}s`,
    s.pendingOverdueJobs > 0 ? `${s.pendingOverdueJobs} job(s) have waited over ${t.stuckJobSeconds}s` : 'Queue is draining',
  );
  add('failed_jobs_24h', s.failedJobs24h > 0 ? 'warn' : 'ok', s.failedJobs24h, '0', `${s.failedJobs24h} job(s) exhausted their retries in 24h`);
  add(
    'balance_reconciliation',
    s.unreconciledPositions > 0 ? 'critical' : 'ok',
    s.unreconciledPositions,
    '0 mismatches',
    s.unreconciledPositions > 0
      ? `${s.unreconciledPositions} fully replayed position(s) do not match chain balances; conversion is disabled for them`
      : 'Every fully replayed position matches chain balances exactly',
  );
  add('partial_positions', 'ok', s.partialPositions, 'informational', `${s.partialPositions} position(s) have partial coverage (shown to users)`);
  add('failed_wallet_syncs', s.failedWalletSyncs > 0 ? 'warn' : 'ok', s.failedWalletSyncs, '0', `${s.failedWalletSyncs} wallet sync(s) failed`);
  add(
    'timeline_gaps',
    s.mintsWithTimelineGaps > 0 ? 'warn' : 'ok',
    s.mintsWithTimelineGaps,
    '0',
    `${s.mintsWithTimelineGaps} mint(s) have gaps in their multiplier history`,
  );

  const { reconciliationHost, currentDisagreements, lastCheckedUnix } = s.providers;
  if (currentDisagreements > 0) {
    add(
      'provider_agreement',
      'critical',
      currentDisagreements,
      '0 disagreements',
      `${currentDisagreements} balance or mint-state check(s) currently disagree with the independent provider; conversion is disabled for affected positions`,
    );
  } else if (reconciliationHost === null) {
    add('provider_agreement', 'warn', null, 'independent RPC configured', 'No independent reconciliation RPC is configured (RECONCILIATION_RPC_URL); chain data comes from one provider');
  } else {
    const age = lastCheckedUnix === null ? null : s.nowUnix - lastCheckedUnix;
    const stale = age === null || age > t.providerCheckStaleSeconds;
    add(
      'provider_agreement',
      stale ? 'warn' : 'ok',
      age,
      `≤ ${t.providerCheckStaleSeconds}s`,
      stale ? `No cross-check against ${reconciliationHost} for ${age ?? 'ever'}s` : `Agrees with ${reconciliationHost}; last checked ${age}s ago`,
    );
  }

  const { source, lastIngestedUnix } = s.issuerFeed;
  if (source === null) add('issuer_feed', 'warn', null, 'loaded', 'No issuer corporate actions are loaded; transitions cannot be classified');
  else if (source === 'fixtures') {
    add('issuer_feed', 'ok', null, 'fixtures by design', 'Recorded fixtures (no live issuer feed while data rights are unresolved)');
  } else {
    const age = lastIngestedUnix === null ? null : s.nowUnix - lastIngestedUnix;
    const stale = age === null || age > t.liveIssuerStaleSeconds;
    add('issuer_feed', stale ? 'warn' : 'ok', age, `≤ ${t.liveIssuerStaleSeconds}s`, stale ? `Live issuer data last ingested ${age ?? 'never'}s ago` : 'Live issuer data is current');
  }

  const status = checks.reduce<CheckStatus>((worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst), 'ok');
  return { status, checks };
}

/** Prometheus text exposition (format 0.0.4). */
export function toPrometheus(s: MonitoringSnapshot, result: { checks: CheckResult[] }): string {
  const lines: string[] = [];
  const family = (name: string, type: 'gauge' | 'counter', help: string, samples: Array<[string, number]>) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) lines.push(`${name}${labels} ${value}`);
  };
  const label = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

  family('corpact_check_status', 'gauge', 'Check status: 0 ok, 1 warn, 2 critical', result.checks.map((c) => [`{check="${label(c.name)}"}`, RANK[c.status]]));
  family('corpact_worker_heartbeat_age_seconds', 'gauge', 'Seconds since each worker last reported', s.workers.map((w) => [`{worker="${label(w.workerId)}"}`, s.nowUnix - w.lastSeenUnix]));
  family('corpact_rpc_requests_total', 'counter', 'RPC requests attempted by each worker process', s.workers.map((w) => [`{worker="${label(w.workerId)}"}`, w.rpcRequests]));
  family('corpact_rpc_retries_total', 'counter', 'RPC retries by each worker process', s.workers.map((w) => [`{worker="${label(w.workerId)}"}`, w.rpcRetries]));
  family('corpact_rpc_failures_total', 'counter', 'RPC calls that exhausted retries', s.workers.map((w) => [`{worker="${label(w.workerId)}"}`, w.rpcFailures]));
  if (s.lastMintPoll) {
    family('corpact_mint_poll_age_seconds', 'gauge', 'Seconds since mint state was last polled', [['', s.nowUnix - s.lastMintPoll.polledUnix]]);
    family('corpact_chain_clock_lag_seconds', 'gauge', 'Finalized chain clock lag at the last poll', [['', s.lastMintPoll.polledUnix - s.lastMintPoll.clockUnix]]);
  }
  family('corpact_activations_overdue', 'gauge', 'Scheduled multiplier activations past due and unsettled', [['', s.overdueActivations]]);
  family('corpact_jobs_pending_overdue', 'gauge', 'Pending jobs waiting beyond the stuck threshold', [['', s.pendingOverdueJobs]]);
  family('corpact_jobs_failed_24h', 'gauge', 'Jobs that exhausted retries in the last 24 hours', [['', s.failedJobs24h]]);
  family('corpact_positions_unreconciled', 'gauge', 'Fully replayed positions not matching chain balances', [['', s.unreconciledPositions]]);
  family('corpact_positions_partial', 'gauge', 'Positions with partial coverage', [['', s.partialPositions]]);
  family('corpact_provider_disagreements', 'gauge', 'Subjects whose latest independent-provider check disagrees', [['', s.providers.currentDisagreements]]);
  return `${lines.join('\n')}\n`;
}
