import type { Rational } from './rational';

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
  /** Per underlying share, after withholding — what was actually reinvested. */
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

export type Classification =
  | {
      kind: 'dividend';
      eventId: string;
      version: number;
      /** Null when the issuer published no usable cash amount; USD income is then unknown, not zero. */
      netCashUsdPerShare: Rational | null;
      warnings: string[];
    }
  | { kind: 'split'; eventId: string; version: number; factor: Rational; warnings: string[] }
  | { kind: 'unclassified'; reasons: string[] };
