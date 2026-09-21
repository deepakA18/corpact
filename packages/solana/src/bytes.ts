/** An f64 as its 8 little-endian bytes in lowercase hex - the exact on-chain representation. */
export type Float64Bits = string;

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new SyntaxError(`Invalid hex: ${JSON.stringify(hex)}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function readFloat64Bits(bytes: Uint8Array, offset: number): Float64Bits {
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError(`No f64 at offset ${offset} of ${bytes.length} bytes`);
  return toHex(bytes.subarray(offset, offset + 8));
}

export function float64FromBits(bits: Float64Bits): number {
  const bytes = fromHex(bits);
  if (bytes.length !== 8) throw new RangeError(`Expected 8 bytes of f64, got ${bytes.length}`);
  return new DataView(bytes.buffer).getFloat64(0, true);
}

export function bitsFromFloat64(value: number): Float64Bits {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return toHex(new Uint8Array(view.buffer));
}
