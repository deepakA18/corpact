import { Rational, type Classification, type IssuerCorporateAction, type ObservedTransition } from '@corpact/domain';

const DIVIDEND_TYPES = new Set<string>(['CashDividend']);
const SPLIT_TYPES = new Set<string>(['ForwardSplit', 'ReverseSplit', 'UnitSplit']);

/**
 * The issuer's own endpoints disagree in the last representable digit — e.g. HONx
 * 2026-05-15: multiplier history 1.020191445467247, corporate actions
 * "1.0201914454672472" (adjacent f64s). The mint's f64 is canonical; an issuer
 * value matches if it is within this relative tolerance of it.
 */
const F64_RELATIVE_TOLERANCE = 4 * Number.EPSILON;

export function sameF64(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= F64_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

/** Keep only the highest version of each issuer event. */
export function latestVersions(actions: readonly IssuerCorporateAction[]): IssuerCorporateAction[] {
  const byId = new Map<string, IssuerCorporateAction>();
  for (const a of actions) {
    const seen = byId.get(a.eventId);
    if (!seen || a.version > seen.version) byId.set(a.eventId, a);
  }
  return [...byId.values()];
}

/**
 * Issuer net cash is trusted for valuation only if the reinvestment price it implies
 * is within this factor of the median implied by the same asset's other dividends.
 * STRCx 2025-11-30 implies ~$953,728/share against a ~$100 median.
 */
const IMPLIED_PRICE_MAX_FACTOR = Rational.of(3n);
const MIN_PEERS_FOR_PRICE_CHECK = 2;

/** M_old × net ÷ (M_new − M_old): the price per share at which the issuer's cash became shares. */
function impliedReinvestmentPrice(multiplierOld: Rational, multiplierNew: Rational, net: Rational): Rational | null {
  const delta = multiplierNew.sub(multiplierOld);
  if (delta.compare(Rational.ZERO) <= 0 || net.compare(Rational.ZERO) <= 0) return null;
  return multiplierOld.mul(net).div(delta);
}

function peerImpliedPrices(a: IssuerCorporateAction, sameSymbol: readonly IssuerCorporateAction[]): Rational[] {
  const prices: Rational[] = [];
  for (const peer of latestVersions(sameSymbol)) {
    if (peer.eventId === a.eventId || !DIVIDEND_TYPES.has(peer.type)) continue;
    if (peer.status !== 'Initial' && peer.status !== 'Corrected') continue;
    if (peer.netCashUsdPerShare === null || peer.multiplierOld === null || peer.multiplierNew === null) continue;
    const price = impliedReinvestmentPrice(
      Rational.fromDecimal(peer.multiplierOld),
      Rational.fromDecimal(peer.multiplierNew),
      Rational.fromDecimal(peer.netCashUsdPerShare),
    );
    if (price !== null) prices.push(price);
  }
  return prices.sort((x, y) => x.compare(y));
}

const unclassified = (...reasons: string[]): Classification => ({ kind: 'unclassified', reasons });

/**
 * Classify an activated multiplier change by issuer evidence — never by size.
 * Anything not positively matched is `unclassified`: it books no income and
 * makes nothing available to convert.
 */
export function classifyTransition(
  t: ObservedTransition,
  actions: readonly IssuerCorporateAction[],
): Classification {
  const matches = latestVersions(actions.filter((a) => a.symbol === t.symbol)).filter(
    (a) =>
      (a.status === 'Initial' || a.status === 'Corrected') &&
      a.multiplierOld !== null &&
      a.multiplierNew !== null &&
      sameF64(Number(a.multiplierOld), t.before) &&
      sameF64(Number(a.multiplierNew), t.after),
  );

  if (matches.length === 0) return unclassified('No published issuer action matches the observed multiplier change');
  if (matches.length > 1) {
    return unclassified(`${matches.length} issuer actions match (${matches.map((m) => m.eventId).join(', ')}); cannot attribute`);
  }
  const action = matches[0]!;

  if (action.effectiveAt?.getTime() !== t.activatedAt.getTime()) {
    return unclassified(
      `Issuer effective time ${action.effectiveAt?.toISOString() ?? 'null'} differs from observed activation ${t.activatedAt.toISOString()}`,
    );
  }

  if (DIVIDEND_TYPES.has(action.type)) {
    return classifyDividend(t, action, actions.filter((a) => a.symbol === t.symbol));
  }
  if (SPLIT_TYPES.has(action.type)) return classifySplit(t, action);
  return unclassified(`Issuer action ${action.type} (${action.eventId}) has no income policy; not booked as income`);
}

function classifyDividend(
  t: ObservedTransition,
  a: IssuerCorporateAction,
  sameSymbol: readonly IssuerCorporateAction[],
): Classification {
  if (!(t.after > t.before)) return unclassified(`Dividend ${a.eventId} does not increase the multiplier`);

  const warnings: string[] = [];
  const gross = a.grossCashUsdPerShare === null ? null : Rational.fromDecimal(a.grossCashUsdPerShare);
  const rate = a.withholdingTaxRate === null ? null : Rational.fromDecimal(a.withholdingTaxRate);
  let net = a.netCashUsdPerShare === null ? null : Rational.fromDecimal(a.netCashUsdPerShare);

  if (net === null && gross !== null && rate !== null) {
    net = gross.mul(Rational.ONE.sub(rate));
    warnings.push('Net cash derived from gross × (1 − withholding); issuer did not publish net');
  } else if (net === null) {
    warnings.push('Issuer published no net cash amount; USD value unavailable from issuer evidence');
  }
  if (net !== null && gross !== null && rate !== null && !gross.mul(Rational.ONE.sub(rate)).eq(net)) {
    warnings.push(`Issuer gross/withholding/net are inconsistent (gross ${a.grossCashUsdPerShare}, rate ${a.withholdingTaxRate}, net ${a.netCashUsdPerShare})`);
  }

  if (net !== null && a.multiplierOld !== null && a.multiplierNew !== null) {
    const own = impliedReinvestmentPrice(Rational.fromDecimal(a.multiplierOld), Rational.fromDecimal(a.multiplierNew), net);
    const peers = peerImpliedPrices(a, sameSymbol);
    if (own !== null && peers.length >= MIN_PEERS_FOR_PRICE_CHECK) {
      const median = peers[Math.floor((peers.length - 1) / 2)]!;
      const ratio = own.div(median);
      if (ratio.compare(IMPLIED_PRICE_MAX_FACTOR) > 0 || ratio.mul(IMPLIED_PRICE_MAX_FACTOR).compare(Rational.ONE) < 0) {
        warnings.push(
          `Issuer net cash implies reinvestment at $${own.toFixed(2)}/share against a median of $${median.toFixed(2)} across ${peers.length} other ${a.symbol} dividends; issuer valuation not used`,
        );
        net = null;
      }
    }
  }

  return { kind: 'dividend', eventId: a.eventId, version: a.version, netCashUsdPerShare: net, warnings };
}

function classifySplit(t: ObservedTransition, a: IssuerCorporateAction): Classification {
  const before = Rational.fromFloat64(t.before);
  const after = Rational.fromFloat64(t.after);
  const warnings: string[] = [];
  let factor: Rational;

  if (a.fromUnits !== null && a.toUnits !== null) {
    factor = Rational.fromDecimal(a.toUnits).div(Rational.fromDecimal(a.fromUnits));
    if (!sameF64(before.mul(factor).toNumber(), t.after)) {
      return unclassified(
        `${a.type} ${a.eventId} factor ${a.toUnits}:${a.fromUnits} does not reconcile ${t.before} → ${t.after}`,
      );
    }
  } else {
    factor = after.div(before);
    warnings.push('Split factor derived from multipliers; issuer published no unit ratio');
  }
  return { kind: 'split', eventId: a.eventId, version: a.version, factor, warnings };
}
