export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // UTC, so dates agree with the chain and issuer evidence (activations sit near midnight UTC).
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

/** Display a decimal string as USD without passing it through floating point. */
export function formatUsd(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  let cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if ((fraction[2] ?? '0') >= '5') cents += 1n; // half away from zero on the magnitude
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative && cents !== 0n ? '-' : ''}$${dollars}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** Trim trailing zeros of a decimal quantity string for display. */
export function formatQuantity(decimal: string): string {
  if (!decimal.includes('.')) return decimal;
  const trimmed = decimal.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}
