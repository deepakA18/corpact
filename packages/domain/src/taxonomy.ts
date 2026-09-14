import type { CorporateActionType } from './actions';

/**
 * The explicit corporate-action taxonomy. Every classification names one of these kinds,
 * whether or not the ledger books it. Counts and validation status come from the recorded
 * issuer data and chain scans in docs/findings/corporate-actions-census.md (ADR-0005).
 */
export const ACTION_KINDS = [
  'cash_dividend',
  'withholding_adjustment',
  'stock_dividend',
  'cash_and_stock_dividend',
  'forward_split',
  'reverse_split',
  'unit_split',
  'cash_in_lieu',
  'spin_off',
  'rights_distribution',
  'stock_merger',
  'cash_merger',
  'mixed_merger',
  'identity_change',
  'redemption',
  'delisting',
  'seizure',
  'unknown',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type ActionCategory = 'income' | 'basis' | 'identity' | 'termination' | 'custody' | 'unknown';

/** What the ledger does with an evidenced instance, as implemented today. */
export type LedgerTreatment =
  /** Units added are income; the protected floor is unchanged. */
  | 'income'
  /** Units rescaled by a verified factor; zero income; the floor scales with them. */
  | 'quantity_basis'
  /** Units added are principal carrying allocated basis; zero income; the floor scales. */
  | 'basis_allocation'
  /** Same economic position under a new label or underlying listing. */
  | 'identity'
  /** The position ends; basis leaves as cash. */
  | 'termination'
  /** Units moved by the issuer's delegate, not by the holder. */
  | 'custody_transfer'
  /** Recognised as this kind, but not booked: shown as an unclassified adjustment with conversion disabled. */
  | 'not_booked';

/**
 * - `validated`: the classifier is exercised against real recorded instances and locked by regression fixtures.
 * - `unvalidated`: the classifier exists but no real instance has confirmed it; never presented as confirmed.
 * - `not_built`: recognised in the taxonomy only; always routes to an unclassified adjustment.
 */
export type ClassifierStatus = 'validated' | 'unvalidated' | 'not_built';

export interface ActionKindSpec {
  kind: ActionKind;
  label: string;
  category: ActionCategory;
  treatment: LedgerTreatment;
  classifier: ClassifierStatus;
  /** Real instances in the recorded issuer data (latest event versions) or on-chain scans, 2026-09-14. */
  realInstances: number;
  evidence: string;
}

const spec = (s: ActionKindSpec) => s;

export const ACTION_KIND_SPECS: Readonly<Record<ActionKind, ActionKindSpec>> = {
  cash_dividend: spec({
    kind: 'cash_dividend',
    label: 'Cash dividend',
    category: 'income',
    treatment: 'income',
    classifier: 'validated',
    realInstances: 642,
    evidence: '628 of 654 recorded multiplier changes confirmed as cash dividends; special dividends (0 labelled) route here',
  }),
  withholding_adjustment: spec({
    kind: 'withholding_adjustment',
    label: 'Withholding refund',
    category: 'income',
    treatment: 'income',
    classifier: 'validated',
    realInstances: 2,
    evidence:
      'LINx and NVOx pass back wrongly withheld tax as a CashDividend with gross 0 and positive net; recognised from the issuer note, booked like the dividend it corrects, and distinguishable by kind',
  }),
  stock_dividend: spec({
    kind: 'stock_dividend',
    label: 'Stock dividend',
    category: 'basis',
    treatment: 'quantity_basis',
    classifier: 'validated',
    realInstances: 1,
    evidence:
      'SCCOx: six versions across both issuer feeds (scheduled 1:1.012, cancelled "Will be a cash flow", rescheduled, delivered ×1.0153); resolved on the delivered record',
  }),
  cash_and_stock_dividend: spec({
    kind: 'cash_and_stock_dividend',
    label: 'Cash and stock dividend',
    category: 'basis',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'Defined in the issuer enum; never used. Recognised and labelled unvalidated; never booked',
  }),
  forward_split: spec({
    kind: 'forward_split',
    label: 'Forward split',
    category: 'basis',
    treatment: 'quantity_basis',
    classifier: 'validated',
    realInstances: 9,
    evidence: 'NFLXx 10:1, VUGx 6:1, KLACx 10:1, CRWDx 4:1, … reconciled to issuer unit ratios',
  }),
  reverse_split: spec({
    kind: 'reverse_split',
    label: 'Reverse split',
    category: 'basis',
    treatment: 'quantity_basis',
    classifier: 'validated',
    realInstances: 1,
    evidence: 'HONx 2:1; fractional cash-in-lieu has 0 instances',
  }),
  unit_split: spec({
    kind: 'unit_split',
    label: 'Unit split',
    category: 'basis',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'The only UnitSplit-labelled record (KRAQx) is a mislabelled rights sale; no true unit split has occurred',
  }),
  cash_in_lieu: spec({
    kind: 'cash_in_lieu',
    label: 'Fractional cash in lieu',
    category: 'basis',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence:
      'No split record publishes cash. A Scaled UI split rescales the multiplier, so raw token amounts never become fractional; a split carrying cash is recognised, labelled unvalidated and never booked',
  }),
  spin_off: spec({
    kind: 'spin_off',
    label: 'Spin-off',
    category: 'basis',
    treatment: 'basis_allocation',
    classifier: 'validated',
    realInstances: 6,
    evidence:
      'GMEx, HONx ×2, DFDVx, OPENx, CMCSAx; all delivered as cash reinvested through the parent multiplier; distributed share = ΔM ÷ M_new; HONx proceeds reconcile within 3% of its dividend-implied price',
  }),
  rights_distribution: spec({
    kind: 'rights_distribution',
    label: 'Rights distribution',
    category: 'basis',
    treatment: 'basis_allocation',
    classifier: 'validated',
    realInstances: 1,
    evidence:
      'KRAQx: warrants sold for $0.1356647/share and reinvested, labelled UnitSplit (three versions, one cancelled for a fee miscalculation); exercised or lapsed rights: 0, unvalidated',
  }),
  stock_merger: spec({
    kind: 'stock_merger',
    label: 'Stock-for-stock merger',
    category: 'identity',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'The only StockMerger-labelled record (AZNx) is a listing conversion of the same company, classified as an identity change; no merger into another company has occurred',
  }),
  cash_merger: spec({
    kind: 'cash_merger',
    label: 'Cash merger',
    category: 'termination',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'Defined in the issuer enum; never used. Recognised and labelled unvalidated; never booked',
  }),
  mixed_merger: spec({
    kind: 'mixed_merger',
    label: 'Stock and cash merger',
    category: 'termination',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'Defined in the issuer enum; never used. Recognised and labelled unvalidated; never booked',
  }),
  identity_change: spec({
    kind: 'identity_change',
    label: 'Identity change',
    category: 'identity',
    treatment: 'identity',
    classifier: 'validated',
    realInstances: 1,
    evidence:
      'AZNx: NASDAQ ADR → NYSE ordinary share 2:1, labelled StockMerger and "ReverseSplit". Name or ticker changes (NameChange): 0 instances, unvalidated',
  }),
  redemption: spec({
    kind: 'redemption',
    label: 'Redemption or wrapper discontinuation',
    category: 'termination',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'No record uses Redemption or redemptionPriceUsd; 4 assets are marked halted without termination. Recognised and labelled unvalidated; never booked',
  }),
  delisting: spec({
    kind: 'delisting',
    label: 'Delisting or worthless removal',
    category: 'termination',
    treatment: 'not_booked',
    classifier: 'unvalidated',
    realInstances: 0,
    evidence: 'WorthlessRemoval is defined in the issuer enum; never used. Recognised and labelled unvalidated; never booked',
  }),
  seizure: spec({
    kind: 'seizure',
    label: 'Permanent-delegate transfer',
    category: 'custody',
    treatment: 'not_booked',
    classifier: 'not_built',
    realInstances: 0,
    evidence:
      'One delegate on all 832 mints; its full history (1,685 transactions) has no transfer or burn out of another owner. Left not built: see ADR-0006',
  }),
  unknown: spec({
    kind: 'unknown',
    label: 'Unknown',
    category: 'unknown',
    treatment: 'not_booked',
    classifier: 'not_built',
    realInstances: 0,
    evidence: 'No issuer action matches, or the issuer type is Unknown',
  }),
};

const ISSUER_TYPE_TO_KIND: Readonly<Record<CorporateActionType, ActionKind>> = {
  CashDividend: 'cash_dividend',
  StockDividend: 'stock_dividend',
  CashAndStockDividend: 'cash_and_stock_dividend',
  ForwardSplit: 'forward_split',
  ReverseSplit: 'reverse_split',
  UnitSplit: 'unit_split',
  SpinOff: 'spin_off',
  RightsDistribution: 'rights_distribution',
  StockMerger: 'stock_merger',
  CashMerger: 'cash_merger',
  StockAndCashMerger: 'mixed_merger',
  NameChange: 'identity_change',
  Redemption: 'redemption',
  WorthlessRemoval: 'delisting',
  Unknown: 'unknown',
};

/** The kind an issuer type claims. A claim, not a classification: evidence may contradict it (KRAQx, AZNx). */
export const actionKindForIssuerType = (type: CorporateActionType): ActionKind => ISSUER_TYPE_TO_KIND[type];
