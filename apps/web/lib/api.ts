export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface SyncStatus {
  owner: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed';
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  asOfSlot: string | null;
  asOfTime: string | null;
  transactionsFetched: number;
  gaps: string[];
  error: string | null;
  progress: { phase?: string; done?: number; total?: number };
}

export interface Position {
  mint: string;
  symbol: string;
  name: string | null;
  status: 'complete' | 'partial' | 'unsupported';
  decimals: number;
  rawBalance: string;
  quantity: string;
  protectedQuantity: string | null;
  availableQuantity: string | null;
  maximumConvertibleRaw: string | null;
  dividendIncomeUsd: string;
  dividendEvents: number;
  unvaluedDividendEvents: number;
  unclassifiedAdjustments: number;
  reconciled: boolean;
  replayComplete: boolean;
  conversionDisabledReasons: string[];
  coverage: { start: string | null; end: string | null; startSlot: string | null; endSlot: string; gaps: string[] };
}

export interface Portfolio {
  owner: string;
  asOfSlot: string | null;
  asOfTime: string | null;
  dataStatus: SyncStatus | null;
  valuationStatus: string;
  coverage: { trackingStart: string | null; complete: boolean; partialPositions: number; unsupportedPositions: number };
  totals: {
    dividendIncomeUsd: string;
    unvaluedDividendEvents: number;
    unclassifiedAdjustments: number;
    availableToConvert: { usd: null; reason: string; positionsWithAvailable: number };
    usdcReceived: { usd: string; reason: string };
  };
  positions: Position[];
}

export type EntryKind = 'dividend' | 'split' | 'unclassified_adjustment';

export interface IncomeEntry {
  id: string;
  mint: string;
  symbol: string;
  kind: EntryKind;
  effectiveAt: string;
  /** Exact decimal. */
  quantity: string;
  /** Rounded toward zero at the mint's decimals, for display. */
  quantityDisplay: string;
  splitFactor: string | null;
  usd: string | null;
  valuation: string | null;
  warnings: string[];
  reasons: string[];
  headline: string;
}

export interface IncomeDetail extends Omit<IncomeEntry, 'splitFactor'> {
  owner: string;
  evidence: {
    chain: {
      updateSignature: string;
      explorerUrl: string;
      observedSlot: string;
      instructionPath: number[];
      scheduledAt: string;
      effectiveAt: string;
      immediate: boolean;
      status: string;
      multiplierBefore: { bits: string | null; exact: string | null };
      multiplierAfter: { bits: string; exact: string };
    };
    classification: {
      classifierVersion?: string;
      result: string;
      issuerEventId?: string | null;
      issuerRevision?: number | null;
      netCashPerShare?: string | null;
      reasons: string[];
      warnings?: string[];
    };
    issuerRecord: { source: string; evidenceSha256: string; record: Record<string, unknown> } | null;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed with ${res.status}`);
  return body as T;
}

export const api = {
  portfolio: (owner: string) => request<Portfolio>(`/v1/portfolio?owner=${encodeURIComponent(owner)}`),
  income: (owner: string) => request<{ entries: IncomeEntry[] }>(`/v1/income?owner=${encodeURIComponent(owner)}&limit=200`),
  incomeDetail: (owner: string, id: string) => request<IncomeDetail>(`/v1/income/${id}?owner=${encodeURIComponent(owner)}`),
  status: (owner: string) => request<{ sync: SyncStatus | null }>(`/v1/wallets/${encodeURIComponent(owner)}/status`),
  sync: (owner: string) =>
    request<{ status: string }>('/v1/wallets/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner }),
    }),
};
