/**
 * The Corpact API contract, written once. The API validates requests with these
 * schemas and publishes them as OpenAPI; this package derives its types from them;
 * a contract test checks real responses against them. They cannot drift silently.
 *
 * Conventions: raw amounts, slots and every money or quantity value are decimal
 * strings (never JS numbers); timestamps are ISO-8601 strings; unknown is null.
 */

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const int = { type: 'integer' } as const;
const bool = { type: 'boolean' } as const;
const strings = { type: 'array', items: str } as const;
const DECIMAL = '^-?\\d+(\\.\\d+)?$';
const decimal = { type: 'string', pattern: DECIMAL } as const;
const nullableDecimal = { type: ['string', 'null'], pattern: DECIMAL } as const;

export const OWNER_PATTERN = '^[1-9A-HJ-NP-Za-km-z]{32,44}$';
const owner = { type: 'string', pattern: OWNER_PATTERN, description: 'Solana wallet address (base58)' } as const;

export const errorResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: str,
    code: {
      type: 'string',
      enum: ['missing_scope', 'wallet_not_registered', 'wallet_quota_exceeded'],
      description: 'Machine-readable reason, when a client should branch on it',
    },
  },
} as const;

/** Stamped on every data response: synthetic demo data must never pass for real history. */
export const dataset = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'description'],
  properties: {
    kind: { type: 'string', enum: ['mainnet', 'synthetic'], description: 'mainnet: real chain history. synthetic: generated demo data on a local network' },
    description: { type: ['string', 'null'] },
  },
} as const;

export const healthResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'dataset'],
  properties: { ok: { type: 'boolean', const: true }, dataset },
} as const;

export const asset = {
  type: 'object',
  additionalProperties: false,
  required: ['mint', 'symbol', 'name', 'decimals', 'registrySource', 'verified', 'verificationError', 'verifiedSlot', 'capabilities'],
  properties: {
    mint: str,
    symbol: str,
    name: nullableStr,
    decimals: { type: ['integer', 'null'] },
    registrySource: { type: 'string', enum: ['fixtures', 'live'] },
    verified: bool,
    verificationError: nullableStr,
    verifiedSlot: nullableDecimal,
    capabilities: {
      type: 'object',
      additionalProperties: false,
      required: ['tracking', 'manualConversion', 'automation'],
      properties: { tracking: bool, manualConversion: bool, automation: bool },
    },
  },
} as const;

export const assetsResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['assets'],
  properties: { assets: { type: 'array', items: asset } },
} as const;

export const syncStatus = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'status', 'requestedAt', 'startedAt', 'finishedAt', 'asOfSlot', 'asOfTime', 'transactionsFetched', 'gaps', 'error', 'progress'],
  properties: {
    owner: str,
    status: { type: 'string', enum: ['queued', 'running', 'complete', 'partial', 'failed'] },
    requestedAt: str,
    startedAt: nullableStr,
    finishedAt: nullableStr,
    asOfSlot: nullableDecimal,
    asOfTime: nullableStr,
    transactionsFetched: int,
    gaps: strings,
    error: nullableStr,
    progress: {
      type: 'object',
      additionalProperties: false,
      properties: { phase: str, done: int, total: int },
    },
  },
} as const;

export const syncStatusResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['sync'],
  properties: { sync: { anyOf: [syncStatus, { type: 'null' }] } },
} as const;

export const syncRequestBody = {
  type: 'object',
  additionalProperties: false,
  required: ['owner'],
  properties: { owner },
} as const;

export const syncRequestResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'registration', 'status', 'job'],
  properties: {
    owner: str,
    registration: {
      type: 'string',
      enum: ['registered', 'already_registered'],
      description: "Whether this request added the wallet to the caller's tenant",
    },
    status: { type: 'string', enum: ['queued', 'running'] },
    job: { type: 'string', enum: ['enqueued', 'already_pending'] },
  },
} as const;

export const walletsResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'maxWallets', 'wallets'],
  properties: {
    tenant: str,
    maxWallets: int,
    wallets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['owner', 'addedAt'],
        properties: { owner: str, addedAt: str },
      },
    },
  },
} as const;

export const position = {
  type: 'object',
  additionalProperties: false,
  required: [
    'mint', 'symbol', 'name', 'status', 'decimals', 'rawBalance', 'quantity', 'protectedQuantity', 'availableQuantity',
    'maximumConvertibleRaw', 'dividendIncomeUsd', 'dividendEvents', 'unvaluedDividendEvents', 'unclassifiedAdjustments',
    'reconciled', 'replayComplete', 'conversionDisabledReasons', 'coverage', 'computedAt',
  ],
  properties: {
    mint: str,
    symbol: str,
    name: nullableStr,
    status: { type: 'string', enum: ['complete', 'partial', 'unsupported'] },
    decimals: int,
    rawBalance: decimal,
    quantity: decimal,
    protectedQuantity: { ...nullableDecimal, description: 'Protected stock-quantity floor; null when replay did not complete' },
    availableQuantity: { ...nullableDecimal, description: 'Dividend-attributed exposure convertible now; null when replay did not complete' },
    maximumConvertibleRaw: nullableDecimal,
    dividendIncomeUsd: { ...decimal, description: 'Sum of valued dividend events only; unvalued events are counted separately' },
    dividendEvents: int,
    unvaluedDividendEvents: int,
    unclassifiedAdjustments: int,
    reconciled: bool,
    replayComplete: bool,
    conversionDisabledReasons: strings,
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end', 'startSlot', 'endSlot', 'gaps'],
      properties: { start: nullableStr, end: nullableStr, startSlot: nullableDecimal, endSlot: decimal, gaps: strings },
    },
    computedAt: str,
  },
} as const;

export const portfolioResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'dataset', 'asOfSlot', 'asOfTime', 'dataStatus', 'valuationStatus', 'coverage', 'totals', 'positions'],
  properties: {
    owner: str,
    dataset,
    asOfSlot: nullableDecimal,
    asOfTime: nullableStr,
    dataStatus: { anyOf: [syncStatus, { type: 'null' }] },
    valuationStatus: str,
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: ['trackingStart', 'complete', 'partialPositions', 'unsupportedPositions'],
      properties: { trackingStart: nullableStr, complete: bool, partialPositions: int, unsupportedPositions: int },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['dividendIncomeUsd', 'unvaluedDividendEvents', 'unclassifiedAdjustments', 'availableToConvert', 'usdcReceived'],
      properties: {
        dividendIncomeUsd: decimal,
        unvaluedDividendEvents: int,
        unclassifiedAdjustments: int,
        availableToConvert: {
          type: 'object',
          additionalProperties: false,
          required: ['usd', 'reason', 'positionsWithAvailable'],
          properties: { usd: { type: 'null' }, reason: str, positionsWithAvailable: int },
        },
        usdcReceived: {
          type: 'object',
          additionalProperties: false,
          required: ['usd', 'reason'],
          properties: { usd: decimal, reason: str },
        },
      },
    },
    positions: { type: 'array', items: position },
  },
} as const;

const entryKind = { type: 'string', enum: ['dividend', 'split', 'unclassified_adjustment'] } as const;
const valuation = { type: ['string', 'null'], enum: ['issuer_net_cash', 'market_estimate', null] } as const;

/** One append-only journal row. A reversal repeats the values of the recognition it cancels. */
export const journalEntry = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'recordedAt', 'entryType', 'kind', 'effectiveAt', 'quantity', 'splitFactor', 'usd', 'valuation',
    'issuerEventId', 'issuerRevision', 'reversesId', 'changeReason', 'changeDetail',
  ],
  properties: {
    id: str,
    recordedAt: str,
    entryType: { type: 'string', enum: ['recognition', 'reversal'] },
    kind: entryKind,
    effectiveAt: str,
    quantity: decimal,
    splitFactor: nullableDecimal,
    usd: nullableDecimal,
    valuation,
    issuerEventId: nullableStr,
    issuerRevision: { type: ['integer', 'null'] },
    reversesId: nullableStr,
    changeReason: {
      type: 'string',
      enum: ['initial', 'issuer_correction', 'balance_history_changed', 'valuation_changed', 'no_longer_applicable'],
    },
    changeDetail: nullableStr,
  },
} as const;

export const incomeEntry = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'mint', 'symbol', 'kind', 'effectiveAt', 'quantity', 'quantityDisplay', 'splitFactor', 'usd', 'valuation', 'warnings', 'reasons', 'headline', 'revision', 'correctedAt'],
  properties: {
    id: str,
    mint: str,
    symbol: str,
    kind: entryKind,
    effectiveAt: str,
    quantity: { ...decimal, description: 'Exact decimal' },
    quantityDisplay: { ...decimal, description: "Rounded toward zero at the mint's decimals" },
    splitFactor: nullableDecimal,
    usd: { ...nullableDecimal, description: 'Null means unknown, never zero' },
    valuation,
    warnings: strings,
    reasons: strings,
    headline: str,
    revision: { type: 'integer', minimum: 1, description: 'How many times this entry has been recognized; above 1 means it was corrected' },
    correctedAt: { ...nullableStr, description: 'When the entry was last corrected, if ever' },
  },
} as const;

export const incomeResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'dataset', 'entries', 'nextOffset'],
  properties: {
    owner: str,
    dataset,
    entries: { type: 'array', items: incomeEntry },
    nextOffset: { type: ['integer', 'null'] },
  },
} as const;

export const incomeDetail = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'owner', 'mint', 'kind', 'quantity', 'quantityDisplay', 'symbol', 'usd', 'valuation', 'warnings', 'reasons', 'headline',
    'effectiveAt', 'revision', 'correctedAt', 'history', 'evidence',
  ],
  properties: {
    id: str,
    owner: str,
    mint: str,
    kind: entryKind,
    quantity: decimal,
    quantityDisplay: decimal,
    symbol: str,
    usd: nullableDecimal,
    valuation,
    warnings: strings,
    reasons: strings,
    headline: str,
    effectiveAt: str,
    revision: { type: 'integer', minimum: 1 },
    correctedAt: nullableStr,
    history: { type: 'array', items: journalEntry, description: 'Every recognition and reversal of this entry, oldest first' },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['chain', 'classification', 'issuerRecord'],
      properties: {
        chain: {
          type: 'object',
          additionalProperties: false,
          required: ['updateSignature', 'explorerUrl', 'observedSlot', 'instructionPath', 'scheduledAt', 'effectiveAt', 'immediate', 'status', 'multiplierBefore', 'multiplierAfter'],
          properties: {
            updateSignature: str,
            explorerUrl: str,
            observedSlot: decimal,
            instructionPath: { type: 'array', items: int },
            scheduledAt: str,
            effectiveAt: str,
            immediate: bool,
            status: { type: 'string', enum: ['scheduled', 'active', 'superseded', 'orphaned'] },
            multiplierBefore: {
              type: 'object',
              additionalProperties: false,
              required: ['bits', 'exact'],
              properties: { bits: nullableStr, exact: nullableDecimal },
            },
            multiplierAfter: {
              type: 'object',
              additionalProperties: false,
              required: ['bits', 'exact'],
              properties: { bits: str, exact: decimal },
            },
          },
        },
        classification: {
          type: 'object',
          additionalProperties: false,
          required: ['result', 'reasons'],
          properties: {
            result: { type: 'string', enum: ['dividend', 'split', 'unclassified', 'pending'] },
            classifierVersion: str,
            issuerEventId: nullableStr,
            issuerRevision: { type: ['integer', 'null'] },
            netCashPerShare: nullableDecimal,
            reasons: strings,
            warnings: strings,
          },
        },
        issuerRecord: {
          anyOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'evidenceSha256', 'record'],
              properties: {
                source: { type: 'string', enum: ['fixtures', 'live'] },
                evidenceSha256: str,
                record: { type: 'object' },
              },
            },
            { type: 'null' },
          ],
        },
      },
    },
  },
} as const;

export const journalResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'dataset', 'entries', 'nextOffset'],
  properties: {
    owner: str,
    dataset,
    entries: {
      type: 'array',
      items: {
        ...journalEntry,
        required: [...journalEntry.required, 'mint', 'symbol'],
        properties: { ...journalEntry.properties, mint: str, symbol: str },
      },
    },
    nextOffset: { type: ['integer', 'null'] },
  },
} as const;

const yieldExclusion = {
  description: 'Why the yield figure is withheld; null when it is claimed',
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', enum: ['position_incomplete', 'coverage_after_window_start', 'no_holdings', 'missing_net_cash'] },
        message: str,
      },
    },
  ],
} as const;

const yieldWindow = {
  type: 'object',
  additionalProperties: false,
  required: [
    'window', 'start', 'end', 'days', 'partial', 'coveredStart', 'incomeUsd', 'valuedDividends', 'unvaluedDividends',
    'dividendQuantity', 'averageQuantity', 'shareYield', 'excluded',
  ],
  properties: {
    window: { type: 'string', enum: ['trailing_30d', 'trailing_365d', 'tracked'] },
    start: str,
    end: str,
    days: int,
    partial: { ...bool, description: 'Coverage begins after the window starts; figures cover only the tracked part' },
    coveredStart: str,
    incomeUsd: { ...decimal, description: 'Valued dividends only; unvalued ones are counted separately' },
    valuedDividends: int,
    unvaluedDividends: int,
    dividendQuantity: { ...decimal, description: 'Current split basis' },
    averageQuantity: { ...nullableDecimal, description: 'Time-weighted, current split basis' },
    shareYield: { ...nullableDecimal, description: 'Shares gained ÷ average shares held; not annualized. Null whenever excluded is set' },
    excluded: yieldExclusion,
  },
} as const;

export const yieldResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'dataset', 'definitions', 'positions'],
  properties: {
    owner: str,
    dataset,
    definitions: {
      type: 'object',
      additionalProperties: false,
      required: ['shareYield', 'trailingNetDistributionPerShare', 'distributionYield'],
      properties: { shareYield: str, trailingNetDistributionPerShare: str, distributionYield: str },
    },
    positions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['mint', 'symbol', 'status', 'asOf', 'windows', 'trailingDistribution', 'distributionYield'],
        properties: {
          mint: str,
          symbol: str,
          status: { type: 'string', enum: ['complete', 'partial', 'unsupported'] },
          asOf: nullableStr,
          windows: { type: 'array', items: yieldWindow },
          trailingDistribution: {
            type: 'object',
            additionalProperties: false,
            required: ['windowStart', 'windowEnd', 'netPerShare', 'distributions', 'missingNetCash', 'partial', 'excluded'],
            properties: {
              windowStart: str,
              windowEnd: str,
              netPerShare: nullableDecimal,
              distributions: int,
              missingNetCash: int,
              partial: bool,
              excluded: yieldExclusion,
            },
          },
          distributionYield: {
            type: 'object',
            additionalProperties: false,
            required: ['value', 'reason'],
            properties: { value: { type: 'null' }, reason: str },
          },
        },
      },
    },
  },
} as const;

const checkStatus = { type: 'string', enum: ['ok', 'warn', 'critical'] } as const;

export const opsStatusResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'checkedAt', 'checks'],
  properties: {
    status: checkStatus,
    checkedAt: str,
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'status', 'value', 'threshold', 'message'],
        properties: { name: str, status: checkStatus, value: { type: ['number', 'null'] }, threshold: str, message: str },
      },
    },
  },
} as const;

export const ownerQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['owner'],
  properties: { owner },
} as const;

export const ownerParams = ownerQuery;

export const incomeQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['owner'],
  properties: {
    owner,
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    offset: { type: 'integer', minimum: 0, default: 0 },
  },
} as const;

export const exportQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['owner'],
  properties: {
    owner,
    dataset: {
      type: 'string',
      enum: ['journal', 'income'],
      default: 'journal',
      description: 'journal: every recognition and reversal (accounting-grade); income: current entries with revisions',
    },
  },
} as const;

export const incomeEventParams = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^\\d+$' } },
} as const;

// ─── API v2: corporate actions ────────────────────────────────────────────────────────────────────────────────────

/** Mirrors ACTION_KINDS in @corpact/domain; a contract test keeps them equal. */
export const ACTION_TYPES = [
  'cash_dividend', 'withholding_adjustment', 'stock_dividend', 'cash_and_stock_dividend', 'forward_split', 'reverse_split', 'unit_split',
  'cash_in_lieu', 'spin_off', 'rights_distribution', 'stock_merger', 'cash_merger', 'mixed_merger', 'identity_change', 'redemption',
  'delisting', 'seizure', 'unknown',
] as const;

const actionType = { type: 'string', enum: ACTION_TYPES } as const;
const classifierStatus = {
  type: 'string',
  enum: ['validated', 'unvalidated', 'not_built'],
  description: 'validated: confirmed against real recorded instances. unvalidated: no real instance has confirmed it; never booked. not_built: recognised only',
} as const;
const bookedTreatment = {
  type: 'string',
  enum: ['income', 'quantity_basis', 'basis_allocation', 'identity', 'not_booked'],
  description:
    'income: units added are income. quantity_basis: units rescaled, basis spread across them. basis_allocation: units added are principal bought with distributed value. identity: same position in a new underlying form. not_booked: recognised, not booked; conversion disabled',
} as const;
const lifecycleState = { type: ['string', 'null'], enum: ['announced', 'confirmed', 'activated', 'corrected', 'reversed', 'superseded', null] } as const;
const ledgerKind = { type: 'string', enum: ['dividend', 'split', 'distribution', 'identity_change', 'unclassified_adjustment'] } as const;

export const actionKindSpec = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'label', 'category', 'treatment', 'classifier', 'realInstances', 'evidence'],
  properties: {
    kind: actionType,
    label: str,
    category: { type: 'string', enum: ['income', 'basis', 'identity', 'termination', 'custody', 'unknown'] },
    treatment: { type: 'string', enum: ['income', 'quantity_basis', 'basis_allocation', 'identity', 'termination', 'custody_transfer', 'not_booked'] },
    classifier: classifierStatus,
    realInstances: { type: 'integer', minimum: 0, description: 'Real instances in the recorded issuer data and on-chain scans' },
    evidence: str,
  },
} as const;

export const taxonomyResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['kinds'],
  properties: { kinds: { type: 'array', items: actionKindSpec } },
} as const;

const validation = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'realInstances'],
  properties: { status: classifierStatus, realInstances: { type: 'integer', minimum: 0 } },
} as const;

const evidenceSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['issuerEventId', 'issuerRevision', 'evidenceSha256', 'updateSignature'],
  properties: {
    issuerEventId: nullableStr,
    issuerRevision: { type: ['integer', 'null'] },
    evidenceSha256: { ...nullableStr, description: 'SHA-256 of the matched issuer record exactly as stored; recomputable from the database' },
    updateSignature: str,
  },
} as const;

const actionProperties = {
  id: str,
  mint: str,
  symbol: str,
  effectiveAt: str,
  type: actionType,
  treatment: bookedTreatment,
  validation,
  lifecycle: { type: 'object', additionalProperties: false, required: ['state'], properties: { state: lifecycleState } },
  quantity: { ...decimal, description: 'Units added (negative: removed). Zero for an ordinary split' },
  quantityDisplay: decimal,
  factor: { ...nullableDecimal, description: 'New units per old unit, for splits, stock dividends and identity changes' },
  distributedFraction: { ...nullableDecimal, description: "Share of the position's value delivered by a spin-off or rights distribution: (M_new − M_old) ÷ M_new" },
  usd: { ...nullableDecimal, description: 'Income value; only for income. Null means unknown, never zero' },
  proceedsUsd: { ...nullableDecimal, description: 'Issuer proceeds for a distribution, when published and plausible. Never income' },
  valuation,
  retentionRate: { ...nullableDecimal, description: 'A currency retention the issuer published in its withholding field; not tax, already reflected in net cash' },
  refundNote: { ...nullableStr, description: "For a withholding refund: the issuer's explanation" },
  underlying: {
    anyOf: [
      { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: nullableStr, to: nullableStr } },
      { type: 'null' },
    ],
  },
  headline: str,
  warnings: strings,
  reasons: strings,
  revision: { type: 'integer', minimum: 1 },
  correctedAt: nullableStr,
  evidence: evidenceSummary,
} as const;

const actionRequired = Object.keys(actionProperties) as Array<keyof typeof actionProperties>;

export const action = {
  type: 'object',
  additionalProperties: false,
  required: actionRequired,
  properties: actionProperties,
} as const;

export const actionsResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['owner', 'dataset', 'actions', 'nextOffset'],
  properties: { owner: str, dataset, actions: { type: 'array', items: action }, nextOffset: { type: ['integer', 'null'] } },
} as const;

const lifecycleStep = {
  type: 'object',
  additionalProperties: false,
  required: ['state', 'at', 'reason', 'evidence', 'revision'],
  properties: {
    state: { type: 'string', enum: ['announced', 'confirmed', 'activated', 'corrected', 'reversed', 'superseded'] },
    at: str,
    reason: str,
    evidence: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'reference', 'sha256'],
          properties: { source: { type: 'string', enum: ['issuer', 'chain', 'ledger'] }, reference: str, sha256: nullableStr },
        },
        { type: 'null' },
      ],
    },
    revision: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['version', 'status', 'type', 'supersedes'],
          properties: { version: int, status: str, type: str, supersedes: { type: ['integer', 'null'] } },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

export const journalEntryV2 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'recordedAt', 'entryType', 'kind', 'type', 'effectiveAt', 'quantity', 'factor', 'usd', 'valuation', 'distributedFraction', 'proceedsUsd',
    'issuerEventId', 'issuerRevision', 'reversesId', 'changeReason', 'changeDetail',
  ],
  properties: {
    id: str,
    recordedAt: str,
    entryType: { type: 'string', enum: ['recognition', 'reversal'] },
    kind: ledgerKind,
    type: actionType,
    effectiveAt: str,
    quantity: decimal,
    factor: nullableDecimal,
    usd: nullableDecimal,
    valuation,
    distributedFraction: nullableDecimal,
    proceedsUsd: nullableDecimal,
    issuerEventId: nullableStr,
    issuerRevision: { type: ['integer', 'null'] },
    reversesId: nullableStr,
    changeReason: journalEntry.properties.changeReason,
    changeDetail: nullableStr,
  },
} as const;

const lineageSuccessor = {
  type: 'object',
  additionalProperties: false,
  required: ['identityId', 'underlyingSymbol', 'basisFraction', 'quantityFactor'],
  properties: { identityId: str, underlyingSymbol: nullableStr, basisFraction: decimal, quantityFactor: nullableDecimal },
} as const;

export const lineageLink = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'effectiveAt', 'issuerEventId', 'issuerRevision', 'classifierStatus', 'fromIdentityId', 'fromUnderlyingSymbol', 'cashBasisFraction', 'supersedesId', 'successors'],
  properties: {
    id: str,
    kind: { type: 'string', enum: ['identity_change', 'transform', 'spin_off', 'terminate'] },
    effectiveAt: str,
    issuerEventId: nullableStr,
    issuerRevision: { type: ['integer', 'null'] },
    classifierStatus,
    fromIdentityId: str,
    fromUnderlyingSymbol: nullableStr,
    cashBasisFraction: { ...decimal, description: 'Share of basis that left the lineage as cash' },
    supersedesId: nullableStr,
    successors: { type: 'array', items: lineageSuccessor, description: 'Basis fractions plus cashBasisFraction sum to exactly 1' },
  },
} as const;

export const actionDetail = {
  type: 'object',
  additionalProperties: false,
  required: [...actionRequired, 'owner', 'dataset', 'timestamps', 'history', 'lineage'],
  properties: {
    ...actionProperties,
    owner: str,
    dataset,
    lifecycle: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'steps', 'inconsistency'],
      properties: {
        state: lifecycleState,
        steps: { type: 'array', items: lifecycleStep, description: 'Append-only: every issuer revision and chain event, oldest first; superseded revisions are kept' },
        inconsistency: { ...nullableStr, description: 'Set when the stored evidence cannot form a valid lifecycle; state and steps are then empty' },
      },
    },
    timestamps: {
      type: 'object',
      additionalProperties: false,
      required: ['issuerEffectiveAt', 'issuerCreatedAt', 'configuredActivationAt', 'publicationBlockTime', 'firstObservedActiveAt', 'ingestedAt'],
      properties: {
        issuerEffectiveAt: { ...nullableStr, description: 'Effective time on the matched issuer record' },
        issuerCreatedAt: { ...nullableStr, description: 'When the issuer created the matched record' },
        configuredActivationAt: { ...nullableStr, description: 'Activation timestamp written to the mint' },
        publicationBlockTime: { ...nullableStr, description: 'Block time of the transaction that wrote it' },
        firstObservedActiveAt: { ...nullableStr, description: 'First stored mint-state observation at or after activation' },
        ingestedAt: { ...nullableStr, description: 'When Corpact stored the matched issuer record' },
      },
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: [...evidenceSummary.required, 'issuerRevisions', 'chain', 'classification', 'issuerRecord'],
      properties: {
        ...evidenceSummary.properties,
        issuerRevisions: {
          type: 'array',
          description: 'Every stored revision of the issuer event, including cancelled and superseded ones',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['version', 'type', 'status', 'effectiveAt', 'createdAt', 'ingestedAt', 'notes', 'source', 'storedPayloadSha256'],
            properties: {
              version: int,
              type: str,
              status: { type: 'string', enum: ['Initial', 'Corrected', 'Cancelled', 'Scheduled'] },
              effectiveAt: nullableStr,
              createdAt: str,
              ingestedAt: str,
              notes: nullableStr,
              source: { type: 'string', enum: ['fixtures', 'live'] },
              storedPayloadSha256: nullableStr,
            },
          },
        },
        chain: incomeDetail.properties.evidence.properties.chain,
        classification: {
          type: 'object',
          additionalProperties: false,
          required: ['result', 'classifierVersion', 'reasons', 'warnings'],
          properties: {
            result: { type: 'string', enum: ['dividend', 'split', 'distribution', 'identity_change', 'unclassified', 'pending'] },
            classifierVersion: nullableStr,
            reasons: strings,
            warnings: strings,
          },
        },
        issuerRecord: { anyOf: [{ type: 'object' }, { type: 'null' }], description: 'The matched issuer record exactly as stored' },
      },
    },
    history: { type: 'array', items: journalEntryV2, description: 'Every recognition and reversal of this action, oldest first' },
    lineage: { anyOf: [lineageLink, { type: 'null' }], description: 'The lineage link this action wrote, for identity changes' },
  },
} as const;

export const mintParams = {
  type: 'object',
  additionalProperties: false,
  required: ['mint'],
  properties: { mint: { type: 'string', pattern: OWNER_PATTERN, description: 'Token mint address (base58)' } },
} as const;

export const lineageResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['mint', 'dataset', 'identities', 'links', 'current'],
  properties: {
    mint: str,
    dataset,
    identities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'symbol', 'underlyingSymbol', 'underlyingIsin', 'validFrom', 'issuerEventId', 'evidence'],
        properties: { id: str, symbol: str, underlyingSymbol: nullableStr, underlyingIsin: nullableStr, validFrom: str, issuerEventId: nullableStr, evidence: str },
      },
    },
    links: { type: 'array', items: lineageLink, description: 'Append-only; a corrected link names the link it supersedes' },
    current: {
      type: 'array',
      description: 'Where the basis of the earliest recorded identity is now, traced through every link that is not superseded. Empty when no identity change is recorded',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['identityId', 'underlyingSymbol', 'basisFraction', 'terminated'],
        properties: { identityId: nullableStr, underlyingSymbol: nullableStr, basisFraction: decimal, terminated: bool },
      },
    },
  },
} as const;
