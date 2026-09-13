import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IssuerCorporateAction } from '@corpact/domain';
import {
  assetNodesSchema,
  createXStocksClient,
  parseCorporateActions,
  parseMultiplierHistory,
  toSolanaAssets,
  type MultiplierHistoryNode,
  type RejectedRecord,
  type SolanaAsset,
} from './xstocks';

export type IssuerSourceKind = 'fixtures' | 'live';

export interface CorporateActionFilter {
  symbol?: string;
  createdAfter?: Date;
}

/**
 * Everything the build reads from the issuer. Call sites depend on this, never on
 * a transport, so switching between recorded fixtures and the live API is one flag.
 * Deliberately no price method: there is no event-time price source yet.
 */
export interface IssuerSource {
  readonly kind: IssuerSourceKind;
  readonly issuer: 'xstocks';
  listSolanaAssets(): Promise<SolanaAsset[]>;
  multiplierHistory(symbol: string): Promise<{ history: MultiplierHistoryNode[]; rejected: RejectedRecord[] }>;
  corporateActions(
    kind: 'history' | 'upcoming',
    filter?: CorporateActionFilter,
  ): Promise<{ actions: IssuerCorporateAction[]; rejected: RejectedRecord[] }>;
}

export const DEFAULT_FIXTURES_DIR = join(import.meta.dirname, '../../../fixtures/xstocks/recorded-20260913');

export class IssuerSourceConfigError extends Error {
  override name = 'IssuerSourceConfigError';
}

function readRecording(dir: string, file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch (err) {
    throw new IssuerSourceConfigError(`Cannot read issuer fixture ${join(dir, file)}: ${String(err)}`);
  }
}

function applyFilter(actions: IssuerCorporateAction[], filter: CorporateActionFilter): IssuerCorporateAction[] {
  return actions.filter(
    (a) =>
      (filter.symbol === undefined || a.symbol === filter.symbol) &&
      (filter.createdAfter === undefined || a.createdAt > filter.createdAfter),
  );
}

/** Serves recorded issuer responses. Makes no network calls. */
export function createFixtureXStocksSource(dir: string = DEFAULT_FIXTURES_DIR): IssuerSource {
  const cache = new Map<string, unknown>();
  const load = (file: string) => {
    if (!cache.has(file)) cache.set(file, readRecording(dir, file));
    return cache.get(file) as { nodes?: unknown; bySymbol?: Record<string, unknown[]> };
  };

  return {
    kind: 'fixtures',
    issuer: 'xstocks',
    async listSolanaAssets() {
      const parsed = assetNodesSchema.safeParse(load('assets.json').nodes);
      if (!parsed.success) throw new IssuerSourceConfigError(`Recorded assets do not match the asset schema in ${dir}`);
      return toSolanaAssets(parsed.data);
    },
    async multiplierHistory(symbol) {
      return parseMultiplierHistory(load('multiplier-history.json').bySymbol?.[symbol] ?? []);
    },
    async corporateActions(kind, filter = {}) {
      const nodes = load(`corporate-actions-${kind}.json`).nodes;
      const { actions, rejected } = parseCorporateActions(Array.isArray(nodes) ? nodes : []);
      return { actions: applyFilter(actions, filter), rejected };
    },
  };
}

/** Live issuer API. Only reachable when ISSUER_SOURCE=live — see the data-rights constraint in docs/findings. */
export function createLiveXStocksSource(): IssuerSource {
  const client = createXStocksClient();
  return {
    kind: 'live',
    issuer: 'xstocks',
    listSolanaAssets: () => client.listSolanaAssets(),
    multiplierHistory: (symbol) => client.multiplierHistory(symbol),
    corporateActions: (kind, filter) => client.corporateActions(kind, filter),
  };
}

/** The single switch: `ISSUER_SOURCE=fixtures` (default) or `live`. */
export function issuerSourceFromEnv(env: Record<string, string | undefined> = process.env): IssuerSource {
  const kind = env.ISSUER_SOURCE ?? 'fixtures';
  if (kind === 'fixtures') return createFixtureXStocksSource(env.ISSUER_FIXTURES_DIR ?? DEFAULT_FIXTURES_DIR);
  if (kind === 'live') return createLiveXStocksSource();
  throw new IssuerSourceConfigError(`ISSUER_SOURCE must be "fixtures" or "live", got ${JSON.stringify(kind)}`);
}
