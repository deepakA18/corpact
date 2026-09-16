/**
 * The hosted demo API used by the docs sandbox. The key is read-only (`assets:read`, `ledger:read`) and belongs
 * to its own tenant, so it can reach nothing but the wallet registered for the demo. It is public on purpose.
 */
export const DEMO_API_URL = 'https://corpactapi-production.up.railway.app';
export const DEMO_API_KEY = 'cpk_6mTym0MCpOrAqdAyKiW4Flrm0V8JGDuXIjcLCgy0Wzg';
export const DEMO_WALLET = '6kn8Vj9YkvNLo8peW2fzebQdSLtX33A3TkRJwXqMCy1U';

export interface DemoRequest {
  id: string;
  label: string;
  method: 'GET';
  path: string;
  summary: string;
}

export const DEMO_REQUESTS: DemoRequest[] = [
  {
    id: 'taxonomy',
    label: 'Taxonomy',
    method: 'GET',
    path: '/v2/taxonomy',
    summary: 'The corporate-action taxonomy: every type Corpact recognises, and how each one reaches the ledger.',
  },
  {
    id: 'actions',
    label: 'Corporate actions',
    method: 'GET',
    path: `/v2/actions?owner=${DEMO_WALLET}&limit=5`,
    summary: 'Every action applied to the wallet: its type, ledger treatment, lifecycle state and the evidence behind it.',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    method: 'GET',
    path: `/v1/portfolio?owner=${DEMO_WALLET}`,
    summary: 'Positions with dividend income, the protected principal floor, what is convertible, and coverage.',
  },
  {
    id: 'income',
    label: 'Income',
    method: 'GET',
    path: `/v1/income?owner=${DEMO_WALLET}&limit=5`,
    summary: 'The v1 view: dividends, splits and adjustments, each with a plain-language headline.',
  },
  {
    id: 'journal',
    label: 'Audit journal',
    method: 'GET',
    path: `/v1/journal?owner=${DEMO_WALLET}&limit=5`,
    summary: 'The append-only trail. A correction is a reversal plus a replacement; nothing is ever edited.',
  },
  {
    id: 'health',
    label: 'Health',
    method: 'GET',
    path: '/v1/health',
    summary: 'The only route that needs no key. `dataset` says whether the database holds mainnet or synthetic data.',
  },
  {
    id: 'assets',
    label: 'Assets',
    method: 'GET',
    path: '/v1/assets',
    summary: 'Every supported mint, with its on-chain verification status.',
  },
];

export const curlFor = (request: DemoRequest) =>
  request.path === '/v1/health'
    ? `curl -s ${DEMO_API_URL}${request.path}`
    : `curl -s "${DEMO_API_URL}${request.path}" \\\n  -H "authorization: Bearer ${DEMO_API_KEY}"`;
