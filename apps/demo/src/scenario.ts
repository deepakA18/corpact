import { randomUUID } from 'node:crypto';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import type { DemoChain } from './chain';
import type { DemoAsset, DemoCorporateAction, DemoMultiplierHistory } from './fixtures';

/** What the public API should report for one activation. Matched per symbol, in activation order. */
export type ExpectedEntry =
  | { kind: 'dividend'; usd: 'valued' }
  | { kind: 'dividend'; usd: 'unknown'; warning: string }
  | { kind: 'split' }
  | { kind: 'unclassified_adjustment'; reason: string };

export interface TrapEvent {
  label: string;
  /** The Phase 0 finding or release-checklist item this event reproduces. */
  trap: string;
  symbol: string;
  scheduledUnix: bigint;
  /** Null when the change must never become active (superseded). */
  firstSync: ExpectedEntry | null;
  /** After late issuer publications and corrections are ingested; defaults to `firstSync`. */
  afterCorrections?: ExpectedEntry | null;
}

export interface Scenario {
  holder: Address;
  assets: DemoAsset[];
  /** Published before the first sync. */
  actions: DemoCorporateAction[];
  /** Published only after the first sync: a late issuer record and a correction. */
  laterActions: DemoCorporateAction[];
  history: DemoMultiplierHistory[];
  events: TrapEvent[];
  supersededScheduleUnix: bigint;
  latePublication: { scheduledUnix: bigint; publishedUnix: bigint };
  correctedEventId: string;
  lastActivityUnix: bigint;
}

const DECIMALS = 8;
const units = (n: bigint) => n * 10n ** BigInt(DECIMALS);
/** Seconds between publishing a schedule and its activation. */
const LEAD = 8n;

const VALID_DIVIDEND = { grossCashUsd: '0.50', withholdingTaxRate: '0.30', netCashUsd: '0.35' } as const;
/** 0.35 net at ~$100 reinvestment: every valid synthetic dividend implies the same price. */
const DIVIDEND_FACTOR = 1.0035;

/** The adjacent f64 above `x`: the issuer's endpoints disagree by exactly this much (HONx 2026-05-15). */
function nextUp(x: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

interface MintState {
  symbol: string;
  mint: Address;
  authority: KeyPairSigner;
  current: number;
  lastActivation: bigint;
}

type ActionTerms = Partial<Pick<DemoCorporateAction, 'grossCashUsd' | 'withholdingTaxRate' | 'netCashUsd' | 'fromUnits' | 'toUnits' | 'notes'>> & {
  type: DemoCorporateAction['type'];
  /** Publish the issuer's decimal for the adjacent f64 instead of the chain value. */
  lastBitDisagreement?: boolean;
  publish?: 'before-first-sync' | 'after-first-sync';
};

export async function runScenario(chain: DemoChain, log: (line: string) => void): Promise<Scenario> {
  const holder = await generateKeyPairSigner();
  const issuer = chain.issuer;
  const assets: DemoAsset[] = [];
  const actions: DemoCorporateAction[] = [];
  const laterActions: DemoCorporateAction[] = [];
  const history: DemoMultiplierHistory[] = [];
  const events: TrapEvent[] = [];

  const record = (
    state: MintState,
    step: { label: string; trap: string; historyReason: string | null; scheduledUnix: bigint; clockUnix: bigint; before: number; after: number },
    terms: ActionTerms | null,
    expected: Pick<TrapEvent, 'firstSync' | 'afterCorrections'>,
  ): string | null => {
    events.push({ label: step.label, trap: step.trap, symbol: state.symbol, scheduledUnix: step.scheduledUnix, ...expected });
    if (step.historyReason !== null) {
      history.push({
        id: randomUUID(),
        symbol: state.symbol,
        reason: step.historyReason,
        multiplier: step.after,
        previousMultiplier: step.before,
        activationUnix: step.scheduledUnix,
      });
    }
    if (!terms) return null;
    const action: DemoCorporateAction = {
      eventId: randomUUID(),
      version: 1,
      symbol: state.symbol,
      type: terms.type,
      status: 'Initial',
      effectiveUnix: step.scheduledUnix,
      // Issuer records are created seconds before the chain write (UNHx: 3 s).
      createdUnix: step.clockUnix - 3n,
      multiplierOld: String(step.before),
      multiplierNew: String(terms.lastBitDisagreement ? nextUp(step.after) : step.after),
      grossCashUsd: terms.grossCashUsd ?? null,
      netCashUsd: terms.netCashUsd ?? null,
      withholdingTaxRate: terms.withholdingTaxRate ?? null,
      fromUnits: terms.fromUnits ?? null,
      toUnits: terms.toUnits ?? null,
      notes: terms.notes ?? null,
    };
    (terms.publish === 'after-first-sync' ? laterActions : actions).push(action);
    return action.eventId;
  };

  /** The issuer's transaction pattern: re-assert the live value, then schedule the next one. */
  async function scheduleAndActivate(
    state: MintState,
    step: { label: string; trap: string; factor: number; historyReason: string | null; beforeActivation?: () => Promise<unknown> },
    terms: ActionTerms | null,
    expected: Pick<TrapEvent, 'firstSync' | 'afterCorrections'>,
  ): Promise<string | null> {
    const before = state.current;
    const after = before * step.factor;
    const scheduledUnix = (await chain.clock()) + LEAD;
    const { clockUnix } = await chain.updateMultiplier(state.mint, state.authority, [
      { multiplier: before, effectiveUnix: state.lastActivation },
      { multiplier: after, effectiveUnix: scheduledUnix },
    ]);
    await step.beforeActivation?.();
    await chain.waitForClock(scheduledUnix + 1n);
    state.current = after;
    state.lastActivation = scheduledUnix;
    log(`  ${state.symbol} ${step.label}: ${before} → ${after} at ${new Date(Number(scheduledUnix) * 1000).toISOString()}`);
    return record(state, { ...step, scheduledUnix, clockUnix, before, after }, terms, expected);
  }

  // ── DDIVx: a fully covered position that walks through the traps ─────────────────────────
  const ddiv: MintState = { symbol: 'DDIVx', mint: await chain.createScaledUiMint(issuer.address, DECIMALS), authority: issuer, current: 1, lastActivation: 0n };
  assets.push({ symbol: ddiv.symbol, name: 'SYNTHETIC Demo Dividend Co (local validator)', underlyingSymbol: 'DDIV', mint: ddiv.mint });
  log(`DDIVx mint ${ddiv.mint}`);

  const correctedEventId = (await scheduleAndActivate(
    ddiv,
    {
      label: 'D1 cash dividend (later corrected)',
      trap: 'Verified dividend with no account transfer; later an issuer correction (reversal + replacement)',
      factor: DIVIDEND_FACTOR,
      historyReason: 'Dividend',
      // First multiplier write lands before the holder is funded, so the position is fully covered.
      beforeActivation: () => chain.mintTo(ddiv.mint, holder.address, units(100n), DECIMALS),
    },
    { type: 'CashDividend', ...VALID_DIVIDEND },
    { firstSync: { kind: 'dividend', usd: 'valued' } },
  ))!;

  await chain.mintTo(ddiv.mint, holder.address, units(50n), DECIMALS);
  await scheduleAndActivate(
    ddiv,
    { label: 'D2 cash dividend after a deposit', trap: 'Historical transfers replay into the protected floor', factor: DIVIDEND_FACTOR, historyReason: 'Dividend' },
    { type: 'CashDividend', ...VALID_DIVIDEND },
    { firstSync: { kind: 'dividend', usd: 'valued' } },
  );
  await scheduleAndActivate(
    ddiv,
    { label: 'D3 implausible issuer cash', trap: 'STRCx 2025-11-30: issuer cash implying ~$953k/share', factor: DIVIDEND_FACTOR, historyReason: 'Dividend' },
    { type: 'CashDividend', grossCashUsd: '500.00', withholdingTaxRate: '0.30', netCashUsd: '350.00' },
    { firstSync: { kind: 'dividend', usd: 'unknown', warning: 'issuer valuation not used' } },
  );
  await scheduleAndActivate(
    ddiv,
    { label: 'D4 no issuer cash', trap: '16 dividends with null netCashflowUsd: USD null, never zero', factor: DIVIDEND_FACTOR, historyReason: 'Dividend' },
    { type: 'CashDividend' },
    { firstSync: { kind: 'dividend', usd: 'unknown', warning: 'no net cash' } },
  );

  await chain.transfer(ddiv.mint, holder, issuer.address, units(40n), DECIMALS);
  await scheduleAndActivate(
    ddiv,
    { label: 'S1 2-for-1 forward split after a withdrawal', trap: 'A split doubles units but books no income', factor: 2, historyReason: 'StockSplit' },
    { type: 'ForwardSplit', fromUnits: '1', toUnits: '2' },
    { firstSync: { kind: 'split' } },
  );
  await scheduleAndActivate(
    ddiv,
    { label: 'SP spin-off labelled "Dividend"', trap: 'Multiplier-history reason is not evidence (GMEx/HONx spin-offs labelled Dividend); a spin-off is a basis allocation, not income', factor: 1.05, historyReason: 'Dividend' },
    { type: 'SpinOff' },
    { firstSync: { kind: 'unclassified_adjustment', reason: 'basis allocation, not income' } },
  );
  await scheduleAndActivate(
    ddiv,
    { label: 'N1 change with no corporate action', trap: '8 dividend-labelled changes with no issuer action (STRCx, SATAx, …)', factor: 1.002, historyReason: 'Dividend' },
    null,
    { firstSync: { kind: 'unclassified_adjustment', reason: 'No published issuer action matches' } },
  );

  // Superseded: schedule a value, then replace it before it activates.
  const supersededScheduleUnix = (await chain.clock()) + 60n;
  await chain.updateMultiplier(ddiv.mint, issuer, [
    { multiplier: ddiv.current, effectiveUnix: ddiv.lastActivation },
    { multiplier: ddiv.current * 1.01, effectiveUnix: supersededScheduleUnix },
  ]);
  events.push({
    label: 'X schedule replaced before activation',
    trap: 'A pending multiplier overwritten before its time never becomes live',
    symbol: ddiv.symbol,
    scheduledUnix: supersededScheduleUnix,
    firstSync: null,
  });
  log(`  DDIVx X: scheduled ×1.01 for ${new Date(Number(supersededScheduleUnix) * 1000).toISOString()}, replacing it next`);
  await scheduleAndActivate(
    ddiv,
    { label: 'D5 dividend whose issuer decimal differs in the last bit', trap: 'Issuer endpoints disagree by one f64 step (HONx 2026-05-15)', factor: DIVIDEND_FACTOR, historyReason: 'Dividend' },
    { type: 'CashDividend', ...VALID_DIVIDEND, lastBitDisagreement: true },
    { firstSync: { kind: 'dividend', usd: 'valued' } },
  );

  // Late publication: the write lands after its own scheduled time and applies at publication.
  let latePublication: Scenario['latePublication'];
  {
    // Keep schedules in order: the late one is still after D5's activation.
    await chain.waitForClock(ddiv.lastActivation + 25n);
    const before = ddiv.current;
    const after = before * DIVIDEND_FACTOR;
    const scheduledUnix = (await chain.clock()) - 20n;
    const { clockUnix } = await chain.updateMultiplier(ddiv.mint, issuer, [
      { multiplier: before, effectiveUnix: ddiv.lastActivation },
      { multiplier: after, effectiveUnix: scheduledUnix },
    ]);
    ddiv.current = after;
    ddiv.lastActivation = scheduledUnix;
    record(
      ddiv,
      { label: 'D6 dividend published 20 s after its schedule', trap: 'VTIx 2026-03-26: write published 70 s late must not read as missing history', historyReason: 'Dividend', scheduledUnix, clockUnix, before, after },
      { type: 'CashDividend', ...VALID_DIVIDEND },
      { firstSync: { kind: 'dividend', usd: 'valued' } },
    );
    log(`  DDIVx D6: ${before} → ${after}, scheduled ${scheduledUnix}, published ${clockUnix}`);
    latePublication = { scheduledUnix, publishedUnix: clockUnix };
  }

  await scheduleAndActivate(
    ddiv,
    { label: 'D7 dividend whose issuer record arrives late', trap: 'Late ingestion: unclassified until the issuer publishes, then recognized', factor: DIVIDEND_FACTOR, historyReason: 'Dividend' },
    { type: 'CashDividend', ...VALID_DIVIDEND, publish: 'after-first-sync' },
    {
      firstSync: { kind: 'unclassified_adjustment', reason: 'No published issuer action matches' },
      afterCorrections: { kind: 'dividend', usd: 'valued' },
    },
  );

  // ── DPARx: held before its multiplier history is observable → partial, no yield claim ───
  // A separate deployer creates the mint, so its ScaledUiAmount initialize sits outside every
  // authority window the backfill scans - like mainnet mints whose early history is out of reach.
  const parAuthority = await generateKeyPairSigner();
  const parDeployer = await chain.fundedSigner();
  const dpar: MintState = {
    symbol: 'DPARx',
    mint: await chain.createScaledUiMint(parAuthority.address, DECIMALS, parDeployer),
    authority: parAuthority,
    current: 1,
    lastActivation: 0n,
  };
  assets.push({ symbol: dpar.symbol, name: 'SYNTHETIC Demo Partial History Inc (local validator)', underlyingSymbol: 'DPAR', mint: dpar.mint });
  log(`DPARx mint ${dpar.mint}`);
  await chain.mintTo(dpar.mint, holder.address, units(10n), DECIMALS);
  // Block times are whole seconds: the first observable multiplier write must land strictly after the funding.
  await chain.waitForClock((await chain.clock()) + 2n);
  await scheduleAndActivate(
    dpar,
    { label: 'P1 dividend on a position held before the first observed multiplier write', trap: 'Partial history is visible and excluded from yield claims', factor: DIVIDEND_FACTOR, historyReason: 'Dividend' },
    { type: 'CashDividend', ...VALID_DIVIDEND },
    { firstSync: { kind: 'dividend', usd: 'valued' } },
  );

  // The correction: a Corrected revision of D1 with different net cash.
  const original = actions.find((a) => a.eventId === correctedEventId)!;
  laterActions.push({
    ...original,
    version: 2,
    status: 'Corrected',
    createdUnix: (await chain.clock()) + 1n,
    grossCashUsd: '0.50',
    withholdingTaxRate: '0.34',
    netCashUsd: '0.33',
    notes: 'SYNTHETIC correction: withholding revised from 30% to 34%',
  });

  return {
    holder: holder.address,
    assets,
    actions,
    laterActions,
    history,
    events,
    supersededScheduleUnix,
    latePublication,
    correctedEventId,
    lastActivityUnix: await chain.clock(),
  };
}
