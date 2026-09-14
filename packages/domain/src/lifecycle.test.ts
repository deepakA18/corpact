import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_STATES,
  LifecycleError,
  appendLifecycle,
  canTransition,
  currentState,
  deriveLifecycle,
  isTerminal,
  type IssuerRevision,
  type LifecycleState,
} from './lifecycle';

const at = (s: number) => new Date(1_780_000_000_000 + s * 1000);
const step = (state: LifecycleState, s: number) => ({ state, at: at(s), reason: state, evidence: null });

describe('lifecycle state machine', () => {
  it('allows the documented path and refuses to leave a terminal state', () => {
    let h = appendLifecycle([], step('announced', 0));
    h = appendLifecycle(h, step('announced', 5));
    h = appendLifecycle(h, step('confirmed', 10));
    h = appendLifecycle(h, step('activated', 20));
    h = appendLifecycle(h, step('corrected', 30));
    h = appendLifecycle(h, step('reversed', 40));
    expect(currentState(h)).toBe('reversed');
    expect(() => appendLifecycle(h, step('activated', 50))).toThrow(LifecycleError);
  });

  it('refuses to begin corrected, reversed or superseded, and refuses steps back in time', () => {
    for (const s of ['corrected', 'reversed', 'superseded'] as const) expect(() => appendLifecycle([], step(s, 0))).toThrow(LifecycleError);
    expect(() => appendLifecycle(appendLifecycle([], step('confirmed', 10)), step('activated', 5))).toThrow(LifecycleError);
    expect(() => appendLifecycle(appendLifecycle([], step('activated', 10)), step('announced', 20))).toThrow(LifecycleError);
  });

  it('never produces a history with an illegal transition (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...LIFECYCLE_STATES), { maxLength: 12 }), (states) => {
        let history: ReturnType<typeof appendLifecycle> = [];
        states.forEach((state, i) => {
          try {
            history = appendLifecycle(history, step(state, i));
          } catch (error) {
            expect(error).toBeInstanceOf(LifecycleError);
          }
        });
        for (let i = 1; i < history.length; i++) expect(canTransition(history[i - 1]!.state, history[i]!.state)).toBe(true);
        for (let i = 0; i < history.length - 1; i++) expect(isTerminal(history[i]!.state)).toBe(false);
      }),
    );
  });
});

describe('deriveLifecycle', () => {
  const rev = (version: number, created: number, status: IssuerRevision['status'] = 'Initial', notes: string | null = null): IssuerRevision => ({
    version,
    type: 'CashDividend',
    status,
    createdAt: at(created),
    notes,
    sha256: 'ab',
  });
  const chain = (status: 'scheduled' | 'active' | 'superseded' | 'orphaned', published: number, activated: number | null, superseded: number | null = null) => ({
    signature: 'sig',
    status,
    publishedAt: at(published),
    activatedAt: activated === null ? null : at(activated),
    supersededAt: superseded === null ? null : at(superseded),
  });
  const states = (e: Parameters<typeof deriveLifecycle>[0]) => deriveLifecycle(e).map((s) => s.state);
  const issuer = (...revisions: IssuerRevision[]) => ({ eventId: 'evt', revisions });

  it('announced → confirmed → activated for an ordinary scheduled dividend', () => {
    expect(states({ issuer: issuer(rev(1, 0)), chain: chain('active', 3, 100), correctedAt: null, reversedAt: null })).toEqual(['announced', 'confirmed', 'activated']);
  });

  it('skips confirmation for an immediate (late) publication, and announcement for a late issuer record', () => {
    expect(states({ issuer: issuer(rev(1, 0)), chain: chain('active', 90, 90), correctedAt: null, reversedAt: null })).toEqual(['announced', 'activated']);
    expect(states({ issuer: issuer(rev(1, 500)), chain: chain('active', 3, 100), correctedAt: null, reversedAt: null })).toEqual(['confirmed', 'activated']);
  });

  it('ends superseded when a schedule is replaced before activation', () => {
    expect(states({ issuer: null, chain: chain('superseded', 3, null, 40), correctedAt: null, reversedAt: null })).toEqual(['confirmed', 'superseded']);
  });

  it('records every pre-activation revision as its own step instead of collapsing them', () => {
    const steps = deriveLifecycle({
      issuer: issuer(rev(1, 0, 'Scheduled'), rev(2, 10, 'Cancelled', '[CANCELLED v1] Will be a cash flow'), rev(3, 20, 'Scheduled'), rev(4, 25, 'Initial')),
      chain: chain('active', 30, 100),
      correctedAt: null,
      reversedAt: null,
    });
    expect(steps.map((s) => s.state)).toEqual(['announced', 'announced', 'announced', 'announced', 'confirmed', 'activated']);
    expect(steps[1]!.reason).toMatch(/v2 Cancelled .*Will be a cash flow/);
  });

  it('records a correction after activation, and a cancellation before anything happened on chain', () => {
    expect(states({ issuer: issuer(rev(1, 0), rev(2, 400, 'Corrected')), chain: chain('active', 3, 100), correctedAt: at(410), reversedAt: null })).toEqual([
      'announced', 'confirmed', 'activated', 'corrected',
    ]);
    expect(states({ issuer: issuer(rev(1, 0, 'Scheduled'), rev(2, 50, 'Cancelled')), chain: null, correctedAt: null, reversedAt: null })).toEqual([
      'announced', 'announced', 'reversed',
    ]);
    expect(states({ issuer: issuer(rev(1, 0)), chain: chain('active', 3, 100), correctedAt: null, reversedAt: at(410) })).toEqual(['announced', 'confirmed', 'activated', 'reversed']);
  });

  it('names the revision each step supersedes, and activates without confirmation when only the activation is known', () => {
    const steps = deriveLifecycle({
      issuer: issuer(rev(1, 0, 'Scheduled'), rev(2, 10, 'Cancelled', '[CANCELLED v1]'), rev(3, 20, 'Scheduled'), rev(4, 25, 'Initial'), rev(5, 26, 'Cancelled', '[CANCELLED v3]')),
      chain: { signature: 'history', status: 'active', publishedAt: null, activatedAt: at(100), supersededAt: null },
      correctedAt: null,
      reversedAt: null,
    });
    expect(steps.map((s) => [s.state, s.revision?.supersedes ?? null])).toEqual([
      ['announced', null], ['announced', 1], ['announced', null], ['announced', 3], ['announced', 3], ['activated', null],
    ]);
  });

  it('does not reverse an action whose delivered revision survives a later cancellation of an older schedule', () => {
    expect(states({ issuer: issuer(rev(1, 0, 'Scheduled'), rev(2, 5, 'Initial'), rev(3, 9, 'Cancelled', '[CANCELLED v1]')), chain: null, correctedAt: null, reversedAt: null })).toEqual([
      'announced', 'announced', 'announced',
    ]);
  });

  it('stays announced for an upcoming action with nothing on chain', () => {
    expect(states({ issuer: issuer(rev(1, 0, 'Scheduled')), chain: null, correctedAt: null, reversedAt: null })).toEqual(['announced']);
  });
});
