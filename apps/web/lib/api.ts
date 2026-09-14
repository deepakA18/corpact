import { createCorpactClient } from '@corpact/client';

export { CorpactApiError } from '@corpact/client';

export type { EntryKind, IncomeDetail, IncomeEntry, Portfolio, Position, SyncStatus } from '@corpact/client';

// The browser calls this app's own server route, which holds the API key.
const client = createCorpactClient({ baseUrl: '/api/corpact' });

export const api = {
  portfolio: (owner: string) => client.portfolio(owner),
  income: (owner: string) => client.income(owner, { limit: 200 }),
  incomeDetail: (owner: string, id: string) => client.incomeEvent(owner, id),
  status: (owner: string) => client.syncStatus(owner),
  sync: (owner: string) => client.requestSync(owner),
};
