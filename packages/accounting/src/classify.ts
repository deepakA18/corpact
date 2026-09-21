import {
  ACTION_KIND_SPECS,
  Rational,
  actionKindForIssuerType,
  reinvestedDistributionFraction,
  type ActionKind,
  type ClassifierStatus,
  type Classification,
  type IssuerCorporateAction,
  type ObservedTransition,
} from '@corpact/domain';

const DIVIDEND_TYPES = new Set<string>(['CashDividend']);
const SPLIT_TYPES = new Set<string>(['ForwardSplit', 'ReverseSplit']);
const CONFIRMED = new Set<string>(['Initial', 'Corrected']);

/**
 * The issuer's own endpoints disagree in the last representable digit - e.g. HONx
 * 2026-05-15: multiplier history 1.020191445467247, corporate actions
 * "1.0201914454672472" (adjacent f64s). The mint's f64 is canonical; an issuer
 * value matches if it is within this relative tolerance of it.
 */
const F64_RELATIVE_TOLERANCE = 4 * Number.EPSILON;

export function sameF64(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= F64_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

/** Keep only the highest version of each issuer event, whatever its status. */
export function latestVersions(actions: readonly IssuerCorporateAction[]): IssuerCorporateAction[] {
  const byId = new Map<string, IssuerCorporateAction>();
  for (const a of actions) {
    const seen = byId.get(a.eventId);
    if (!seen || a.version > seen.version) byId.set(a.eventId, a);
  }
  return [...byId.values()];
}

/**
 * The confirmed version that stands for each issuer event, across both issuer feeds.
 * Versions are read in order: a confirmed version (`Initial`, `Corrected`) becomes the standing one; a
 * cancellation voids it only if it names that version or a later one ("[CANCELLED v5]"), or names none.
 * `Scheduled` versions are announcements, never evidence of what happened.
 *
 * The traps this avoids:
 * - SCCOx's upcoming feed cancels its scheduled copy ("[CANCELLED v4]", v6) after the delivered record (v5) was
 *   published. Taking the highest version would void the delivered stock dividend.
 * - LINx and NVOx refund wrongly withheld tax as a `Corrected` version of the original dividend, delivered as a second
 *   multiplier change that starts where the first ended, days later. That version is a follow-on delivery, not a
 *   replacement: both stand, or the original dividend would lose its issuer evidence.
 */
export function standingVersions(actions: readonly IssuerCorporateAction[]): IssuerCorporateAction[] {
  const byId = new Map<string, IssuerCorporateAction[]>();
  for (const a of actions) byId.set(a.eventId, [...(byId.get(a.eventId) ?? []), a]);
  const standing: IssuerCorporateAction[] = [];
  for (const versions of byId.values()) {
    const delivered: IssuerCorporateAction[] = [];
    let current: IssuerCorporateAction | null = null;
    for (const a of versions.toSorted((x, y) => x.version - y.version)) {
      if (CONFIRMED.has(a.status)) {
        if (current && followsOn(current, a)) delivered.push(current);
        current = a;
      } else if (a.status === 'Cancelled' && current) {
        const named = /\[CANCELLED v(\d+)\]/i.exec(a.notes ?? '');
        if (!named || Number(named[1]) >= current.version) current = null;
      }
    }
    standing.push(...delivered, ...(current ? [current] : []));
  }
  return standing;
}

/** A later confirmed version whose multiplier change starts exactly where the earlier one ended, at a later effective time. */
function followsOn(earlier: IssuerCorporateAction, later: IssuerCorporateAction): boolean {
  return (
    earlier.multiplierNew !== null &&
    later.multiplierOld !== null &&
    earlier.effectiveAt !== null &&
    later.effectiveAt !== null &&
    later.effectiveAt.getTime() > earlier.effectiveAt.getTime() &&
    sameF64(Number(earlier.multiplierNew), Number(later.multiplierOld))
  );
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
  for (const peer of standingVersions(sameSymbol)) {
    if (peer.eventId === a.eventId || !DIVIDEND_TYPES.has(peer.type)) continue;
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

/** Not booked. When an issuer record matched, the kind it claims is kept so the change is recognised, not guessed. */
function unclassified(
  reasons: string[],
  claimedBy: IssuerCorporateAction | null = null,
  classifier?: ClassifierStatus,
  recognisedAs?: ActionKind,
): Classification {
  const action = recognisedAs ?? (claimedBy ? actionKindForIssuerType(claimedBy.type) : 'unknown');
  return {
    kind: 'unclassified',
    action,
    classifier: classifier ?? ACTION_KIND_SPECS[action].classifier,
    eventId: claimedBy?.eventId ?? null,
    version: claimedBy?.version ?? null,
    reasons,
  };
}

/** Issuer types no real instance has shown being delivered: recognised, labelled unvalidated, never booked. */
const UNVALIDATED_TYPES = new Set<string>([
  'CashMerger',
  'StockAndCashMerger',
  'Redemption',
  'WorthlessRemoval',
  'CashAndStockDividend',
  'NameChange',
  // The only real rights distribution (KRAQx) was labelled UnitSplit; how a RightsDistribution-labelled record is delivered is unknown.
  'RightsDistribution',
  'Unknown',
]);

/**
 * Classify an activated multiplier change by issuer evidence - never by size or label.
 * Anything not positively matched is `unclassified`: it books no income and
 * makes nothing available to convert.
 */
export function classifyTransition(
  t: ObservedTransition,
  actions: readonly IssuerCorporateAction[],
): Classification {
  const sameSymbol = actions.filter((a) => a.symbol === t.symbol);
  const matches = standingVersions(sameSymbol).filter(
    (a) =>
      a.multiplierOld !== null &&
      a.multiplierNew !== null &&
      sameF64(Number(a.multiplierOld), t.before) &&
      sameF64(Number(a.multiplierNew), t.after),
  );

  if (matches.length === 0) return unclassified(['No published issuer action matches the observed multiplier change']);
  if (matches.length > 1) {
    return unclassified([`${matches.length} issuer actions match (${matches.map((m) => m.eventId).join(', ')}); cannot attribute`]);
  }
  const action = matches[0]!;

  if (action.effectiveAt?.getTime() !== t.activatedAt.getTime()) {
    return unclassified(
      [`Issuer effective time ${action.effectiveAt?.toISOString() ?? 'null'} differs from observed activation ${t.activatedAt.toISOString()}`],
      action,
    );
  }

  switch (action.type) {
    case 'CashDividend':
      return classifyDividend(t, action, sameSymbol);
    case 'ForwardSplit':
    case 'ReverseSplit':
      return classifySplit(t, action);
    case 'UnitSplit':
      return classifyUnitSplit(t, action, sameSymbol);
    case 'StockDividend':
      return classifyStockDividend(t, action, sameSymbol);
    case 'SpinOff':
      return classifyReinvestedDistribution(t, action, sameSymbol, 'spin_off', ACTION_KIND_SPECS.spin_off.classifier, []);
    case 'StockMerger':
      return classifyStockMerger(t, action);
  }
  if (UNVALIDATED_TYPES.has(action.type)) {
    return unclassified(
      [`${action.type} (${action.eventId}): no real instance has shown how this is delivered on chain, so the classifier is unvalidated; not booked`],
      action,
      'unvalidated',
    );
  }
  return unclassified([`Issuer action ${action.type} (${action.eventId}) has no income policy; not booked as income`], action);
}

const RETENTION_NOTE = /retention|retainer|retain/i;
const REFUND_NOTE = /\bWHT\b|withh/i;
const REFUND_CAUSE = /wrong|incorrect|refund|deducted|pass\b/i;

function classifyDividend(
  t: ObservedTransition,
  a: IssuerCorporateAction,
  sameSymbol: readonly IssuerCorporateAction[],
): Classification {
  if (!(t.after > t.before)) return unclassified([`Dividend ${a.eventId} does not increase the multiplier`], a);

  const warnings: string[] = [];
  const note = a.notes ?? '';
  const gross = a.grossCashUsdPerShare === null ? null : Rational.fromDecimal(a.grossCashUsdPerShare);
  const rate = a.withholdingTaxRate === null ? null : Rational.fromDecimal(a.withholdingTaxRate);
  let net = a.netCashUsdPerShare === null ? null : Rational.fromDecimal(a.netCashUsdPerShare);

  // A refund of tax withheld earlier: no gross distribution, a positive net, and the issuer says so.
  const refund = (gross === null || gross.isZero()) && net !== null && net.compare(Rational.ZERO) > 0 && REFUND_NOTE.test(note) && REFUND_CAUSE.test(note);
  // The issuer published a currency retention in the withholding field; it is not tax.
  const retentionRate = rate !== null && !rate.isZero() && RETENTION_NOTE.test(note) ? rate : null;

  if (net === null && gross !== null && rate !== null) {
    net = gross.mul(Rational.ONE.sub(rate));
    warnings.push(
      retentionRate
        ? 'Net cash derived from gross × (1 − retention); issuer did not publish net'
        : 'Net cash derived from gross × (1 − withholding); issuer did not publish net',
    );
  } else if (net === null) {
    warnings.push('Issuer published no net cash amount; USD value unavailable from issuer evidence');
  }
  if (!refund && net !== null && gross !== null && rate !== null && !gross.mul(Rational.ONE.sub(rate)).eq(net)) {
    warnings.push(`Issuer gross/withholding/net are inconsistent (gross ${a.grossCashUsdPerShare}, rate ${a.withholdingTaxRate}, net ${a.netCashUsdPerShare})`);
  }
  if (refund) warnings.push('Withholding refund: passes back tax withheld on an earlier distribution; not a new dividend');

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

  const action = refund ? 'withholding_adjustment' : 'cash_dividend';
  return {
    kind: 'dividend',
    action,
    classifier: ACTION_KIND_SPECS[action].classifier,
    eventId: a.eventId,
    version: a.version,
    netCashUsdPerShare: net,
    retentionRate,
    refundNote: refund ? note.trim() : null,
    warnings,
  };
}

function unitRatio(a: IssuerCorporateAction): Rational | null {
  return a.fromUnits !== null && a.toUnits !== null ? Rational.fromDecimal(a.toUnits).div(Rational.fromDecimal(a.fromUnits)) : null;
}

function classifySplit(t: ObservedTransition, a: IssuerCorporateAction): Classification {
  const before = Rational.fromFloat64(t.before);
  const after = Rational.fromFloat64(t.after);
  const action = actionKindForIssuerType(a.type) as 'forward_split' | 'reverse_split' | 'unit_split';
  const warnings: string[] = [];
  let factor = unitRatio(a);

  if (factor !== null) {
    if (!sameF64(before.mul(factor).toNumber(), t.after)) {
      return unclassified([`${a.type} ${a.eventId} factor ${a.toUnits}:${a.fromUnits} does not reconcile ${t.before} → ${t.after}`], a);
    }
  } else {
    factor = after.div(before);
    warnings.push('Split factor derived from multipliers; issuer published no unit ratio');
  }
  const cash = [a.grossCashUsdPerShare, a.netCashUsdPerShare].find((x) => x !== null && !Rational.fromDecimal(x).isZero());
  if (cash !== undefined) {
    // Scaled UI splits rescale the multiplier, so no holder is left with a fraction to cash out. No real instance exists.
    return unclassified(
      [`${a.type} ${a.eventId} publishes cash ($${cash} per share), i.e. fractional cash in lieu; no real instance exists, so the classifier is unvalidated; not booked`],
      a,
      'unvalidated',
      'cash_in_lieu',
    );
  }
  if (ACTION_KIND_SPECS[action].classifier !== 'validated') {
    return unclassified(
      [`${a.type} ${a.eventId} reconciles as ${a.toUnits ?? '?'}:${a.fromUnits ?? '?'}, but no real ${a.type} has been observed, so the classifier is unvalidated; not booked`],
      a,
      'unvalidated',
    );
  }
  return { kind: 'split', action, classifier: ACTION_KIND_SPECS[action].classifier, eventId: a.eventId, version: a.version, factor, warnings };
}

const RIGHTS_NOTE = /warrant|\brights?\b/i;

/**
 * A `UnitSplit` whose 1:1 ratio cannot explain a multiplier increase, with issuer cash and a note naming
 * warrants or rights, is a rights distribution sold and reinvested (KRAQx 2026-03-26). Any other unit split
 * must reconcile its ratio, like a forward split.
 */
function classifyUnitSplit(t: ObservedTransition, a: IssuerCorporateAction, sameSymbol: readonly IssuerCorporateAction[]): Classification {
  const ratio = unitRatio(a);
  const cash = a.netCashUsdPerShare ?? a.grossCashUsdPerShare;
  if (ratio !== null && ratio.eq(Rational.ONE) && t.after > t.before && cash !== null && Rational.fromDecimal(cash).compare(Rational.ZERO) > 0 && RIGHTS_NOTE.test(a.notes ?? '')) {
    return classifyReinvestedDistribution(t, a, sameSymbol, 'rights_distribution', ACTION_KIND_SPECS.rights_distribution.classifier, [
      `Issuer labelled this UnitSplit, but a ${a.fromUnits}:${a.toUnits} unit ratio cannot change the multiplier; its note reports rights (warrants) sold and the proceeds reinvested`,
    ]);
  }
  return classifySplit(t, a);
}

/**
 * A stock dividend is delivered as a multiplier increase: more units, the same basis spread across them,
 * zero income. It is resolved on the delivered (standing) record; a ratio stated by an earlier, cancelled
 * version is reported, never used.
 */
function classifyStockDividend(t: ObservedTransition, a: IssuerCorporateAction, sameSymbol: readonly IssuerCorporateAction[]): Classification {
  if (!(t.after > t.before)) return unclassified([`StockDividend ${a.eventId} does not increase the multiplier`], a);
  const before = Rational.fromFloat64(t.before);
  const after = Rational.fromFloat64(t.after);
  const warnings: string[] = [];
  let factor = unitRatio(a);
  if (factor !== null) {
    if (!sameF64(before.mul(factor).toNumber(), t.after)) {
      return unclassified([`StockDividend ${a.eventId} ratio ${a.toUnits}:${a.fromUnits} does not reconcile ${t.before} → ${t.after}`], a);
    }
  } else {
    factor = after.div(before);
    warnings.push('Stock dividend factor derived from multipliers; the delivered issuer record publishes no unit ratio');
  }
  for (const earlier of sameSymbol.filter((x) => x.eventId === a.eventId && x.version < a.version && x.fromUnits !== null && x.toUnits !== null)) {
    const stated = unitRatio(earlier)!;
    if (!stated.eq(factor)) {
      warnings.push(`Issuer version ${earlier.version} (${earlier.status}) stated ${earlier.fromUnits}:${earlier.toUnits}; the delivered change is ×${factor.toFixed(6)}; booked on the delivered evidence`);
    }
  }
  return { kind: 'split', action: 'stock_dividend', classifier: ACTION_KIND_SPECS.stock_dividend.classifier, eventId: a.eventId, version: a.version, factor, warnings };
}

/**
 * Value delivered as cash reinvested into the parent (every recorded xStocks spin-off; KRAQx's sold rights).
 * The units added are principal bought with the distributed value, never income. The distributed share of
 * the position is exact from the multipliers; issuer proceeds are kept only when they reconcile with the
 * parent price implied by the same asset's dividends.
 */
function classifyReinvestedDistribution(
  t: ObservedTransition,
  a: IssuerCorporateAction,
  sameSymbol: readonly IssuerCorporateAction[],
  action: 'spin_off' | 'rights_distribution',
  classifier: ClassifierStatus,
  preface: readonly string[],
): Classification {
  if (!(t.after > t.before)) {
    return unclassified([`${a.type} ${a.eventId} does not increase the multiplier; only distributions reinvested into the parent are supported`], a);
  }
  const warnings: string[] = [...preface];
  const distributedFraction = reinvestedDistributionFraction(t.before, t.after);
  const published = a.netCashUsdPerShare ?? a.grossCashUsdPerShare;
  let proceeds = published === null ? null : Rational.fromDecimal(published);

  if (proceeds === null) {
    warnings.push('Issuer published no proceeds amount; the allocation comes from the multipliers alone');
  } else if (a.multiplierOld !== null && a.multiplierNew !== null) {
    const own = impliedReinvestmentPrice(Rational.fromDecimal(a.multiplierOld), Rational.fromDecimal(a.multiplierNew), proceeds);
    const peers = peerImpliedPrices(a, sameSymbol);
    if (own === null) {
      warnings.push('Issuer proceeds cannot be reconciled with the multiplier change; proceeds not used');
      proceeds = null;
    } else if (peers.length < MIN_PEERS_FOR_PRICE_CHECK) {
      warnings.push(`Issuer proceeds imply a parent price of $${own.toFixed(2)}, but fewer than ${MIN_PEERS_FOR_PRICE_CHECK} ${a.symbol} dividends exist to cross-check it`);
    } else {
      const median = peers[Math.floor((peers.length - 1) / 2)]!;
      const ratio = own.div(median);
      if (ratio.compare(IMPLIED_PRICE_MAX_FACTOR) > 0 || ratio.mul(IMPLIED_PRICE_MAX_FACTOR).compare(Rational.ONE) < 0) {
        warnings.push(`Issuer proceeds imply a parent price of $${own.toFixed(2)} against a median of $${median.toFixed(2)} across ${peers.length} ${a.symbol} dividends; proceeds not used`);
        proceeds = null;
      }
    }
  }
  if (a.notes) warnings.push(`Issuer note: ${a.notes}`);

  return { kind: 'distribution', action, classifier, eventId: a.eventId, version: a.version, distributedFraction, proceedsUsdPerShare: proceeds, warnings };
}

/** "Stock Merger 0.5 NYSE:AZN for 1 NASDAQ:AZN (ADR)": quantity, venue and ticker received, for quantity, venue and ticker given up. */
const LISTING_CONVERSION_NOTE = /Stock Merger\s+([\d.]+)\s+([A-Z]+):([A-Z.]+)\s+for\s+([\d.]+)\s+([A-Z]+):([A-Z.]+)(?:\s*\(([^)]+)\))?/i;

/**
 * A `StockMerger` whose note exchanges a listing of a company for another listing of the same company, at a
 * ratio that reconciles exactly, is an identity change of the underlying (AZNx: NASDAQ ADR → NYSE ordinary).
 * A merger into a different company has no real instance and is left unvalidated and unbooked.
 */
function classifyStockMerger(t: ObservedTransition, a: IssuerCorporateAction): Classification {
  const note = LISTING_CONVERSION_NOTE.exec(a.notes ?? '');
  if (!note) {
    return unclassified([`StockMerger ${a.eventId}: no real stock-for-stock merger has been observed, so the classifier is unvalidated; not booked`], a, 'unvalidated');
  }
  const [, receivedQty, receivedVenue, receivedTicker, givenQty, givenVenue, givenTicker, givenForm] = note as unknown as string[];
  if (receivedTicker !== givenTicker) {
    return unclassified(
      [`StockMerger ${a.eventId} converts ${givenTicker} into ${receivedTicker}, a different company; stock-for-stock mergers are unvalidated; not booked`],
      a,
      'unvalidated',
    );
  }
  const factor = Rational.fromDecimal(receivedQty!).div(Rational.fromDecimal(givenQty!));
  const stated = unitRatio(a);
  if ((stated !== null && !stated.eq(factor)) || !sameF64(Rational.fromFloat64(t.before).mul(factor).toNumber(), t.after)) {
    return unclassified([`StockMerger ${a.eventId} ratio ${receivedQty} for ${givenQty} does not reconcile ${t.before} → ${t.after}`], a);
  }
  return {
    kind: 'identity_change',
    action: 'identity_change',
    classifier: ACTION_KIND_SPECS.identity_change.classifier,
    eventId: a.eventId,
    version: a.version,
    factor,
    fromUnderlying: `${givenVenue}:${givenTicker}${givenForm ? ` (${givenForm})` : ''}`,
    toUnderlying: `${receivedVenue}:${receivedTicker}`,
    warnings: [
      `Issuer labelled this StockMerger; its note exchanges ${givenQty} ${givenVenue}:${givenTicker}${givenForm ? ` (${givenForm})` : ''} for ${receivedQty} ${receivedVenue}:${receivedTicker} of the same company: an identity change of the underlying, not a merger`,
    ],
  };
}
