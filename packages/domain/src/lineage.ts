import { Rational } from './rational';

/**
 * Position lineage (brief Task 1b): a position traced across changes to what it holds.
 * A link says which instruments succeed an instrument, what share of its basis each carries,
 * and what share left the lineage as cash. Basis is conserved exactly on every link.
 */

export interface InstrumentRef {
  mint: string;
  symbol: string;
  underlyingSymbol: string | null;
  underlyingIsin: string | null;
}

export type LineageLinkKind =
  /** Same economic position under a new label or underlying listing (ticker change, ADR conversion). */
  | 'identity_change'
  /** The position becomes a different underlying (stock-for-stock or mixed merger). */
  | 'transform'
  /** Part of the position's value is distributed as another instrument or as its cash proceeds. */
  | 'spin_off'
  /** The position ends (cash merger, redemption, delisting, wrapper discontinuation). */
  | 'terminate';

export interface LineageSuccessor {
  instrument: InstrumentRef;
  /** Share of the predecessor's basis carried by this successor. */
  basisFraction: Rational;
  /** Successor units per predecessor unit, when known. */
  quantityFactor: Rational | null;
}

export interface LineageLink {
  kind: LineageLinkKind;
  at: Date;
  issuerEventId: string | null;
  from: InstrumentRef;
  to: readonly LineageSuccessor[];
  /** Share of the predecessor's basis that left the lineage as cash (sold distributions, cash consideration, cash-in-lieu). */
  cashBasisFraction: Rational;
}

export class LineageError extends Error {
  override name = 'LineageError';
}

const inUnitInterval = (r: Rational) => !r.isNegative() && r.compare(Rational.ONE) <= 0;

/** Throws unless the link conserves basis exactly and fits its kind. */
export function validateLink(link: LineageLink): void {
  const fractions = [...link.to.map((s) => s.basisFraction), link.cashBasisFraction];
  if (!fractions.every(inUnitInterval)) throw new LineageError(`${link.kind}: basis fractions must lie in [0, 1]`);
  const total = fractions.reduce((sum, f) => sum.add(f), Rational.ZERO);
  if (!total.eq(Rational.ONE)) throw new LineageError(`${link.kind}: basis fractions sum to ${total.toFixed(12)}, not 1`);
  for (const s of link.to) {
    if (s.quantityFactor !== null && !(s.quantityFactor.compare(Rational.ZERO) > 0)) throw new LineageError(`${link.kind}: quantity factors must be positive`);
  }
  switch (link.kind) {
    case 'identity_change':
      if (link.to.length !== 1 || !link.cashBasisFraction.isZero()) throw new LineageError('identity_change carries all basis to exactly one successor');
      break;
    case 'transform':
      if (link.to.length === 0) throw new LineageError('transform needs at least one successor instrument');
      if (link.to.some((s) => s.instrument.mint === link.from.mint && s.instrument.underlyingSymbol === link.from.underlyingSymbol)) {
        throw new LineageError('transform must change the underlying; use identity_change for a relabel');
      }
      break;
    case 'spin_off':
      if (!link.to.some((s) => s.instrument.mint === link.from.mint)) throw new LineageError('spin_off keeps the parent as a successor');
      if (link.to.length < 2 && link.cashBasisFraction.isZero()) throw new LineageError('spin_off distributes value to another instrument or to cash');
      break;
    case 'terminate':
      if (link.to.length !== 0 || !link.cashBasisFraction.eq(Rational.ONE)) throw new LineageError('terminate has no successors and all basis leaves as cash');
      break;
  }
}

/**
 * The share of value distributed by a spin-off delivered as cash reinvested into the parent
 * (how xStocks deliver every recorded spin-off). The issuer reinvests at market, so the new
 * units' share of the position is exactly (M_new − M_old) / M_new — no price needed.
 */
export function reinvestedDistributionFraction(multiplierBefore: number, multiplierAfter: number): Rational {
  const before = Rational.fromFloat64(multiplierBefore);
  const after = Rational.fromFloat64(multiplierAfter);
  if (!(after.compare(before) > 0) || !(before.compare(Rational.ZERO) > 0)) {
    throw new LineageError(`A reinvested distribution must increase a positive multiplier (${multiplierBefore} → ${multiplierAfter})`);
  }
  return after.sub(before).div(after);
}

/** A spin-off link for a distribution sold and reinvested into the parent: the parent keeps (1 − f) of basis, f leaves as cash. */
export function reinvestedSpinOffLink(input: { at: Date; issuerEventId: string | null; parent: InstrumentRef; multiplierBefore: number; multiplierAfter: number }): LineageLink {
  const distributed = reinvestedDistributionFraction(input.multiplierBefore, input.multiplierAfter);
  const link: LineageLink = {
    kind: 'spin_off',
    at: input.at,
    issuerEventId: input.issuerEventId,
    from: input.parent,
    to: [{ instrument: input.parent, basisFraction: Rational.ONE.sub(distributed), quantityFactor: null }],
    cashBasisFraction: distributed,
  };
  validateLink(link);
  return link;
}

/** A change of underlying listing or form for the same company: all basis carries over, units rescale by the ratio. */
export function identityChangeLink(input: { at: Date; issuerEventId: string | null; from: InstrumentRef; to: InstrumentRef; quantityFactor: Rational }): LineageLink {
  const link: LineageLink = {
    kind: 'identity_change',
    at: input.at,
    issuerEventId: input.issuerEventId,
    from: input.from,
    to: [{ instrument: input.to, basisFraction: Rational.ONE, quantityFactor: input.quantityFactor }],
    cashBasisFraction: Rational.ZERO,
  };
  validateLink(link);
  return link;
}

const key = (i: InstrumentRef) => `${i.mint}|${i.underlyingSymbol ?? ''}|${i.underlyingIsin ?? ''}`;

/**
 * Follow a lineage forward from an instrument through time-ordered links, carrying the fraction
 * of the original basis held by each instrument reached. Returns every successor with its share.
 */
export function traceLineage(start: InstrumentRef, links: readonly LineageLink[]): Array<{ instrument: InstrumentRef; basisFraction: Rational; terminated: boolean }> {
  const ordered = [...links].sort((a, b) => a.at.getTime() - b.at.getTime());
  let holdings = new Map<string, { instrument: InstrumentRef; basisFraction: Rational; terminated: boolean }>([
    [key(start), { instrument: start, basisFraction: Rational.ONE, terminated: false }],
  ]);
  for (const link of ordered) {
    validateLink(link);
    const held = holdings.get(key(link.from));
    if (!held || held.terminated) continue;
    const next = new Map(holdings);
    next.delete(key(link.from));
    if (link.kind === 'terminate') {
      next.set(key(link.from), { instrument: link.from, basisFraction: Rational.ZERO, terminated: true });
    }
    for (const s of link.to) {
      const existing = next.get(key(s.instrument));
      const carried = held.basisFraction.mul(s.basisFraction);
      next.set(key(s.instrument), { instrument: s.instrument, basisFraction: (existing?.basisFraction ?? Rational.ZERO).add(carried), terminated: false });
    }
    holdings = next;
  }
  return [...holdings.values()];
}
