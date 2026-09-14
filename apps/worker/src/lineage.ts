import type { DbClient } from '@corpact/db';
import { identityChangeLink, type Classification } from '@corpact/domain';

type IdentityChange = Extract<Classification, { kind: 'identity_change' }>;

/**
 * Record an identity change in the position lineage: the identity the mint held before, the one it holds after,
 * and a link carrying all basis between them. Append-only and idempotent: an issuer revision already recorded
 * writes nothing; a new revision of the same event writes a link that supersedes the previous one.
 */
export async function recordIdentityChange(
  client: DbClient,
  input: { mint: string; symbol: string; effectiveUnix: bigint; classification: IdentityChange },
): Promise<'recorded' | 'unchanged'> {
  const c = input.classification;
  const { rows: existing } = await client.query(
    `SELECT id, issuer_revision FROM lineage_links WHERE kind = 'identity_change' AND issuer_event_id = $1
      AND NOT EXISTS (SELECT 1 FROM lineage_links later WHERE later.supersedes_id = lineage_links.id)`,
    [c.eventId],
  );
  const current = existing[0] as { id: string; issuer_revision: number } | undefined;
  if (current && current.issuer_revision === c.version) return 'unchanged';

  const effectiveAt = new Date(Number(input.effectiveUnix) * 1000);
  // Validates exact basis conservation before anything is written.
  const link = identityChangeLink({
    at: effectiveAt,
    issuerEventId: c.eventId,
    from: { mint: input.mint, symbol: input.symbol, underlyingSymbol: c.fromUnderlying, underlyingIsin: null },
    to: { mint: input.mint, symbol: input.symbol, underlyingSymbol: c.toUnderlying, underlyingIsin: null },
    quantityFactor: c.factor,
  });

  // The earlier identity is evidenced only as far back as the mint's first recorded multiplier change.
  const { rows: earliest } = await client.query(
    `SELECT min(effective_unix) AS unix FROM multiplier_versions WHERE mint = $1 AND effective_unix < $2`,
    [input.mint, input.effectiveUnix.toString()],
  );
  const fromUnix = earliest[0]?.unix == null ? input.effectiveUnix - 1n : BigInt(earliest[0].unix);
  const evidence = `Issuer ${c.eventId} v${c.version}: ${c.warnings[0] ?? 'identity change'}`;

  const identity = async (underlying: string | null, validFrom: Date, note: string) => {
    await client.query(
      `INSERT INTO instrument_identities (mint, symbol, underlying_symbol, valid_from, issuer_event_id, evidence)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (mint, valid_from) DO NOTHING`,
      [input.mint, input.symbol, underlying, validFrom, c.eventId, note],
    );
    const { rows } = await client.query('SELECT id FROM instrument_identities WHERE mint = $1 AND valid_from = $2', [input.mint, validFrom]);
    return String(rows[0].id);
  };
  const fromId = await identity(c.fromUnderlying, new Date(Number(fromUnix) * 1000), `Held before ${effectiveAt.toISOString()}, evidenced from the mint's first recorded multiplier change. ${evidence}`);
  const toId = await identity(c.toUnderlying, effectiveAt, evidence);

  const { rows: inserted } = await client.query(
    `INSERT INTO lineage_links (kind, effective_at, issuer_event_id, issuer_revision, from_identity_id, cash_basis_num, cash_basis_den, classifier_status, supersedes_id)
     VALUES ('identity_change', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [effectiveAt, c.eventId, c.version, fromId, link.cashBasisFraction.num.toString(), link.cashBasisFraction.den.toString(), c.classifier, current?.id ?? null],
  );
  for (const s of link.to) {
    await client.query(
      `INSERT INTO lineage_successors (link_id, identity_id, basis_num, basis_den, quantity_factor_num, quantity_factor_den) VALUES ($1, $2, $3, $4, $5, $6)`,
      [inserted[0].id, toId, s.basisFraction.num.toString(), s.basisFraction.den.toString(), s.quantityFactor?.num.toString() ?? null, s.quantityFactor?.den.toString() ?? null],
    );
  }
  return 'recorded';
}
