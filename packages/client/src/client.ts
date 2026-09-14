import type {
  ActionDetail,
  ActionsResponse,
  LineageResponse,
  TaxonomyResponse,
  AssetsResponse,
  ExportDataset,
  HealthResponse,
  IncomeDetail,
  IncomeResponse,
  JournalResponse,
  OpsStatusResponse,
  Portfolio,
  SyncRequestResponse,
  SyncStatusResponse,
  WalletsResponse,
  YieldResponse,
} from './types';

export class CorpactApiError extends Error {
  override name = 'CorpactApiError';
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface CorpactClientOptions {
  /** API origin, or a same-origin path such as `/api/corpact` when a server proxy holds the key. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`. Never ship a key to a browser. */
  apiKey?: string;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

export function createCorpactClient(options: CorpactClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init));

  const url = (path: string, query: Query = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return `${base}${path}${qs ? `?${qs}` : ''}`;
  };

  async function send(method: 'GET' | 'POST', path: string, init: { query?: Query; body?: unknown; accept: string }) {
    const headers: Record<string, string> = { accept: init.accept };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetchImpl(url(path, init.query), {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    if (!res.ok) {
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      const message = (parsed as { error?: unknown } | undefined)?.error;
      throw new CorpactApiError(res.status, typeof message === 'string' ? message : `HTTP ${res.status} from ${path}`, parsed ?? text);
    }
    return text;
  }

  async function request<T>(method: 'GET' | 'POST', path: string, init: { query?: Query; body?: unknown } = {}): Promise<T> {
    const text = await send(method, path, { ...init, accept: 'application/json' });
    try {
      return (text ? JSON.parse(text) : undefined) as T;
    } catch {
      throw new CorpactApiError(200, `Expected JSON from ${path}`, text);
    }
  }

  const owner = (value: string) => encodeURIComponent(value);

  return {
    health: () => request<HealthResponse>('GET', '/v1/health'),
    assets: () => request<AssetsResponse>('GET', '/v1/assets'),
    requestSync: (wallet: string) => request<SyncRequestResponse>('POST', '/v1/wallets/sync', { body: { owner: wallet } }),
    wallets: () => request<WalletsResponse>('GET', '/v1/wallets'),
    syncStatus: (wallet: string) => request<SyncStatusResponse>('GET', `/v1/wallets/${owner(wallet)}/status`),
    portfolio: (wallet: string) => request<Portfolio>('GET', '/v1/portfolio', { query: { owner: wallet } }),
    income: (wallet: string, page: { limit?: number; offset?: number } = {}) =>
      request<IncomeResponse>('GET', '/v1/income', { query: { owner: wallet, ...page } }),
    journal: (wallet: string, page: { limit?: number; offset?: number } = {}) =>
      request<JournalResponse>('GET', '/v1/journal', { query: { owner: wallet, ...page } }),
    incomeEvent: (wallet: string, id: string) =>
      request<IncomeDetail>('GET', `/v1/income/${encodeURIComponent(id)}`, { query: { owner: wallet } }),
    yieldMetrics: (wallet: string) => request<YieldResponse>('GET', '/v1/yield', { query: { owner: wallet } }),
    /** The CSV body. For a browser download, link to `exportUrl` on a same-origin proxy instead. */
    exportCsv: (wallet: string, dataset: ExportDataset = 'journal') =>
      send('GET', '/v1/export', { query: { owner: wallet, dataset }, accept: 'text/csv' }),
    exportUrl: (wallet: string, dataset: ExportDataset = 'journal') => url('/v1/export', { owner: wallet, dataset }),
    opsStatus: () => request<OpsStatusResponse>('GET', '/v1/ops/status'),
    opsMetrics: () => send('GET', '/v1/ops/metrics', { accept: 'text/plain' }),
    v2: {
      taxonomy: () => request<TaxonomyResponse>('GET', '/v2/taxonomy'),
      actions: (wallet: string, page: { limit?: number; offset?: number } = {}) =>
        request<ActionsResponse>('GET', '/v2/actions', { query: { owner: wallet, ...page } }),
      action: (wallet: string, id: string) => request<ActionDetail>('GET', `/v2/actions/${encodeURIComponent(id)}`, { query: { owner: wallet } }),
      lineage: (mint: string) => request<LineageResponse>('GET', `/v2/instruments/${encodeURIComponent(mint)}/lineage`),
    },
  };
}

export type CorpactClient = ReturnType<typeof createCorpactClient>;
