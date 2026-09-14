import type { Queryable } from './pool';

/** What a ledger database holds. Unlabelled databases hold real mainnet chain history. */
export type Dataset = { kind: 'mainnet'; description: null } | { kind: 'synthetic'; description: string };

export async function readDataset(q: Queryable): Promise<Dataset> {
  const { rows } = await q.query('SELECT description FROM dataset_label');
  return rows[0] ? { kind: 'synthetic', description: rows[0].description as string } : { kind: 'mainnet', description: null };
}

/** Permanently mark a database as synthetic. Idempotent; there is no way back. */
export async function labelSynthetic(q: Queryable, description: string): Promise<void> {
  await q.query(`INSERT INTO dataset_label (kind, description) VALUES ('synthetic', $1) ON CONFLICT DO NOTHING`, [description]);
}
