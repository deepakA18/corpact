import { createCorpactClient, type ExportDataset } from '@corpact/client';

export { CorpactApiError } from '@corpact/client';

export type { EntryKind, IncomeDetail, IncomeEntry, Portfolio, Position, SyncStatus, YieldResponse } from '@corpact/client';

// The browser calls this app's own server route, which holds the API key.
const client = createCorpactClient({ baseUrl: '/api/corpact' });

export const api = {
  portfolio: (owner: string) => client.portfolio(owner),
  income: (owner: string) => client.income(owner, { limit: 200 }),
  incomeDetail: (owner: string, id: string) => client.incomeEvent(owner, id),
  yield: (owner: string) => client.yieldMetrics(owner),
  /** Same-origin link; the proxy passes the attachment filename through. */
  exportUrl: (owner: string, dataset: ExportDataset) => client.exportUrl(owner, dataset),
  status: (owner: string) => client.syncStatus(owner),
  sync: (owner: string) => client.requestSync(owner),
};
