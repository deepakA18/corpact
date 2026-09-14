import type {
  AssetsResponse,
  HealthResponse,
  IncomeDetail,
  IncomeResponse,
  JournalResponse,
  Portfolio,
  SyncRequestResponse,
  SyncStatusResponse,
  WalletsResponse,
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

  async function request<T>(method: 'GET' | 'POST', path: string, init: { query?: Query; body?: unknown } = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetchImpl(`${base}${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (res.ok) throw new CorpactApiError(res.status, `Expected JSON from ${path}`, text);
      }
    }
    if (!res.ok) {
      const message = (parsed as { error?: unknown } | undefined)?.error;
      throw new CorpactApiError(res.status, typeof message === 'string' ? message : `HTTP ${res.status} from ${path}`, parsed ?? text);
    }
    return parsed as T;
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
  };
}

export type CorpactClient = ReturnType<typeof createCorpactClient>;
