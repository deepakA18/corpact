import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bitsFromFloat64, float64FromBits } from './bytes';
import { EXTENSION_SCALED_UI_AMOUNT, MintDecodeError, activeMultiplier, decodeToken2022Mint } from './mint';

const CHAIN = join(import.meta.dirname, '../../../fixtures/chain');
const mintBytes = (symbol: string) => {
  const f = JSON.parse(readFileSync(join(CHAIN, `mint-${symbol}.json`), 'utf8'));
  return new Uint8Array(Buffer.from(f.value.data[0], 'base64'));
};
/** 2026-09-13T12:00:00Z — after every activation in these recordings. */
const RECORDED_AT = 1_789_300_800n;

describe('decodeToken2022Mint on recorded mainnet mints', () => {
  it('decodes SPYx: 8 decimals, Scaled UI config, and the stale stored multiplier', () => {
    const mint = decodeToken2022Mint(mintBytes('SPYx'));
    expect(mint.decimals).toBe(8);
    expect(mint.isInitialized).toBe(true);
    expect(mint.extensionTypes).toContain(EXTENSION_SCALED_UI_AMOUNT);
    const cfg = mint.scaledUiAmount!;
    expect(cfg.multiplierBits).toBe(bitsFromFloat64(1.003909240011759));
    expect(cfg.newMultiplierBits).toBe(bitsFromFloat64(1.005714560286254));
    expect(cfg.newMultiplierEffectiveTimestamp).toBe(1_781_755_200n); // 2026-06-18T04:00Z
  });

  it('derives the live multiplier from the timestamp, not the stored field', () => {
    const cfg = decodeToken2022Mint(mintBytes('SPYx')).scaledUiAmount!;
    expect(activeMultiplier(cfg, RECORDED_AT)).toMatchObject({ value: 1.005714560286254, pending: null });
    const beforeActivation = activeMultiplier(cfg, 1_781_755_199n);
    expect(beforeActivation.value).toBe(1.003909240011759);
    expect(beforeActivation.pending?.bits).toBe(bitsFromFloat64(1.005714560286254));
  });

  it('agrees with the issuer latest multiplier for every recorded mint', () => {
    const issuerLatest: Record<string, number> = {
      SPYx: 1.005714560286254,
      KOx: 1.0183317967386898,
      NVDAx: 1.001701196801074,
      HONx: 1.0011576563945983,
      STRCx: 1.0808929977256367,
    };
    for (const [symbol, expected] of Object.entries(issuerLatest)) {
      const cfg = decodeToken2022Mint(mintBytes(symbol)).scaledUiAmount!;
      expect(activeMultiplier(cfg, RECORDED_AT).value, symbol).toBe(expected);
    }
  });

  it('rejects truncated data, a non-mint account type, and an overrunning extension', () => {
    const good = mintBytes('KOx');
    expect(() => decodeToken2022Mint(good.subarray(0, 40))).toThrow(MintDecodeError);
    const wrongType = good.slice();
    wrongType[165] = 2;
    expect(() => decodeToken2022Mint(wrongType)).toThrow(/not marked as a mint/);
    const overrun = good.slice();
    new DataView(overrun.buffer).setUint16(168, 0xffff, true);
    expect(() => decodeToken2022Mint(overrun)).toThrow(/overruns/);
  });

  it('round-trips f64 bits exactly', () => {
    for (const v of [1, 1.005714560286254, 0.5120473566533945, 10.00892302917]) {
      expect(float64FromBits(bitsFromFloat64(v))).toBe(v);
    }
  });
});
