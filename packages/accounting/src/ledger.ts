import {
  Rational,
  displayedQuantity,
  unitScale,
  type ActionKind,
  type Classification,
  type ObservedTransition,
  type ScaledUsdPrice,
} from '@corpact/domain';

/** An issuer-implied reinvestment price further than this from market is not trusted for valuation. */
const ISSUER_PRICE_TOLERANCE = Rational.of(1n, 5n);

export type LedgerEvent =
  /** Raw units entering the position: purchase, deposit, or transfer in. */
  | { type: 'deposit'; at: Date; raw: bigint }
  /** Raw units leaving the position: external sale or transfer out. */
  | { type: 'withdrawal'; at: Date; raw: bigint }
  | {
      type: 'transition';
      transition: ObservedTransition;
      classification: Classification;
      /** Contemporaneous market price: cross-checks issuer cash, and values the event when that is missing or fails. */
      marketPriceScaled?: ScaledUsdPrice;
    };

export type DividendValuation = 'issuer_net_cash' | 'market_estimate';

export type LedgerEntry =
  | { type: 'deposit'; at: Date; raw: bigint; quantity: Rational }
  | { type: 'withdrawal'; at: Date; raw: bigint; quantity: Rational }
  | {
      type: 'dividend';
      at: Date;
      action: 'cash_dividend' | 'withholding_adjustment';
      eventId: string;
      quantity: Rational;
      /** Null means unknown — never zero. */
      usd: Rational | null;
      valuation: DividendValuation | null;
      warnings: string[];
    }
  | {
      type: 'split';
      at: Date;
      action: 'forward_split' | 'reverse_split' | 'unit_split' | 'stock_dividend';
      eventId: string;
      factor: Rational;
      /** Displayed units added or removed. Never income. */
      quantityDelta: Rational;
    }
  | {
      /** Same position, new underlying listing or form; units rescaled by the conversion ratio. */
      type: 'identity_change';
      at: Date;
      action: 'identity_change';
      eventId: string;
      factor: Rational;
      quantityDelta: Rational;
      fromUnderlying: string | null;
      toUnderlying: string | null;
    }
  | {
      /** Distributed value reinvested into the position: principal with allocated basis, not income. */
      type: 'distribution';
      at: Date;
      action: 'spin_off' | 'rights_distribution';
      eventId: string;
      quantityDelta: Rational;
      distributedFraction: Rational;
      /** Shares held × issuer proceeds per share, when issuer proceeds are usable. Not income. */
      proceedsUsd: Rational | null;
      warnings: string[];
    }
  | { type: 'unclassified_adjustment'; at: Date; action: ActionKind; quantityDelta: Rational; reasons: string[] };

export interface PositionState {
  readonly mint: string;
  readonly decimals: number;
  readonly raw: bigint;
  /** The mint's active multiplier, exactly as stored (f64). */
  readonly multiplier: number;
  /** Protected stock-quantity floor P, in displayed units. */
  readonly floor: Rational;
  readonly entries: readonly LedgerEntry[];
}

export class LedgerInvariantError extends Error {
  override name = 'LedgerInvariantError';
}

export function openPosition(mint: string, decimals: number, multiplier: number): PositionState {
  unitScale(decimals);
  if (!(multiplier > 0) || !Number.isFinite(multiplier)) {
    throw new LedgerInvariantError(`Invalid opening multiplier ${multiplier}`);
  }
  return { mint, decimals, raw: 0n, multiplier, floor: Rational.ZERO, entries: [] };
}

/** Pure reducer: returns a new state and never mutates its input. */
export function applyEvent(state: PositionState, event: LedgerEvent): PositionState {
  switch (event.type) {
    case 'deposit':
      return deposit(state, event.at, event.raw);
    case 'withdrawal':
      return withdraw(state, event.at, event.raw);
    case 'transition':
      return transition(state, event);
  }
}

export const replay = (initial: PositionState, events: readonly LedgerEvent[]): PositionState =>
  events.reduce(applyEvent, initial);

function deposit(s: PositionState, at: Date, raw: bigint): PositionState {
  if (raw <= 0n) throw new LedgerInvariantError(`Deposit must be positive, got ${raw}`);
  const quantity = displayedQuantity(raw, s.decimals, Rational.fromFloat64(s.multiplier));
  return {
    ...s,
    raw: s.raw + raw,
    floor: s.floor.add(quantity),
    entries: [...s.entries, { type: 'deposit', at, raw, quantity }],
  };
}

function withdraw(s: PositionState, at: Date, raw: bigint): PositionState {
  if (raw <= 0n) throw new LedgerInvariantError(`Withdrawal must be positive, got ${raw}`);
  if (raw > s.raw) throw new LedgerInvariantError(`Withdrawal ${raw} exceeds position ${s.raw}`);
  const remaining = s.raw - raw;
  // Removes the same proportion of principal and unharvested income; historical income is untouched.
  const floor = remaining === 0n ? Rational.ZERO : s.floor.mul(Rational.of(remaining, s.raw));
  const quantity = displayedQuantity(raw, s.decimals, Rational.fromFloat64(s.multiplier));
  return { ...s, raw: remaining, floor, entries: [...s.entries, { type: 'withdrawal', at, raw, quantity }] };
}

function transition(s: PositionState, e: Extract<LedgerEvent, { type: 'transition' }>): PositionState {
  const t = e.transition;
  if (t.mint !== s.mint) throw new LedgerInvariantError(`Transition for ${t.mint} applied to position in ${s.mint}`);
  if (t.before !== s.multiplier) {
    // The trap: a scheduled activation happens with no account write. Missing one must be loud.
    throw new LedgerInvariantError(
      `Transition starts at multiplier ${t.before} but position is at ${s.multiplier}; a transition was missed or replayed out of order`,
    );
  }
  const next = { ...s, multiplier: t.after };
  if (s.raw === 0n) return next;

  const at = t.activatedAt;
  const before = Rational.fromFloat64(t.before);
  const after = Rational.fromFloat64(t.after);
  const qBefore = displayedQuantity(s.raw, s.decimals, before);
  const qAfter = displayedQuantity(s.raw, s.decimals, after);
  const c = e.classification;

  switch (c.kind) {
    case 'dividend': {
      const quantity = qAfter.sub(qBefore);
      if (quantity.isNegative() || quantity.isZero()) {
        throw new LedgerInvariantError(`Dividend ${c.eventId} produced non-positive quantity ${quantity}`);
      }
      const warnings = [...c.warnings];
      const market = e.marketPriceScaled;
      let usd: Rational | null = null;
      let valuation: DividendValuation | null = null;
      if (c.netCashUsdPerShare !== null) {
        // Shares held at the event × net cash per share reinvested by the issuer.
        usd = qBefore.mul(c.netCashUsdPerShare);
        valuation = 'issuer_net_cash';
        const implied = usd.div(quantity);
        if (market !== undefined && implied.sub(market).abs().compare(market.mul(ISSUER_PRICE_TOLERANCE)) > 0) {
          // Issuer cash that does not reconcile with the shares delivered (STRCx 2025-11-30 implies ~$953,728/share).
          warnings.push(
            `Issuer net cash implies reinvestment at $${implied.toFixed(2)}/share against market $${market.toFixed(2)}; valued at market`,
          );
          usd = quantity.mul(market);
          valuation = 'market_estimate';
        }
      } else if (market !== undefined) {
        usd = quantity.mul(market);
        valuation = 'market_estimate';
      }
      // Floor unchanged: the new exposure is income, not principal.
      return {
        ...next,
        entries: [...s.entries, { type: 'dividend', at, action: c.action, eventId: c.eventId, quantity, usd, valuation, warnings }],
      };
    }
    case 'split':
      return {
        ...next,
        floor: s.floor.mul(c.factor),
        entries: [...s.entries, { type: 'split', at, action: c.action, eventId: c.eventId, factor: c.factor, quantityDelta: qAfter.sub(qBefore) }],
      };
    case 'identity_change':
      // The same holding in a new form: principal and earlier dividend exposure rescale together, like a split.
      return {
        ...next,
        floor: s.floor.mul(c.factor),
        entries: [
          ...s.entries,
          {
            type: 'identity_change',
            at,
            action: c.action,
            eventId: c.eventId,
            factor: c.factor,
            quantityDelta: qAfter.sub(qBefore),
            fromUnderlying: c.fromUnderlying,
            toUnderlying: c.toUnderlying,
          },
        ],
      };
    case 'distribution':
      // The added units were bought with distributed value: principal, so the floor scales and nothing becomes available.
      return {
        ...next,
        floor: s.floor.mul(after.div(before)),
        entries: [
          ...s.entries,
          {
            type: 'distribution',
            at,
            action: c.action,
            eventId: c.eventId,
            quantityDelta: qAfter.sub(qBefore),
            distributedFraction: c.distributedFraction,
            proceedsUsd: c.proceedsUsdPerShare === null ? null : qBefore.mul(c.proceedsUsdPerShare),
            warnings: c.warnings,
          },
        ],
      };
    case 'unclassified':
      // Scale the floor with the multiplier so an unexplained change makes nothing newly available.
      return {
        ...next,
        floor: s.floor.mul(after.div(before)),
        entries: [...s.entries, { type: 'unclassified_adjustment', at, action: c.action, quantityDelta: qAfter.sub(qBefore), reasons: c.reasons }],
      };
  }
}

export interface PositionView {
  quantity: Rational;
  floor: Rational;
  availableQuantity: Rational;
  protectedRaw: bigint;
  maximumHarvestRaw: bigint;
  dividendIncomeUsd: Rational;
  unvaluedDividends: number;
}

export function positionView(s: PositionState): PositionView {
  const m = Rational.fromFloat64(s.multiplier);
  const quantity = displayedQuantity(s.raw, s.decimals, m);
  // ceil: rounding always favours keeping the holder's principal.
  const protectedRaw = s.floor.mul(Rational.of(unitScale(s.decimals))).div(m).ceil();
  const maximumHarvestRaw = s.raw > protectedRaw ? s.raw - protectedRaw : 0n;

  let dividendIncomeUsd = Rational.ZERO;
  let unvaluedDividends = 0;
  for (const entry of s.entries) {
    if (entry.type !== 'dividend') continue;
    if (entry.usd === null) unvaluedDividends++;
    else dividendIncomeUsd = dividendIncomeUsd.add(entry.usd);
  }

  return {
    quantity,
    floor: s.floor,
    availableQuantity: Rational.max(Rational.ZERO, quantity.sub(s.floor)),
    protectedRaw,
    maximumHarvestRaw,
    dividendIncomeUsd,
    unvaluedDividends,
  };
}
