import type { FromSchema } from 'json-schema-to-ts';
import type * as s from './schemas';

export type ErrorResponse = FromSchema<typeof s.errorResponse>;
export type HealthResponse = FromSchema<typeof s.healthResponse>;
export type Asset = FromSchema<typeof s.asset>;
export type AssetsResponse = FromSchema<typeof s.assetsResponse>;
export type SyncStatus = FromSchema<typeof s.syncStatus>;
export type SyncStatusResponse = FromSchema<typeof s.syncStatusResponse>;
export type SyncRequestResponse = FromSchema<typeof s.syncRequestResponse>;
export type Position = FromSchema<typeof s.position>;
export type Portfolio = FromSchema<typeof s.portfolioResponse>;
export type IncomeEntry = FromSchema<typeof s.incomeEntry>;
export type EntryKind = IncomeEntry['kind'];
export type IncomeResponse = FromSchema<typeof s.incomeResponse>;
export type IncomeDetail = FromSchema<typeof s.incomeDetail>;
