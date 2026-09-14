import { createHash } from 'node:crypto';
import type { Queryable } from './pool';

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

export interface ObservationInput {
  kind: 'transaction' | 'mint_state' | 'token_accounts';
  signature?: string;
  subject?: string;
  slot: bigint;
  blockTimeUnix?: bigint | null;
  /** JSON-safe payload (bigints already stringified). */
  payload: unknown;
}

/**
 * Store a raw provider payload immutably and return its id. Re-observing the same
 * (kind, signature, subject, slot) returns the existing row; a different payload for
 * the same key is a provider disagreement and is refused.
 */
export async function insertObservation(q: Queryable, o: ObservationInput): Promise<string> {
  const text = JSON.stringify(o.payload);
  const hash = sha256Hex(text);
  const { rows } = await q.query(
    `WITH inserted AS (
       INSERT INTO chain_observations (kind, signature, subject, slot, block_time_unix, payload, payload_sha256, stored_payload_sha256)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, encode(sha256(convert_to($6::jsonb::text, 'UTF8')), 'hex'))
       ON CONFLICT (kind, signature, subject, slot) DO NOTHING
       RETURNING id, payload_sha256)
     SELECT id, payload_sha256 FROM inserted
     UNION ALL
     SELECT id, payload_sha256 FROM chain_observations
      WHERE kind = $1 AND signature = $2 AND subject = $3 AND slot = $4
        AND NOT EXISTS (SELECT 1 FROM inserted)`,
    [o.kind, o.signature ?? '', o.subject ?? '', o.slot.toString(), o.blockTimeUnix?.toString() ?? null, text, hash],
  );
  const row = rows[0];
  if (!row) throw new Error(`Observation ${o.kind}:${o.signature ?? ''}:${o.subject ?? ''}@${o.slot} was neither inserted nor found`);
  if (row.payload_sha256 !== hash) {
    throw new Error(`Provider disagreement: ${o.kind} ${o.signature ?? o.subject} at slot ${o.slot} differs from the stored observation`);
  }
  return String(row.id);
}
