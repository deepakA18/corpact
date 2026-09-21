import { Rational } from './rational';

declare const scaledPriceBrand: unique symbol;

/**
 * USD per *displayed* (scaled) unit. The only price that may multiply a displayed quantity.
 * `pUnscaled = M × pScaled`; mixing the two silently mis-values by the multiplier.
 */
export type ScaledUsdPrice = Rational & { readonly [scaledPriceBrand]: true };
export const scaledUsdPrice = (value: Rational): ScaledUsdPrice => value as ScaledUsdPrice;

/** D = 10^decimals. */
export function unitScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`Invalid mint decimals: ${decimals}`);
  }
  return 10n ** BigInt(decimals);
}

/** B = R / D. */
export const baseQuantity = (raw: bigint, decimals: number): Rational => Rational.of(raw, unitScale(decimals));

/** Q = B × M - what the holder's wallet displays. */
export const displayedQuantity = (raw: bigint, decimals: number, multiplier: Rational): Rational =>
  baseQuantity(raw, decimals).mul(multiplier);
