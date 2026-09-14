import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Queryable } from './pool';

export interface IntegrityResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** Evidence and journal tables whose rows may only be inserted. */
export const APPEND_ONLY_TABLES = [
  'chain_observations',
  'multiplier_writes',
  'corporate_actions',
  'balance_movements',
  'ledger_journal',
  'provider_checks',
  'instrument_identities',
  'lineage_links',
  'lineage_successors',
] as const;

const STORED_HASH = `encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')`;
const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

/**
 * Checks a ledger database can be trusted as a copy of the original: after a restore, before
 * pointing an API at it, or on a schedule. Reads only. Output names mints and counts, never wallets.
 */
export async function verifyIntegrity(q: Queryable): Promise<IntegrityResult[]> {
  const results: IntegrityResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let applied: string[] = [];
  try {
    applied = (await q.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name as string);
  } catch {
    add('migrations', false, 'schema_migrations is missing; this is not a migrated Corpact database');
    return results;
  }
  const missing = files.filter((f) => !applied.includes(f));
  const unknown = applied.filter((a) => !files.includes(a));
  add(
    'migrations',
    missing.length === 0 && unknown.length === 0,
    missing.length || unknown.length
      ? `missing: ${missing.join(', ') || 'none'}; not in this code: ${unknown.join(', ') || 'none'}`
      : `${applied.length} applied, matching this code`,
  );

  const { rows: triggers } = await q.query(
    `SELECT c.relname AS table_name, t.tgenabled
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE p.proname = 'forbid_mutation' AND NOT t.tgisinternal`,
  );
  // 'O' fires in normal sessions, 'A' always; 'D' is disabled and 'R' fires only on replicas.
  const guarded = new Set(triggers.filter((t) => t.tgenabled === 'O' || t.tgenabled === 'A').map((t) => t.table_name as string));
  const unguarded = APPEND_ONLY_TABLES.filter((t) => !guarded.has(t));
  add(
    'append_only_guards',
    unguarded.length === 0,
    unguarded.length ? `no enabled append-only trigger on ${unguarded.join(', ')}` : `enabled on all ${APPEND_ONLY_TABLES.length} evidence and journal tables`,
  );

  for (const [table, ref] of [
    ['chain_observations', 'id::text'],
    ['corporate_actions', `external_id || ' r' || revision`],
  ] as const) {
    const { rows } = await q.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE stored_payload_sha256 <> ${STORED_HASH})::int AS mismatched,
              count(*) FILTER (WHERE NOT hash_sealed_at_ingestion)::int AS sealed_later,
              (array_agg(${ref}) FILTER (WHERE stored_payload_sha256 <> ${STORED_HASH}))[1:5] AS sample
         FROM ${table}`,
    );
    const r = rows[0];
    add(
      `${table}_hashes`,
      r.mismatched === 0,
      r.mismatched > 0
        ? `${r.mismatched} of ${r.total} payloads no longer match their stored hash (e.g. ${(r.sample as string[]).join(', ')})`
        : `${r.total} payloads match their stored hashes${r.sealed_later ? ` (${r.sealed_later} sealed when hashes became verifiable, not at ingestion)` : ''}`,
    );
  }

  const { rows: journal } = await q.query(
    `SELECT
       (SELECT count(*) FROM ledger_journal)::int AS total,
       (SELECT count(*) FROM ledger_journal r LEFT JOIN ledger_journal o ON o.id = r.reverses_id
         WHERE r.entry_type = 'reversal'
           AND (o.id IS NULL OR o.entry_type <> 'recognition' OR o.owner <> r.owner OR o.mint <> r.mint
                OR o.multiplier_version_id <> r.multiplier_version_id OR o.id >= r.id))::int AS bad_reversals,
       (SELECT count(*) FROM (SELECT reverses_id FROM ledger_journal WHERE reverses_id IS NOT NULL
                               GROUP BY reverses_id HAVING count(*) > 1) x)::int AS reversed_twice,
       (SELECT count(*) FROM (SELECT owner, mint, multiplier_version_id FROM ledger_journal j
                               WHERE entry_type = 'recognition' AND NOT EXISTS (SELECT 1 FROM ledger_journal x WHERE x.reverses_id = j.id)
                               GROUP BY 1, 2, 3 HAVING count(*) > 1) y)::int AS doubly_open`,
  );
  const j = journal[0];
  const journalProblems = [
    j.bad_reversals ? `${j.bad_reversals} reversal(s) that do not point back at an earlier recognition of the same entry` : null,
    j.reversed_twice ? `${j.reversed_twice} recognition(s) reversed more than once` : null,
    j.doubly_open ? `${j.doubly_open} entry(ies) with two unreversed recognitions` : null,
  ].filter(Boolean);
  add('journal_structure', journalProblems.length === 0, journalProblems.length ? journalProblems.join('; ') : `${j.total} rows; every reversal closes exactly one earlier recognition`);

  // What the journal says is recognized must equal the income the API publishes.
  const { rows: drift } = await q.query(
    `WITH open AS (
       SELECT j.owner, j.mint, count(*) AS n, sum(j.usd) AS usd FROM ledger_journal j
        WHERE j.entry_type = 'recognition' AND j.kind = 'dividend'
          AND NOT EXISTS (SELECT 1 FROM ledger_journal x WHERE x.reverses_id = j.id)
        GROUP BY 1, 2),
     published AS (
       SELECT p.owner, p.mint, count(*) AS n, sum(e.usd) AS usd
         FROM income_entries e JOIN position_epochs p ON p.id = e.position_epoch_id
        WHERE e.kind = 'dividend' GROUP BY 1, 2)
     SELECT coalesce(o.mint, p.mint) AS mint FROM open o FULL JOIN published p ON p.owner = o.owner AND p.mint = o.mint
      WHERE o.n IS DISTINCT FROM p.n OR o.usd IS DISTINCT FROM p.usd`,
  );
  add(
    'journal_matches_income',
    drift.length === 0,
    drift.length
      ? `${drift.length} position(s) where open dividend recognitions differ from published income (mints: ${[...new Set(drift.map((d) => d.mint))].slice(0, 5).join(', ')})`
      : 'open dividend recognitions equal published dividend income for every position',
  );

  return results;
}
