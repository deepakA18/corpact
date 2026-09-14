import { schemas } from '@corpact/client';
import { Rational } from '@corpact/domain';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /** Machine-readable reason, for clients that branch on it. */
    readonly code?: string,
  ) {
    super(message);
  }
}

export const errors = {
  400: schemas.errorResponse,
  401: schemas.errorResponse,
  403: schemas.errorResponse,
  404: schemas.errorResponse,
  429: schemas.errorResponse,
} as const;

export const ratio = (num: string, den: string) => Rational.of(BigInt(num), BigInt(den));
export const isoOfDate = (value: unknown) => (value == null ? null : new Date(value as string | Date).toISOString());
export const iso = (unix: string | null | undefined) => (unix == null ? null : new Date(Number(unix) * 1000).toISOString());

/** Exact when the value terminates (all ledger values here do); otherwise 18 places. */
export function exact(r: Rational): string {
  try {
    return r.toTerminatingDecimal();
  } catch {
    return r.toFixed(18);
  }
}

/** Round toward zero at `scale` places — never displays more convertible exposure than exists. */
export function towardZero(r: Rational, scale: number): string {
  const scaled = r.mul(Rational.of(10n ** BigInt(scale)));
  const truncated = scaled.isNegative() ? scaled.ceil() : scaled.floor();
  const negative = truncated < 0n;
  const digits = (negative ? -truncated : truncated).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${body}` : body;
}
