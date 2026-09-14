import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schemas } from '@corpact/client';
import type { Dataset, Db } from '@corpact/db';
import {
  ACTION_KINDS,
  ACTION_KIND_SPECS,
  LifecycleError,
  Rational,
  currentState,
  deriveLifecycle,
  traceLineage,
  type ActionKind,
  type ClassifierStatus,
  type CorporateActionStatus,
  type CorporateActionType,
  type InstrumentRef,
  type LifecycleStep,
  type LineageLink,
} from '@corpact/domain';
import { HttpError, errors, exact, iso, isoOfDate, ratio, towardZero } from './shared';

/**
 * API v2: every booked or recognised change is a corporate action with its taxonomy type, lifecycle, distinct
 * timestamps, evidence hashes and validation status. v1 is unchanged; differences are documented in API v1 → v2.
 */
export interface V2Deps {
  db: Db;
  dataset: () => Promise<Dataset>;
  authorizeWallet: (request: FastifyRequest, owner: string) => Promise<string>;
}

type Row = Record<string, any>;

const TREATMENT = {
  dividend: 'income',
  split: 'quantity_basis',
  distribution: 'basis_allocation',
  identity_change: 'identity',
  unclassified_adjustment: 'not_booked',
} as const;

const ENTRY_SQL = `
  SELECT e.id, e.kind, e.action_kind, e.effective_unix, e.quantity_num, e.quantity_den, e.split_factor_num, e.split_factor_den, e.usd, e.valuation,
         e.warnings, e.reasons, e.interpretation_revision, e.last_corrected_at, e.distributed_fraction_num, e.distributed_fraction_den, e.proceeds_usd,
         e.multiplier_version_id, p.owner, p.mint, a.symbol, a.decimals,
         v.update_signature, v.observed_slot, v.observed_instruction_path, v.scheduled_unix, v.effective_unix AS version_effective_unix, v.immediate,
         v.status AS version_status, v.old_multiplier_bits, v.new_multiplier_bits, v.old_multiplier_exact, v.new_multiplier_exact,
         m.classifier_version, m.classification, m.classifier_status, m.external_id, m.revision, m.retention_rate, m.refund_note,
         m.from_underlying, m.to_underlying, m.reasons AS match_reasons, m.warnings AS match_warnings,
         (SELECT o.block_time_unix FROM chain_observations o
           WHERE o.kind = 'transaction' AND o.signature = v.update_signature AND o.block_time_unix IS NOT NULL ORDER BY o.id LIMIT 1) AS publication_unix,
         (SELECT min(o.observed_at) FROM chain_observations o
           WHERE o.kind = 'mint_state' AND o.subject = p.mint AND o.observed_at >= to_timestamp(v.effective_unix)) AS first_observed_at,
         (SELECT min(j.recorded_at) FROM ledger_journal j
           WHERE j.owner = p.owner AND j.multiplier_version_id = e.multiplier_version_id AND j.entry_type = 'recognition' AND j.change_reason <> 'initial') AS corrected_at
    FROM income_entries e
    JOIN position_epochs p ON p.id = e.position_epoch_id
    JOIN assets a ON a.mint = p.mint
    JOIN multiplier_versions v ON v.id = e.multiplier_version_id
    LEFT JOIN action_matches m ON m.id = e.action_match_id
   WHERE p.owner = $1`;

/** Rows stored before the taxonomy carry no action kind; derive the one their ledger kind implied. */
function actionType(r: Row): ActionKind {
  if (r.action_kind) return r.action_kind as ActionKind;
  if (r.kind === 'dividend') return 'cash_dividend';
  if (r.kind === 'split') return r.split_factor_num !== null && BigInt(r.split_factor_num) < BigInt(r.split_factor_den) ? 'reverse_split' : 'forward_split';
  if (r.kind === 'distribution') return 'spin_off';
  if (r.kind === 'identity_change') return 'identity_change';
  return 'unknown';
}

const nullableExact = (num: string | null, den: string | null) => (num === null || den === null ? null : exact(ratio(num, den)));
const nullableDecimal = (value: string | null) => (value === null ? null : exact(Rational.fromDecimal(value)));

function headline(type: ActionKind, r: Row, quantityDisplay: string): string {
  const s = r.symbol as string;
  const factor = r.split_factor_num === null ? 'rescaled' : `×${ratio(r.split_factor_num, r.split_factor_den).toFixed(6)}`;
  const percent = r.distributed_fraction_num === null ? 'an unknown share' : `${ratio(r.distributed_fraction_num, r.distributed_fraction_den).mul(Rational.of(100n)).toFixed(2)}%`;
  const usd = r.usd === null ? 'USD unknown' : `$${Rational.fromDecimal(r.usd).toFixed(2)} from issuer net cash`;
  switch (type) {
    case 'cash_dividend':
      return `${s}: cash dividend reinvested as ${quantityDisplay} units, ${usd}. Income.`;
    case 'withholding_adjustment':
      return `${s}: withholding refund reinvested as ${quantityDisplay} units, ${usd}. Tax withheld on an earlier dividend, passed back: income, not a new dividend.`;
    case 'forward_split':
    case 'reverse_split':
      return `${s}: ${type === 'forward_split' ? 'forward' : 'reverse'} split, units ${factor}. No income.`;
    case 'stock_dividend':
      return `${s}: stock dividend, units ${factor} (${quantityDisplay} units added). Cost basis spread across them; no income.`;
    case 'spin_off':
      return `${s}: spin-off delivered as cash reinvested in the parent: ${percent} of the position's value, ${quantityDisplay} units of principal. No income.`;
    case 'rights_distribution':
      return `${s}: rights sold and reinvested in the parent: ${percent} of the position's value, ${quantityDisplay} units of principal. No income.`;
    case 'identity_change':
      return `${s}: underlying changed from ${r.from_underlying ?? 'an unrecorded listing'} to ${r.to_underlying ?? 'an unrecorded listing'}, units ${factor}. All cost basis carried over; no income.`;
    default: {
      const spec = ACTION_KIND_SPECS[type];
      return `${s}: ${quantityDisplay} unit adjustment not booked${type === 'unknown' ? '' : `, recognised as ${spec.label.toLowerCase()} (${spec.classifier})`}. No income; conversion disabled.`;
    }
  }
}

interface Revisions {
  byEvent: Map<string, Row[]>;
}

async function loadRevisions(db: Db, eventIds: readonly string[]): Promise<Revisions> {
  const byEvent = new Map<string, Row[]>();
  if (eventIds.length === 0) return { byEvent };
  const { rows } = await db.query(
    `SELECT external_id, revision, kind, status, effective_at, issuer_created_at, ingested_at, notes, source, stored_payload_sha256
       FROM corporate_actions WHERE issuer = 'xstocks' AND external_id = ANY($1::text[]) ORDER BY external_id, revision`,
    [eventIds],
  );
  for (const r of rows) byEvent.set(r.external_id, [...(byEvent.get(r.external_id) ?? []), r]);
  return { byEvent };
}

function lifecycleOf(r: Row, revisions: readonly Row[]): { steps: LifecycleStep[]; inconsistency: string | null } {
  const activatedAt = new Date(Number(r.version_effective_unix) * 1000);
  const publishedAt = r.immediate ? activatedAt : r.publication_unix == null ? null : new Date(Number(r.publication_unix) * 1000);
  try {
    const steps = deriveLifecycle({
      issuer: r.external_id
        ? {
            eventId: r.external_id,
            revisions: revisions.map((x) => ({
              version: x.revision,
              type: x.kind as CorporateActionType,
              status: x.status as CorporateActionStatus,
              createdAt: new Date(x.issuer_created_at),
              notes: x.notes,
              sha256: x.stored_payload_sha256 ?? null,
            })),
          }
        : null,
      chain: { signature: r.update_signature, status: r.version_status, publishedAt, activatedAt, supersededAt: null },
      correctedAt: r.corrected_at ? new Date(r.corrected_at) : null,
      reversedAt: null,
    });
    return { steps, inconsistency: null };
  } catch (error) {
    if (!(error instanceof LifecycleError)) throw error;
    return { steps: [], inconsistency: error.message };
  }
}

function presentAction(r: Row, revisions: readonly Row[]) {
  const type = actionType(r);
  const quantity = ratio(r.quantity_num, r.quantity_den);
  const quantityDisplay = towardZero(quantity, Number(r.decimals));
  const matched = revisions.find((x) => x.revision === r.revision) ?? null;
  const status: ClassifierStatus = (r.classifier_status as ClassifierStatus | null) ?? ACTION_KIND_SPECS[type].classifier;
  const lifecycle = lifecycleOf(r, revisions);
  return {
    matched,
    lifecycle,
    action: {
      id: String(r.id),
      mint: r.mint,
      symbol: r.symbol,
      effectiveAt: iso(r.effective_unix)!,
      type,
      treatment: TREATMENT[r.kind as keyof typeof TREATMENT],
      validation: { status, realInstances: ACTION_KIND_SPECS[type].realInstances },
      lifecycle: { state: currentState(lifecycle.steps) },
      quantity: exact(quantity),
      quantityDisplay,
      factor: nullableExact(r.split_factor_num, r.split_factor_den),
      distributedFraction: nullableExact(r.distributed_fraction_num, r.distributed_fraction_den),
      usd: r.kind === 'dividend' ? nullableDecimal(r.usd) : null,
      proceedsUsd: nullableDecimal(r.proceeds_usd ?? null),
      valuation: r.valuation,
      retentionRate: nullableDecimal(r.retention_rate ?? null),
      refundNote: r.refund_note ?? null,
      underlying: r.kind === 'identity_change' ? { from: r.from_underlying ?? null, to: r.to_underlying ?? null } : null,
      headline: headline(type, r, quantityDisplay),
      warnings: (r.warnings as string[] | null) ?? [],
      reasons: (r.reasons as string[] | null) ?? [],
      revision: r.interpretation_revision as number,
      correctedAt: isoOfDate(r.last_corrected_at),
      evidence: {
        issuerEventId: r.external_id ?? null,
        issuerRevision: r.revision ?? null,
        evidenceSha256: matched?.stored_payload_sha256 ?? null,
        updateSignature: r.update_signature,
      },
    },
  };
}

const presentStep = (s: LifecycleStep) => ({
  state: s.state,
  at: s.at.toISOString(),
  reason: s.reason,
  evidence: s.evidence,
  revision: s.revision ?? null,
});

function journalEntryV2(r: Row) {
  return {
    id: String(r.id),
    recordedAt: isoOfDate(r.recorded_at)!,
    entryType: r.entry_type,
    kind: r.kind,
    type: actionType(r),
    effectiveAt: iso(r.effective_unix)!,
    quantity: exact(ratio(r.quantity_num, r.quantity_den)),
    factor: nullableExact(r.split_factor_num, r.split_factor_den),
    usd: r.kind === 'dividend' ? nullableDecimal(r.usd) : null,
    valuation: r.valuation,
    distributedFraction: nullableExact(r.distributed_fraction_num ?? null, r.distributed_fraction_den ?? null),
    proceedsUsd: nullableDecimal(r.proceeds_usd ?? null),
    issuerEventId: r.issuer_event_id,
    issuerRevision: r.issuer_revision,
    reversesId: r.reverses_id === null ? null : String(r.reverses_id),
    changeReason: r.change_reason,
    changeDetail: r.change_detail,
  };
}

/** The mint's recorded identities and lineage links, with the links that are still in force. */
async function loadLineage(db: Db, mint: string) {
  const { rows: identities } = await db.query(
    `SELECT id, symbol, underlying_symbol, underlying_isin, valid_from, issuer_event_id, evidence FROM instrument_identities WHERE mint = $1 ORDER BY valid_from, id`,
    [mint],
  );
  const { rows: linkRows } = await db.query(
    `SELECT l.id, l.kind, l.effective_at, l.issuer_event_id, l.issuer_revision, l.classifier_status, l.from_identity_id, l.cash_basis_num, l.cash_basis_den,
            l.supersedes_id, f.underlying_symbol AS from_underlying_symbol,
            EXISTS (SELECT 1 FROM lineage_links later WHERE later.supersedes_id = l.id) AS superseded
       FROM lineage_links l JOIN instrument_identities f ON f.id = l.from_identity_id
      WHERE f.mint = $1
      ORDER BY l.effective_at, l.id`,
    [mint],
  );
  const { rows: successorRows } = linkRows.length
    ? await db.query(
        `SELECT s.link_id, s.identity_id, s.basis_num, s.basis_den, s.quantity_factor_num, s.quantity_factor_den, i.underlying_symbol
           FROM lineage_successors s JOIN instrument_identities i ON i.id = s.identity_id
          WHERE s.link_id = ANY($1::bigint[]) ORDER BY s.link_id, s.identity_id`,
        [linkRows.map((l) => l.id)],
      )
    : { rows: [] as Row[] };
  const links = linkRows.map((l) => ({
    row: l,
    presented: {
      id: String(l.id),
      kind: l.kind,
      effectiveAt: isoOfDate(l.effective_at)!,
      issuerEventId: l.issuer_event_id,
      issuerRevision: l.issuer_revision,
      classifierStatus: l.classifier_status,
      fromIdentityId: String(l.from_identity_id),
      fromUnderlyingSymbol: l.from_underlying_symbol,
      cashBasisFraction: exact(ratio(String(l.cash_basis_num), String(l.cash_basis_den))),
      supersedesId: l.supersedes_id === null ? null : String(l.supersedes_id),
      successors: successorRows
        .filter((s) => String(s.link_id) === String(l.id))
        .map((s) => ({
          identityId: String(s.identity_id),
          underlyingSymbol: s.underlying_symbol,
          basisFraction: exact(ratio(String(s.basis_num), String(s.basis_den))),
          quantityFactor: s.quantity_factor_num === null ? null : exact(ratio(String(s.quantity_factor_num), String(s.quantity_factor_den))),
        })),
    },
  }));
  return { identities, links, successorRows };
}

export async function registerV2(app: FastifyInstance, deps: V2Deps) {
  const { db, dataset, authorizeWallet } = deps;

  app.get(
    '/v2/taxonomy',
    {
      config: { scope: 'assets:read' },
      schema: {
        tags: ['actions'],
        summary: 'Every corporate-action type, its ledger treatment, real-instance count and validation status',
        response: { 200: schemas.taxonomyResponse, ...errors },
      },
    },
    async () => ({ kinds: ACTION_KINDS.map((kind) => ACTION_KIND_SPECS[kind]) }),
  );

  app.get(
    '/v2/actions',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['actions'],
        summary: 'Corporate actions applied to a wallet, newest first: type, treatment, lifecycle state, evidence and validation status',
        querystring: schemas.incomeQuery,
        response: { 200: schemas.actionsResponse, ...errors },
      },
    },
    async (request) => {
      const q = request.query as { owner: string; limit: number; offset: number };
      const owner = await authorizeWallet(request, q.owner);
      const { rows } = await db.query(`${ENTRY_SQL} ORDER BY e.effective_unix DESC, e.id DESC LIMIT $2 OFFSET $3`, [owner, q.limit + 1, q.offset]);
      const page = rows.slice(0, q.limit);
      const revisions = await loadRevisions(db, [...new Set(page.map((r) => r.external_id).filter(Boolean))]);
      return {
        owner,
        dataset: await dataset(),
        actions: page.map((r) => presentAction(r, revisions.byEvent.get(r.external_id) ?? []).action),
        nextOffset: rows.length > q.limit ? q.offset + q.limit : null,
      };
    },
  );

  app.get(
    '/v2/actions/:id',
    {
      config: { scope: 'ledger:read' },
      schema: {
        tags: ['actions'],
        summary: 'One corporate action with its full lifecycle, distinct timestamps, every issuer revision, chain evidence, journal history and lineage',
        params: schemas.incomeEventParams,
        querystring: schemas.ownerQuery,
        response: { 200: schemas.actionDetail, ...errors },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const owner = await authorizeWallet(request, (request.query as { owner: string }).owner);
      const { rows } = await db.query(`${ENTRY_SQL} AND e.id = $2`, [owner, id]);
      const r = rows[0];
      if (!r) throw new HttpError(404, 'No such action for this owner');
      const revisionRows = r.external_id ? ((await loadRevisions(db, [r.external_id])).byEvent.get(r.external_id) ?? []) : [];
      const { action, matched, lifecycle } = presentAction(r, revisionRows);
      const [{ rows: historyRows }, { rows: recordRows }] = await Promise.all([
        db.query('SELECT * FROM ledger_journal WHERE owner = $1 AND multiplier_version_id = $2 ORDER BY id', [owner, r.multiplier_version_id]),
        matched
          ? db.query(`SELECT payload FROM corporate_actions WHERE issuer = 'xstocks' AND external_id = $1 AND revision = $2`, [r.external_id, r.revision])
          : Promise.resolve({ rows: [] as Row[] }),
      ]);
      const lineage = r.kind === 'identity_change' && r.external_id ? await loadLineage(db, r.mint) : null;
      const link = lineage?.links.find((l) => l.row.issuer_event_id === r.external_id && !l.row.superseded)?.presented ?? null;
      return {
        ...action,
        owner,
        dataset: await dataset(),
        lifecycle: { state: action.lifecycle.state, steps: lifecycle.steps.map(presentStep), inconsistency: lifecycle.inconsistency },
        timestamps: {
          issuerEffectiveAt: isoOfDate(matched?.effective_at),
          issuerCreatedAt: isoOfDate(matched?.issuer_created_at),
          configuredActivationAt: iso(r.scheduled_unix),
          publicationBlockTime: iso(r.publication_unix == null ? null : String(r.publication_unix)),
          firstObservedActiveAt: isoOfDate(r.first_observed_at),
          ingestedAt: isoOfDate(matched?.ingested_at),
        },
        evidence: {
          ...action.evidence,
          issuerRevisions: revisionRows.map((x) => ({
            version: x.revision,
            type: x.kind,
            status: x.status,
            effectiveAt: isoOfDate(x.effective_at),
            createdAt: isoOfDate(x.issuer_created_at)!,
            ingestedAt: isoOfDate(x.ingested_at)!,
            notes: x.notes,
            source: x.source,
            storedPayloadSha256: x.stored_payload_sha256 ?? null,
          })),
          chain: {
            updateSignature: r.update_signature,
            explorerUrl: `https://solscan.io/tx/${r.update_signature}`,
            observedSlot: r.observed_slot,
            instructionPath: r.observed_instruction_path,
            scheduledAt: iso(r.scheduled_unix),
            effectiveAt: iso(r.version_effective_unix),
            immediate: r.immediate,
            status: r.version_status,
            multiplierBefore: { bits: r.old_multiplier_bits, exact: r.old_multiplier_exact },
            multiplierAfter: { bits: r.new_multiplier_bits, exact: r.new_multiplier_exact },
          },
          classification: r.classification
            ? { result: r.classification, classifierVersion: r.classifier_version, reasons: r.match_reasons ?? [], warnings: r.match_warnings ?? [] }
            : { result: 'pending', classifierVersion: null, reasons: ['Classification pending'], warnings: [] },
          issuerRecord: recordRows[0]?.payload ?? null,
        },
        history: historyRows.map(journalEntryV2),
        lineage: link,
      };
    },
  );

  app.get(
    '/v2/instruments/:mint/lineage',
    {
      config: { scope: 'assets:read' },
      schema: {
        tags: ['actions'],
        summary: "A mint's recorded identities, the lineage links between them, and where the basis of its earliest identity is now",
        params: schemas.mintParams,
        response: { 200: schemas.lineageResponse, ...errors },
      },
    },
    async (request) => {
      const { mint } = request.params as { mint: string };
      const { identities, links } = await loadLineage(db, mint);
      const refOf = (i: Row): InstrumentRef => ({ mint, symbol: i.symbol, underlyingSymbol: i.underlying_symbol, underlyingIsin: i.underlying_isin });
      const byId = new Map(identities.map((i) => [String(i.id), i]));
      const inForce: LineageLink[] = links
        .filter((l) => !l.row.superseded)
        .map((l) => ({
          kind: l.row.kind,
          at: new Date(l.row.effective_at),
          issuerEventId: l.row.issuer_event_id,
          from: refOf(byId.get(String(l.row.from_identity_id))!),
          to: l.presented.successors.map((s) => ({
            instrument: refOf(byId.get(s.identityId)!),
            basisFraction: Rational.fromDecimal(s.basisFraction),
            quantityFactor: s.quantityFactor === null ? null : Rational.fromDecimal(s.quantityFactor),
          })),
          cashBasisFraction: Rational.fromDecimal(l.presented.cashBasisFraction),
        }));
      const earliest = identities[0];
      const current = earliest
        ? traceLineage(refOf(earliest), inForce).map((h) => ({
            identityId: identities.find((i) => i.underlying_symbol === h.instrument.underlyingSymbol && i.underlying_isin === h.instrument.underlyingIsin)?.id?.toString() ?? null,
            underlyingSymbol: h.instrument.underlyingSymbol,
            basisFraction: exact(h.basisFraction),
            terminated: h.terminated,
          }))
        : [];
      return {
        mint,
        dataset: await dataset(),
        identities: identities.map((i) => ({
          id: String(i.id),
          symbol: i.symbol,
          underlyingSymbol: i.underlying_symbol,
          underlyingIsin: i.underlying_isin,
          validFrom: isoOfDate(i.valid_from)!,
          issuerEventId: i.issuer_event_id,
          evidence: i.evidence,
        })),
        links: links.map((l) => l.presented),
        current,
      };
    },
  );
}
