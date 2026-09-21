import { PLAN_DISCLAIMER, billingIsRecordOnly } from '@/lib/billing';

export function PlanDisclaimer() {
  if (!billingIsRecordOnly) return null;
  return <p className="plan-disclaimer">{PLAN_DISCLAIMER}</p>;
}