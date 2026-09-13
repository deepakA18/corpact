import { getAddressDecoder, type Address } from '@solana/kit';
import { readFloat64Bits, float64FromBits, type Float64Bits } from './bytes';

const MINT_BASE_LENGTH = 82;
const ACCOUNT_TYPE_OFFSET = 165;
const ACCOUNT_TYPE_MINT = 1;
const TLV_START = 166;
export const EXTENSION_SCALED_UI_AMOUNT = 25;
const SCALED_UI_AMOUNT_LENGTH = 56;

const addressDecoder = getAddressDecoder();

export class MintDecodeError extends Error {
  override name = 'MintDecodeError';
}

export interface ScaledUiAmountConfig {
  authority: Address | null;
  /** Stored `multiplier`. After `newMultiplierEffectiveTimestamp` passes this is stale until the next write. */
  multiplierBits: Float64Bits;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplierBits: Float64Bits;
}

export interface DecodedMint {
  mintAuthority: Address | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: Address | null;
  extensionTypes: number[];
  scaledUiAmount: ScaledUiAmountConfig | null;
}

/** Decode a Token-2022 mint account. Account data is untrusted: every length and type is checked. */
export function decodeToken2022Mint(data: Uint8Array): DecodedMint {
  if (data.length < MINT_BASE_LENGTH) throw new MintDecodeError(`Mint account is ${data.length} bytes; expected at least ${MINT_BASE_LENGTH}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const optionalKey = (offset: number): Address | null =>
    view.getUint32(offset, true) === 1 ? addressDecoder.decode(data.subarray(offset + 4, offset + 36)) : null;

  const extensionTypes: number[] = [];
  let scaledUiAmount: ScaledUiAmountConfig | null = null;

  if (data.length > MINT_BASE_LENGTH) {
    if (data.length <= ACCOUNT_TYPE_OFFSET || data[ACCOUNT_TYPE_OFFSET] !== ACCOUNT_TYPE_MINT) {
      throw new MintDecodeError('Account has extension space but is not marked as a mint');
    }
    for (let offset = TLV_START; offset + 4 <= data.length; ) {
      const type = view.getUint16(offset, true);
      const length = view.getUint16(offset + 2, true);
      if (type === 0 && length === 0) break;
      const end = offset + 4 + length;
      if (end > data.length) throw new MintDecodeError(`Extension ${type} overruns the account (${end} > ${data.length})`);
      extensionTypes.push(type);
      if (type === EXTENSION_SCALED_UI_AMOUNT) scaledUiAmount = decodeScaledUiAmount(data.subarray(offset + 4, end));
      offset = end;
    }
  }

  return {
    mintAuthority: optionalKey(0),
    supply: view.getBigUint64(36, true),
    decimals: data[44]!,
    isInitialized: data[45] === 1,
    freezeAuthority: optionalKey(46),
    extensionTypes,
    scaledUiAmount,
  };
}

function decodeScaledUiAmount(payload: Uint8Array): ScaledUiAmountConfig {
  if (payload.length !== SCALED_UI_AMOUNT_LENGTH) {
    throw new MintDecodeError(`ScaledUiAmountConfig is ${payload.length} bytes; expected ${SCALED_UI_AMOUNT_LENGTH}`);
  }
  const authorityBytes = payload.subarray(0, 32);
  return {
    authority: authorityBytes.every((b) => b === 0) ? null : addressDecoder.decode(authorityBytes),
    multiplierBits: readFloat64Bits(payload, 32),
    newMultiplierEffectiveTimestamp: new DataView(payload.buffer, payload.byteOffset + 40, 8).getBigInt64(0, true),
    newMultiplierBits: readFloat64Bits(payload, 48),
  };
}

/**
 * The multiplier wallets and the program actually use at `unixTimestamp`: the pending
 * value is live once cluster time reaches its timestamp, even though no write promoted it.
 */
export function activeMultiplier(config: ScaledUiAmountConfig, unixTimestamp: bigint) {
  const live = unixTimestamp >= config.newMultiplierEffectiveTimestamp;
  const bits = live ? config.newMultiplierBits : config.multiplierBits;
  return {
    bits,
    value: float64FromBits(bits),
    pending: live
      ? null
      : { bits: config.newMultiplierBits, effectiveUnix: config.newMultiplierEffectiveTimestamp },
  };
}
