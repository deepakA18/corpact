import type { FromSchema } from 'json-schema-to-ts';
import type * as s from './schemas';

export type ErrorResponse = FromSchema<typeof s.errorResponse>;
export type HealthResponse = FromSchema<typeof s.healthResponse>;
export type Asset = FromSchema<typeof s.asset>;
export type AssetsResponse = FromSchema<typeof s.assetsResponse>;
export type SyncStatus = FromSchema<typeof s.syncStatus>;
export type SyncStatusResponse = FromSchema<typeof s.syncStatusResponse>;
export type SyncRequestResponse = FromSchema<typeof s.syncRequestResponse>;
export type WalletsResponse = FromSchema<typeof s.walletsResponse>;
export type Position = FromSchema<typeof s.position>;
export type Portfolio = FromSchema<typeof s.portfolioResponse>;
export type IncomeEntry = FromSchema<typeof s.incomeEntry>;
export type EntryKind = IncomeEntry['kind'];
export type IncomeResponse = FromSchema<typeof s.incomeResponse>;
export type IncomeDetail = FromSchema<typeof s.incomeDetail>;
export type JournalEntry = FromSchema<typeof s.journalEntry>;
export type JournalResponse = FromSchema<typeof s.journalResponse>;
export type YieldResponse = FromSchema<typeof s.yieldResponse>;
export type OpsStatusResponse = FromSchema<typeof s.opsStatusResponse>;
export type ExportDataset = 'journal' | 'income';

// API v2
export type ActionType = (typeof s.ACTION_TYPES)[number];
export type ActionKindSpec = FromSchema<typeof s.actionKindSpec>;
export type TaxonomyResponse = FromSchema<typeof s.taxonomyResponse>;
export type Action = FromSchema<typeof s.action>;
export type ActionsResponse = FromSchema<typeof s.actionsResponse>;
export type ActionDetail = FromSchema<typeof s.actionDetail>;
export type JournalEntryV2 = FromSchema<typeof s.journalEntryV2>;
export type LineageLink = FromSchema<typeof s.lineageLink>;
export type LineageResponse = FromSchema<typeof s.lineageResponse>;
