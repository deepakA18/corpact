import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { address } from '@solana/kit';
import { bitsFromFloat64 as bits } from './bytes';
import { decodeToken2022Mint } from './mint';
import { CursorOrderError, buildMultiplierTimeline, verifyTimelineAgainstMint, type MultiplierWrite } from './timeline';
import { parseTransaction } from './transaction';

const CHAIN = join(import.meta.dirname, '../../../fixtures/chain');
const MINT = address('XsLUiVEwYeoneKpgR1C2Q4DBUZhX4xDktSCfQqq8zmn'); // VRTx

let seq = 0;
function write(kind: 'initialize' | 'update', value: number, clock: bigint, effective = 0n, slot?: bigint): MultiplierWrite {
  seq++;
  return {
    mint: MINT,
    signature: `sig${seq}`,
    cursor: { slot: slot ?? BigInt(seq * 10), txIndex: null, instructionPath: [0] },
    clockUnix: clock,
    kind,
    multiplierBits: bits(value),
    effectiveUnix: effective,
  };
}

describe('buildMultiplierTimeline — recorded xStocks UpdateMultiplier', () => {
  const recorded = JSON.parse(readFileSync(join(CHAIN, 'tx-update-multiplier-0.json'), 'utf8'));
  const parsed = parseTransaction(recorded.result);

  it('decodes the issuer re-assert + schedule pair from one transaction', () => {
    expect(parsed.multiplierWrites.map((w) => [w.mint, w.multiplierBits, w.effectiveUnix])).toEqual([
      [MINT, bits(1.000144451415), 1_781_481_300n], // 2026-06-14T23:55Z, already past
      [MINT, bits(1.000314669728725), 1_789_173_000n], // 2026-09-12T00:30Z
    ]);
  });

  it('yields exactly one transition, active after its schedule, with the re-asserted value as old', () => {
    const timeline = buildMultiplierTimeline(MINT, parsed.multiplierWrites, 1_789_300_800n);
    expect(timeline.transitions).toEqual([
      expect.objectContaining({
        oldMultiplierBits: bits(1.000144451415),
        newMultiplierBits: bits(1.000314669728725),
        scheduledUnix: 1_789_173_000n,
        effectiveUnix: 1_789_173_000n,
        immediate: false,
        status: 'active',
      }),
    ]);
    expect(timeline.knownFrom?.multiplierBits).toBe(bits(1.000144451415));
  });

  it('reports the same transition as scheduled before cluster time reaches it', () => {
    const timeline = buildMultiplierTimeline(MINT, parsed.multiplierWrites, 1_789_172_999n);
    expect(timeline.transitions.map((t) => t.status)).toEqual(['scheduled']);
  });
});

describe('buildMultiplierTimeline — Token-2022 processor rules', () => {
  it('activates a scheduled value without any further write', () => {
    const writes = [write('initialize', 1, 100n), write('update', 1.5, 200n, 1000n)];
    expect(buildMultiplierTimeline(MINT, writes, 999n).transitions[0]?.status).toBe('scheduled');
    expect(buildMultiplierTimeline(MINT, writes, 1000n).transitions[0]).toMatchObject({
      oldMultiplierBits: bits(1),
      newMultiplierBits: bits(1.5),
      effectiveUnix: 1000n,
      status: 'active',
    });
  });

  it('marks a pending value replaced before its time as superseded, never active', () => {
    const writes = [write('initialize', 1, 100n), write('update', 1.5, 200n, 1000n), write('update', 1.2, 500n, 2000n)];
    const { transitions } = buildMultiplierTimeline(MINT, writes, 3000n);
    expect(transitions.map((t) => [t.newMultiplierBits, t.status])).toEqual([
      [bits(1.5), 'superseded'],
      [bits(1.2), 'active'],
    ]);
    expect(transitions[1]?.oldMultiplierBits).toBe(bits(1));
  });

  it('applies a backdated update at its publication, not at its past timestamp', () => {
    const writes = [write('initialize', 1, 100n), write('update', 1.1, 900n, 50n)];
    expect(buildMultiplierTimeline(MINT, writes, 1000n).transitions).toEqual([
      expect.objectContaining({ oldMultiplierBits: bits(1), newMultiplierBits: bits(1.1), scheduledUnix: 50n, effectiveUnix: 900n, immediate: true }),
    ]);
  });

  it('a re-assert of the current value is not a transition', () => {
    const writes = [write('initialize', 1.25, 100n), write('update', 1.25, 900n, 50n)];
    expect(buildMultiplierTimeline(MINT, writes, 1000n).transitions).toEqual([]);
  });

  it('a scheduled value whose starting multiplier was never observed activates as orphaned', () => {
    const { transitions, knownFrom } = buildMultiplierTimeline(MINT, [write('update', 1.5, 200n, 1000n)], 5000n);
    expect(transitions.map((t) => t.status)).toEqual(['orphaned']);
    expect(knownFrom).toMatchObject({ unixTime: 1000n, multiplierBits: bits(1.5) });
  });

  it('refuses to order two writes in one slot without their transaction index', () => {
    const a = write('update', 1.1, 100n, 0n, 7n);
    const b = write('update', 1.2, 100n, 0n, 7n);
    expect(() => buildMultiplierTimeline(MINT, [a, b], 200n)).toThrow(CursorOrderError);
    expect(() =>
      buildMultiplierTimeline(MINT, [{ ...a, cursor: { ...a.cursor, txIndex: 1 } }, { ...b, cursor: { ...b.cursor, txIndex: 0 } }], 200n),
    ).not.toThrow();
  });
});

describe('verifyTimelineAgainstMint', () => {
  it('flags writes missing after the last one observed', () => {
    const cfg = decodeToken2022Mint(
      new Uint8Array(Buffer.from(JSON.parse(readFileSync(join(CHAIN, 'mint-SPYx.json'), 'utf8')).value.data[0], 'base64')),
    ).scaledUiAmount!;
    const stale = buildMultiplierTimeline(MINT, [write('update', 1.003909240011759, 100n, 0n)], 200n);
    expect(verifyTimelineAgainstMint(stale, cfg).join()).toMatch(/later writes are missing/);
    const complete = buildMultiplierTimeline(
      MINT,
      [write('update', 1.003909240011759, 1_781_000_000n, 1_700_000_000n), write('update', 1.005714560286254, 1_781_000_000n, 1_781_755_200n)],
      1_789_300_800n,
    );
    expect(verifyTimelineAgainstMint(complete, cfg)).toEqual([]);
  });
});
