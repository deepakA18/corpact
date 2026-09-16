import { ACTION_NAV } from './actions-nav.generated';

export interface NavItem {
  title: string;
  /** Path under /docs; '' is the docs home. */
  slug: string;
  badge?: string;
}

export interface NavGroup {
  title: string;
  icon: 'home' | 'start' | 'concepts' | 'guides' | 'ops' | 'reference';
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: 'Getting Started',
    icon: 'start',
    items: [
      { title: 'Overview', slug: '' },
      { title: 'Try the API', slug: 'try-it' },
      { title: 'Quickstart', slug: 'quickstart' },
      { title: 'Authentication', slug: 'authentication' },
      { title: 'Tenants & wallets', slug: 'tenancy' },
    ],
  },
  {
    title: 'Concepts',
    icon: 'concepts',
    items: [
      { title: 'Scaled UI multipliers', slug: 'concepts/multipliers' },
      { title: 'Classification from evidence', slug: 'concepts/classification' },
      { title: 'Protected floor', slug: 'concepts/protected-floor' },
      { title: 'Coverage & partial history', slug: 'concepts/coverage' },
      { title: 'Corrections & the journal', slug: 'concepts/corrections' },
      { title: 'Synthetic vs mainnet data', slug: 'concepts/datasets' },
    ],
  },
  {
    title: 'Corporate actions',
    icon: 'concepts',
    items: ACTION_NAV,
  },
  {
    title: 'Guides',
    icon: 'guides',
    items: [
      { title: 'Sync a wallet', slug: 'guides/sync-a-wallet' },
      { title: 'Read income', slug: 'guides/read-income' },
      { title: 'Explain an event', slug: 'guides/explain-an-event' },
      { title: 'Yield metrics', slug: 'guides/yield' },
      { title: 'Export to CSV', slug: 'guides/export' },
    ],
  },
  {
    title: 'Operations',
    icon: 'ops',
    items: [
      { title: 'Monitoring', slug: 'operations/monitoring' },
      { title: 'Independent RPC provider', slug: 'operations/independent-provider' },
      { title: 'Backup & restore', slug: 'operations/backups' },
      { title: 'Running the demo', slug: 'operations/demo' },
    ],
  },
  {
    title: 'Reference',
    icon: 'reference',
    items: [
      { title: 'API reference', slug: 'api-reference' },
      { title: 'API v1 → v2', slug: 'reference/api-v1-to-v2' },
      { title: 'TypeScript client', slug: 'reference/client' },
      { title: 'Errors & limits', slug: 'reference/errors' },
    ],
  },
];

export const ALL_ITEMS = NAV.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : '/docs');

export function neighbours(slug: string) {
  const index = ALL_ITEMS.findIndex((item) => item.slug === slug);
  return { previous: index > 0 ? ALL_ITEMS[index - 1] : undefined, next: index >= 0 ? ALL_ITEMS[index + 1] : undefined };
}
