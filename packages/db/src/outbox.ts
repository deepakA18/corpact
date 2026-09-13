import type { Db, Queryable } from './pool';

export interface JobInput {
  kind: string;
  /** Deduplicates pending work: a second pending job with the same key is not created. */
  businessKey: string;
  payload?: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  businessKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Enqueue inside the caller's transaction, so the job exists if and only if the ledger write committed. */
export async function enqueueJob(q: Queryable, job: JobInput): Promise<'enqueued' | 'already_pending'> {
  const { rowCount } = await q.query(
    `INSERT INTO jobs_outbox (kind, business_key, payload, run_after, max_attempts)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_key) WHERE status = 'pending' DO NOTHING`,
    [job.kind, job.businessKey, JSON.stringify(job.payload ?? {}), job.runAfter ?? new Date(), job.maxAttempts ?? 5],
  );
  return rowCount ? 'enqueued' : 'already_pending';
}

/** Lease one ready job, or reclaim one whose lease expired. */
export async function claimJob(db: Db, workerId: string, leaseMs: number): Promise<ClaimedJob | null> {
  const { rows } = await db.query(
    `UPDATE jobs_outbox
        SET status = 'running', attempts = attempts + 1, lease_owner = $1,
            lease_expires_at = now() + make_interval(secs => $2::double precision / 1000), updated_at = now()
      WHERE id = (
        SELECT id FROM jobs_outbox
         WHERE (status = 'pending' AND run_after <= now())
            OR (status = 'running' AND lease_expires_at < now())
         ORDER BY run_after, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
     RETURNING id, kind, business_key, payload, attempts, max_attempts`,
    [workerId, leaseMs],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind,
    businessKey: row.business_key,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function completeJob(db: Db, job: ClaimedJob, workerId: string): Promise<void> {
  await db.query(`UPDATE jobs_outbox SET status = 'done', updated_at = now() WHERE id = $1 AND lease_owner = $2`, [job.id, workerId]);
}

/** Retry with exponential backoff until the attempt budget is spent, then park as failed with the error kept. */
export async function failJob(db: Db, job: ClaimedJob, workerId: string, error: unknown): Promise<'retrying' | 'failed'> {
  const exhausted = job.attempts >= job.maxAttempts;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await db.query(
    `UPDATE jobs_outbox
        SET status = $3, last_error = $4, lease_owner = NULL, lease_expires_at = NULL,
            run_after = now() + make_interval(secs => $5), updated_at = now()
      WHERE id = $1 AND lease_owner = $2`,
    [job.id, workerId, exhausted ? 'failed' : 'pending', message.slice(0, 4000), Math.min(3600, 5 * 2 ** job.attempts)],
  );
  return exhausted ? 'failed' : 'retrying';
}
