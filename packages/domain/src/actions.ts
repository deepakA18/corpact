import type { Rational } from './rational';
import type { ActionKind, ClassifierStatus } from './taxonomy';

/** Mirrors the issuer's published `caType` enum (xStocks OpenAPI v2, verified 2026-09-13). */
export const CORPORATE_ACTION_TYPES = [
  'ReverseSplit',
  'ForwardSplit',
  'UnitSplit',
  'CashDividend',
  'StockDividend',
  'CashAndStockDividend',
  'SpinOff',
  'CashMerger',
  'StockMerger',
  'StockAndCashMerger',
  'Redemption',
  'NameChange',
  'WorthlessRemoval',
  'RightsDistribution',
  'Unknown',
] as const;
export type CorporateActionType = (typeof CORPORATE_ACTION_TYPES)[number];

export const CORPORATE_ACTION_STATUSES = ['Initial', 'Corrected', 'Cancelled', 'Scheduled'] as const;
export type CorporateActionStatus = (typeof CORPORATE_ACTION_STATUSES)[number];

/**
 * One version of an issuer corporate-action record. Numeric fields stay as the
 * issuer's exact decimal strings; they are parsed to Rational only where used.
 */
export interface IssuerCorporateAction {
  eventId: string;
  version: number;
  symbol: string;
  type: CorporateActionType;
  status: CorporateActionStatus;
  effectiveAt: Date | null;
  createdAt: Date;
  multiplierOld: string | null;
  multiplierNew: string | null;
  /** Per underlying share. */
  grossCashUsdPerShare: string | null;
  /** Per underlying share, after withholding - what was actually reinvested. */
  netCashUsdPerShare: string | null;
  withholdingTaxRate: string | null;
  fromUnits: string | null;
  toUnits: string | null;
  notes: string | null;
}

/** An activated Scaled UI multiplier change, with f64 values exactly as stored on the mint. */
export interface ObservedTransition {
  mint: string;
  symbol: string;
  before: number;
  after: number;
  activatedAt: Date;
}

/**
 * What an activated transition was judged to be. `kind` is how the ledger treats it; `action` is the
 * taxonomy kind; `classifier` says whether this judgement is validated against real instances.
 */
export type Classification =
  | {
      kind: 'dividend';
      /** `withholding_adjustment`: the issuer passes back tax withheld on an earlier distribution (LINx, NVOx). */
      action: 'cash_dividend' | 'withholding_adjustment';
      classifier: ClassifierStatus;
      eventId: string;
      version: number;
      /** Null when the issuer published no usable cash amount; USD income is then unknown, not zero. */
      netCashUsdPerShare: Rational | null;
      /** A currency retention the issuer published in its withholding-rate field (LINx, ETNx, ASMLx). Not tax. */
      retentionRate: Rational | null;
      /** For a withholding refund: the issuer's own explanation. */
      refundNote: string | null;
      warnings: string[];
    }
  | {
      /** Units rescaled by a verified factor; zero income. Stock dividends are delivered the same way. */
      kind: 'split';
      action: 'forward_split' | 'reverse_split' | 'unit_split' | 'stock_dividend';
      classifier: ClassifierStatus;
      eventId: string;
      version: number;
      factor: Rational;
      warnings: string[];
    }
  | {
      /** Value distributed to holders and reinvested into the parent (spin-offs, sold rights). Principal, not income. */
      kind: 'distribution';
      action: 'spin_off' | 'rights_distribution';
      classifier: ClassifierStatus;
      eventId: string;
      version: number;
      /** Share of the position's value that came from the distribution: (M_new − M_old) ÷ M_new. Needs no price. */
      distributedFraction: Rational;
      /** Issuer cash per underlying share for the distributed value, when published and plausible; otherwise null. */
      proceedsUsdPerShare: Rational | null;
      warnings: string[];
    }
  | {
      /** Same economic position, new underlying listing or form (AZNx: NASDAQ ADR → NYSE ordinary share). */
      kind: 'identity_change';
      action: 'identity_change';
      classifier: ClassifierStatus;
      eventId: string;
      version: number;
      /** New units per old unit. */
      factor: Rational;
      fromUnderlying: string | null;
      toUnderlying: string | null;
      warnings: string[];
    }
  | {
      kind: 'unclassified';
      /** The kind the matched issuer record claims, or 'unknown' when none matches. Recognised, not booked. */
      action: ActionKind;
      classifier: ClassifierStatus;
      eventId: string | null;
      version: number | null;
      reasons: string[];
    };
