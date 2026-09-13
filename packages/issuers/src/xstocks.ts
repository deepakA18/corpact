import { z } from 'zod';
import {
  CORPORATE_ACTION_STATUSES,
  CORPORATE_ACTION_TYPES,
  Rational,
  scaledUsdPrice,
  type IssuerCorporateAction,
  type ScaledUsdPrice,
} from '@corpact/domain';

export const XSTOCKS_API = 'https://api.xstocks.fi/api/v2';
/** Network enum value, confirmed against live `/public/assets` deployments on 2026-09-13. */
export const SOLANA_NETWORK = 'Solana';

const MAX_PAGES = 1000;

const decimalText = z.string().regex(/^-?\d+(\.\d+)?$/, 'plain decimal');

const assetSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  underlyingSymbol: z.string().nullable(),
  isTradingHalted: z.boolean(),
  deployments: z.array(z.object({ address: z.string(), network: z.string() })),
});

const assetsPageSchema = z.object({
  nodes: z.array(assetSchema),
  page: z.object({ currentPage: z.number(), hasNextPage: z.boolean() }),
});
export const assetNodesSchema = z.array(assetSchema);

export const multiplierHistoryNodeSchema = z.object({
  id: z.string(),
  reason: z.string(),
  multiplier: z.number(),
  previousMultiplier: z.number(),
  activationDateTime: z.iso.datetime(),
});
export type MultiplierHistoryNode = z.infer<typeof multiplierHistoryNodeSchema>;

const multiplierHistoryPageSchema = z.object({
  nodes: z.array(z.unknown()),
  page: z.object({ currentPage: z.number(), hasNextPage: z.boolean() }),
});

export const corporateActionNodeSchema = z.object({
  eventId: z.string(),
  version: z.number().int(),
  xstockSymbol: z.string(),
  caType: z.enum(CORPORATE_ACTION_TYPES),
  status: z.enum(CORPORATE_ACTION_STATUSES),
  effectiveTimeUtc: z.iso.datetime().nullable(),
  createdTimeUtc: z.iso.datetime(),
  multiplierOld: decimalText.nullable(),
  multiplierNew: decimalText.nullable(),
  grossCashflowUsd: decimalText.nullable(),
  netCashflowUsd: decimalText.nullable(),
  withholdingTaxRate: decimalText.nullable(),
  fromUnits: decimalText.nullable(),
  toUnits: decimalText.nullable(),
  notes: z.string().nullable(),
});

const corporateActionsPageSchema = z.object({
  nodes: z.array(z.unknown()),
  page: z.object({ currentPage: z.number(), hasNextPage: z.boolean() }),
});

const priceSchema = z.object({ quote: z.number().positive() });

export interface SolanaAsset {
  symbol: string;
  name: string | null;
  underlyingSymbol: string | null;
  /** Authoritative identity. Symbols collide with impostor tokens on mainnet. */
  mint: string;
  isTradingHalted: boolean;
}

/** A row the issuer returned that failed validation, kept so rejections are never silent. */
export interface RejectedRecord {
  raw: unknown;
  issues: string;
}

export class IssuerFetchError extends Error {
  override name = 'IssuerFetchError';
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export function toSolanaAssets(nodes: readonly z.infer<typeof assetSchema>[]): SolanaAsset[] {
  const assets: SolanaAsset[] = [];
  for (const a of nodes) {
    const deployment = a.deployments.find((d) => d.network === SOLANA_NETWORK);
    if (!deployment) continue;
    assets.push({
      symbol: a.symbol,
      name: a.name,
      underlyingSymbol: a.underlyingSymbol,
      mint: deployment.address,
      isTradingHalted: a.isTradingHalted,
    });
  }
  return assets;
}

export function toCorporateAction(node: z.infer<typeof corporateActionNodeSchema>): IssuerCorporateAction {
  return {
    eventId: node.eventId,
    version: node.version,
    symbol: node.xstockSymbol,
    type: node.caType,
    status: node.status,
    effectiveAt: node.effectiveTimeUtc === null ? null : new Date(node.effectiveTimeUtc),
    createdAt: new Date(node.createdTimeUtc),
    multiplierOld: node.multiplierOld,
    multiplierNew: node.multiplierNew,
    grossCashUsdPerShare: node.grossCashflowUsd,
    netCashUsdPerShare: node.netCashflowUsd,
    withholdingTaxRate: node.withholdingTaxRate,
    fromUnits: node.fromUnits,
    toUnits: node.toUnits,
    notes: node.notes,
  };
}

/** Validate each row independently: one malformed record must not hide the rest. */
export function parseCorporateActions(nodes: readonly unknown[]): {
  actions: IssuerCorporateAction[];
  rejected: RejectedRecord[];
} {
  const actions: IssuerCorporateAction[] = [];
  const rejected: RejectedRecord[] = [];
  for (const raw of nodes) {
    const parsed = corporateActionNodeSchema.safeParse(raw);
    if (parsed.success) actions.push(toCorporateAction(parsed.data));
    else rejected.push({ raw, issues: z.prettifyError(parsed.error) });
  }
  return { actions, rejected };
}

export function parseMultiplierHistory(nodes: readonly unknown[]): {
  history: MultiplierHistoryNode[];
  rejected: RejectedRecord[];
} {
  const history: MultiplierHistoryNode[] = [];
  const rejected: RejectedRecord[] = [];
  for (const raw of nodes) {
    const parsed = multiplierHistoryNodeSchema.safeParse(raw);
    if (parsed.success) history.push(parsed.data);
    else rejected.push({ raw, issues: z.prettifyError(parsed.error) });
  }
  return { history, rejected };
}

export interface XStocksClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createXStocksClient(options: XStocksClientOptions = {}) {
  const baseUrl = options.baseUrl ?? XSTOCKS_API;
  const fetchImpl = options.fetch ?? fetch;

  async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = `${baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    } catch (err) {
      throw new IssuerFetchError(url, null, `Network error fetching ${url}: ${String(err)}`);
    }
    if (!res.ok) throw new IssuerFetchError(url, res.status, `HTTP ${res.status} from ${url}`);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      throw new IssuerFetchError(url, res.status, `Unexpected response shape from ${url}: ${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
  }

  /** Pagination bases differ by endpoint: assets and multiplier history start at 0, corporate actions at 1. */
  async function paginate<P extends { page: { hasNextPage: boolean } }>(
    firstPage: number,
    pathFor: (page: number) => string,
    schema: z.ZodType<P>,
  ): Promise<P[]> {
    const pages: P[] = [];
    for (let page = firstPage; page < firstPage + MAX_PAGES; page++) {
      const body = await getJson(pathFor(page), schema);
      pages.push(body);
      if (!body.page.hasNextPage) return pages;
    }
    throw new IssuerFetchError(pathFor(firstPage), null, `Pagination exceeded ${MAX_PAGES} pages`);
  }

  return {
    async listSolanaAssets(): Promise<SolanaAsset[]> {
      const pages = await paginate(0, (p) => `/public/assets?page=${p}`, assetsPageSchema);
      return toSolanaAssets(pages.flatMap((p) => p.nodes));
    },

    async multiplierHistory(symbol: string) {
      const s = encodeURIComponent(symbol);
      const pages = await paginate(
        0,
        (p) => `/public/assets/${s}/multiplier/history?network=${SOLANA_NETWORK}&page=${p}`,
        multiplierHistoryPageSchema,
      );
      return parseMultiplierHistory(pages.flatMap((p) => p.nodes));
    },

    async corporateActions(kind: 'history' | 'upcoming', filter: { symbol?: string; createdAfter?: Date } = {}) {
      const query = new URLSearchParams({ pageSize: '100' });
      if (filter.symbol) query.set('symbol', filter.symbol);
      if (filter.createdAfter) query.set('createdAfter', filter.createdAfter.toISOString());
      const pages = await paginate(
        1,
        (p) => `/public/corporate-actions/${kind}?${query}&page=${p}`,
        corporateActionsPageSchema,
      );
      return parseCorporateActions(pages.flatMap((p) => p.nodes));
    },

    /**
     * Latest *indicative* price per displayed unit. Verified scaled on 2026-09-13:
     * NFLXx (M = 10) quoted 77.295 while Jupiter showed 77.36. Not an event-time price.
     */
    async latestPriceScaled(symbol: string): Promise<ScaledUsdPrice> {
      const { quote } = await getJson(`/public/assets/${encodeURIComponent(symbol)}/price-data`, priceSchema);
      // JSON numbers print as their shortest round-trip decimal, which is the issuer's intended value.
      return scaledUsdPrice(Rational.fromDecimal(String(quote)));
    },
  };
}

export type XStocksClient = ReturnType<typeof createXStocksClient>;
