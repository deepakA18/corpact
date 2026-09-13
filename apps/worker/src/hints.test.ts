import { describe, expect, it } from 'vitest';
import { address, type MultiplierTransition } from '@corpact/solana';
import { hintSatisfied } from './hints';

const HOUR = 3600n;
const ACTIVATION = 1_774_569_300n; // 2026-03-26T23:55:00Z

const transition = (overrides: Partial<MultiplierTransition>): MultiplierTransition => ({
  mint: address('XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9'),
  updateSignature: 'sig',
  observedAt: { slot: 1n, txIndex: null, instructionPath: [0] },
  scheduledUnix: ACTIVATION,
  effectiveUnix: ACTIVATION,
  immediate: false,
  oldMultiplierBits: '000000000000f03f',
  newMultiplierBits: '0000000000000840',
  status: 'active',
  ...overrides,
});

describe('hintSatisfied', () => {
  it('accepts a write scheduled ahead of its activation', () => {
    expect(hintSatisfied([transition({})], ACTIVATION)).toBe(true);
  });

  it('accepts a write published shortly after its schedule (VTIx: 70 s late)', () => {
    expect(hintSatisfied([transition({ immediate: true, effectiveUnix: ACTIVATION + 70n })], ACTIVATION)).toBe(true);
  });

  it('rejects a value that only appears when a later transaction re-asserts it weeks afterwards', () => {
    expect(hintSatisfied([transition({ immediate: true, effectiveUnix: ACTIVATION + 24n * 30n * HOUR })], ACTIVATION)).toBe(false);
  });

  it('rejects superseded writes and unrelated activations', () => {
    expect(hintSatisfied([transition({ status: 'superseded' })], ACTIVATION)).toBe(false);
    expect(hintSatisfied([transition({ scheduledUnix: ACTIVATION + 1n })], ACTIVATION)).toBe(false);
    expect(hintSatisfied([], ACTIVATION)).toBe(false);
  });
});
