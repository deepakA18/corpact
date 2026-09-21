/**
 * Plan selection on the marketing site. Preview billing is record-only: we store the plan
 * so usage limits can be shaped around it. Nothing is charged.
 */
export const BILLING_MODE = process.env.NEXT_PUBLIC_BILLING_MODE ?? 'record_only';

export const PLAN_DISCLAIMER =
  process.env.NEXT_PUBLIC_PLAN_DISCLAIMER ??
  'No payment is taken. Choosing a plan records your choice and nothing else. There is no card to enter and nothing is billed. We record the plan you pick so we can shape usage limits around it, and the prices above are what each plan will cost.';

export const billingIsRecordOnly = BILLING_MODE === 'record_only';
