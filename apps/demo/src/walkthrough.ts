import { randomUUID } from 'node:crypto';
import { generateKeyPairSigner, type Address } from '@solana/kit';
import type { IncomeResponse, JournalResponse, Portfolio } from '@corpact/client';
import { Rational } from '@corpact/domain';
import type { DemoApi } from './api';
import type { DemoChain } from './chain';
import { check, includes, type Check } from './checks';
import { writeIssuerFixtures, type DemoAsset, type DemoCorporateAction, type DemoMultiplierHistory } from './fixtures';
import { table } from './present';
import { runWorker, type WorkerEnv } from './runner';

const DECIMALS = 8;
const HOLDING = 100n;
const SYMBOL = 'DWLKx';

export interface WalkthroughContext {
  chain: DemoChain;
  env: WorkerEnv;
  runId: string;
  fixturesDir: string;
  api: DemoApi;
  say: (markdown: string) => void;
}

/**
 * Part 1: PLAN §8 demo script, one step at a time. Every number shown is read back through the API
 * after the worker syncs the local chain; every step is also a check, so the walkthrough cannot drift.
 */
export async function runWalkthrough(ctx: WalkthroughContext) {
  const { chain, env, api, say } = ctx;
  const checks: Check[] = [];
  const issuer = chain.issuer;
  const holder = await generateKeyPairSigner();
  const mint = await chain.createScaledUiMint(issuer.address, DECIMALS);
  const asset: DemoAsset = { symbol: SYMBOL, name: 'SYNTHETIC Walkthrough Holdings (local network)', underlyingSymbol: 'DWLK', mint };
  const actions: DemoCorporateAction[] = [];
  const history: DemoMultiplierHistory[] = [];
  const owner = encodeURIComponent(holder.address);
  const tokenAccount: Address = await chain.tokenAccount(holder.address, mint);
  await api.register(holder.address);

  const publishIssuerRecords = async () => {
    // The registry verifies mints at the finalized commitment: a mint created moments ago must settle first.
    // (Surfpool serves the latest state at any commitment and hides this; a real validator does not.)
    await chain.waitForClock((await chain.clock()) + 1n, 'finalized');
    writeIssuerFixtures(ctx.fixturesDir, ctx.runId, { assets: [asset], actions, history });
    await runWorker(['sync-registry'], env);
    await runWorker(['import-issuer-actions'], env);
  };
  const sync = async (afterChainActivity: boolean) => {
    if (afterChainActivity) await chain.waitForClock((await chain.clock()) + 1n, 'finalized');
    await runWorker(['sync-wallet', holder.address], env);
  };
  const position = async () => (await api.get<Portfolio>(`/v1/portfolio?owner=${owner}`)).positions.find((p) => p.symbol === SYMBOL);
  const entries = async () =>
    (await api.get<IncomeResponse>(`/v1/income?owner=${owner}`)).entries.filter((e) => e.symbol === SYMBOL).toSorted((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  const journal = async () =>
    (await api.get<JournalResponse>(`/v1/journal?owner=${owner}&limit=200`)).entries.filter((j) => j.symbol === SYMBOL).toSorted((a, b) => Number(a.id) - Number(b.id));
  const near = (value: string | null | undefined, expected: string) =>
    value != null && Rational.fromDecimal(value).sub(Rational.fromDecimal(expected)).abs().compare(Rational.fromDecimal('0.000001')) < 0;
  const eq = (value: string | null | undefined, expected: string) => value != null && Rational.fromDecimal(value).eq(Rational.fromDecimal(expected));
  const iso = (unix: bigint) => new Date(Number(unix) * 1000).toISOString();
  const fmt = (value: string | null | undefined, places = 8) => (value == null ? '-' : Rational.fromDecimal(value).toFixed(places));
  const usd = (value: string | null | undefined) => (value == null ? 'unknown' : `$${Rational.fromDecimal(value).toFixed(2)}`);

  // The issuer's transaction pattern: re-assert the live multiplier, then schedule the next one.
  let current = 1;
  let lastActivation = 0n;
  const schedule = async (factor: number, leadSeconds: bigint) => {
    const before = current;
    const after = before * factor;
    const scheduledUnix = (await chain.clock()) + leadSeconds;
    const { clockUnix } = await chain.updateMultiplier(mint, issuer, [
      { multiplier: before, effectiveUnix: lastActivation },
      { multiplier: after, effectiveUnix: scheduledUnix },
    ]);
    current = after;
    lastActivation = scheduledUnix;
    return { before, after, scheduledUnix, clockUnix };
  };
  const issuerRecord = (s: Awaited<ReturnType<typeof schedule>>, terms: Pick<DemoCorporateAction, 'type'> & Partial<DemoCorporateAction>, reason: string) => {
    const record: DemoCorporateAction = {
      eventId: randomUUID(),
      version: 1,
      symbol: SYMBOL,
      status: 'Initial',
      effectiveUnix: s.scheduledUnix,
      createdUnix: s.clockUnix - 3n,
      multiplierOld: String(s.before),
      multiplierNew: String(s.after),
      grossCashUsd: null,
      netCashUsd: null,
      withholdingTaxRate: null,
      fromUnits: null,
      toUnits: null,
      notes: null,
      ...terms,
    };
    actions.push(record);
    history.push({ id: randomUUID(), symbol: SYMBOL, reason, multiplier: s.after, previousMultiplier: s.before, activationUnix: s.scheduledUnix });
    return record;
  };

  say(`## Part 1 - Walkthrough (SYNTHETIC: local network, generated keys and issuer records)\n`);

  // ── Step 1 ─────────────────────────────────────────────────────────────────────────────
  // The issuer schedules a dividend and publishes its record ahead of activation; the holder is funded before it activates.
  const dividend = await schedule(1.0035, 75n);
  const dividendRecord = issuerRecord(dividend, { type: 'CashDividend', grossCashUsd: '0.50', withholdingTaxRate: '0.30', netCashUsd: '0.35' }, 'Dividend');
  await chain.mintTo(mint, holder.address, HOLDING * 10n ** BigInt(DECIMALS), DECIMALS);
  await publishIssuerRecords();
  await sync(true);
  if ((await chain.clock('finalized')) >= dividend.scheduledUnix) throw new Error('Walkthrough timing: the dividend activated before step 1 was read; raise its lead time');
  const p1 = await position();
  const touches1 = await chain.signatureCount(tokenAccount);
  say(
    [
      `### Step 1 - A holder with a synthetic position`,
      '',
      table(
        ['', ''],
        [
          ['Raw base units on chain', p1?.rawBalance ?? '-'],
          ['Multiplier', String(dividend.before)],
          ['Displayed quantity (raw ÷ 10^8 × multiplier)', fmt(p1?.quantity)],
          ['Protected floor (stock units)', fmt(p1?.protectedQuantity)],
          ['Available to convert', fmt(p1?.availableQuantity)],
          ['Coverage', `${p1?.status}, reconciled to the chain balance: ${p1?.reconciled}`],
        ],
      ),
      '',
      `The issuer has scheduled a cash dividend for ${iso(dividend.scheduledUnix)} (multiplier ${dividend.before} → ${dividend.after}) and published its record: $0.50 gross, 30% withholding, $0.35 net per share.`,
    ].join('\n'),
  );
  checks.push(
    check(
      'Step 1: the position is complete and reconciled, with raw units, displayed quantity and floor',
      p1?.status === 'complete' && p1.reconciled && p1.rawBalance === (HOLDING * 10n ** BigInt(DECIMALS)).toString() && eq(p1.quantity, '100') && eq(p1.protectedQuantity, '100'),
      `status ${p1?.status}, raw ${p1?.rawBalance}, quantity ${p1?.quantity}, floor ${p1?.protectedQuantity}`,
    ),
  );

  // ── Step 2 ─────────────────────────────────────────────────────────────────────────────
  await chain.waitForClock(dividend.scheduledUnix + 1n);
  const touches2 = await chain.signatureCount(tokenAccount);
  await sync(true);
  const p2 = await position();
  const e2 = await entries();
  say(
    [
      `### Step 2 - The dividend activates with no transaction`,
      '',
      table(
        ['', 'Before', 'After activation'],
        [
          ['Raw base units on chain', p1?.rawBalance ?? '-', p2?.rawBalance ?? '-'],
          ["Transactions that ever touched the holder's token account", touches1, touches2],
          ['Displayed quantity', fmt(p1?.quantity), fmt(p2?.quantity)],
        ],
      ),
      '',
      `At ${iso(dividend.scheduledUnix)} the multiplier became ${dividend.after} by chain time alone. No transfer, no account write: an indexer following transfers sees nothing. Corpact detected it from the mint's scheduled multiplier and the cluster clock.`,
    ].join('\n'),
  );
  checks.push(
    check(
      'Step 2: the dividend arrives with no token transfer',
      p2?.rawBalance === p1?.rawBalance && touches2 === touches1 && near(p2?.quantity, '100.35'),
      `raw ${p1?.rawBalance} → ${p2?.rawBalance}; token-account transactions ${touches1} → ${touches2}; quantity ${p1?.quantity} → ${p2?.quantity}`,
      'Income with no account write',
    ),
  );

  // ── Step 3 ─────────────────────────────────────────────────────────────────────────────
  const d = e2.find((e) => e.kind === 'dividend');
  const portfolio2 = await api.get<Portfolio>(`/v1/portfolio?owner=${owner}`);
  say(
    [
      `### Step 3 - The verified dividend entry`,
      '',
      table(
        ['', ''],
        [
          ['Classification', `Verified dividend: issuer CashDividend ${dividendRecord.eventId.slice(0, 8)}, matched on exact multipliers and activation time`],
          ['Extra quantity', fmt(d?.quantityDisplay)],
          ['Estimated event value', `${usd(d?.usd)}, from issuer-reported net cash ($0.35 × 100 shares held); not a market price`],
          ['Form', `Retained in stock: the value arrived as extra shares, not cash. USDC received: ${usd(portfolio2.totals.usdcReceived.usd)}`],
          ['Protected floor / available to convert', `${fmt(p2?.protectedQuantity)} / ${fmt(p2?.availableQuantity)}`],
        ],
      ),
      '',
      `> ${d?.headline ?? ''}`,
    ].join('\n'),
  );
  checks.push(
    check(
      'Step 3: a verified dividend worth $35 from issuer net cash, retained in stock',
      d !== undefined && eq(d.usd, '35') && d.valuation === 'issuer_net_cash' && includes([d.headline], 'remains invested') && eq(p2?.protectedQuantity, '100') && near(p2?.availableQuantity, '0.35'),
      `${d?.kind}, USD ${d?.usd}, valuation ${d?.valuation}, floor ${p2?.protectedQuantity}, available ${p2?.availableQuantity}`,
    ),
  );

  // ── Step 4 ─────────────────────────────────────────────────────────────────────────────
  const split = await schedule(2, 20n);
  issuerRecord(split, { type: 'ForwardSplit', fromUnits: '1', toUnits: '2' }, 'StockSplit');
  await publishIssuerRecords();
  await chain.waitForClock(split.scheduledUnix + 1n);
  await sync(true);
  const p4 = await position();
  const splitEntry = (await entries()).find((e) => e.kind === 'split');
  say(
    [
      `### Step 4 - A 2-for-1 split is not income`,
      '',
      table(
        ['', 'Before split', 'After split'],
        [
          ['Displayed quantity', fmt(p2?.quantity), fmt(p4?.quantity)],
          ['Protected floor', fmt(p2?.protectedQuantity), fmt(p4?.protectedQuantity)],
          ['Dividend income', usd(p2?.dividendIncomeUsd), usd(p4?.dividendIncomeUsd)],
          ['Entry booked by the split', '-', splitEntry ? `split ×${splitEntry.splitFactor}, USD ${splitEntry.usd ?? 'none'}` : 'none'],
        ],
      ),
      '',
      'The quantity basis doubles and the floor moves with it. Income stays exactly where it was: a naive "units went up" reading would book the split as a 100% gain.',
    ].join('\n'),
  );
  checks.push(
    check(
      'Step 4: the split doubles the quantity basis and books zero income',
      splitEntry !== undefined && splitEntry.usd === null && eq(splitEntry.splitFactor, '2') && eq(p4?.dividendIncomeUsd, '35') && near(p4?.quantity, '200.7') && eq(p4?.protectedQuantity, '200'),
      `split ×${splitEntry?.splitFactor}, income ${p2?.dividendIncomeUsd} → ${p4?.dividendIncomeUsd}, quantity ${p4?.quantity}, floor ${p4?.protectedQuantity}`,
      'A split is not income',
    ),
  );

  // ── Step 5 ─────────────────────────────────────────────────────────────────────────────
  const journalBefore = await journal();
  actions.push({
    ...dividendRecord,
    version: 2,
    status: 'Corrected',
    createdUnix: await chain.clock(),
    withholdingTaxRate: '0.34',
    netCashUsd: '0.33',
    notes: 'SYNTHETIC correction: withholding revised from 30% to 34%',
  });
  await publishIssuerRecords();
  await sync(false);
  const j5 = await journal();
  const d5 = (await entries()).find((e) => e.kind === 'dividend');
  const p5 = await position();
  const reversal = j5.find((j) => j.entryType === 'reversal' && j.changeReason === 'issuer_correction');
  const replacement = j5.find((j) => j.entryType === 'recognition' && j.kind === 'dividend' && j.issuerRevision === 2);
  const original = j5.find((j) => j.id === reversal?.reversesId);
  say(
    [
      `### Step 5 - The issuer corrects the dividend`,
      '',
      'The issuer publishes revision 2 of the dividend: withholding 34% instead of 30%, net $0.33 per share.',
      '',
      table(
        ['Journal row', 'Entry', 'Kind', 'USD', 'Issuer revision', 'Reason'],
        j5.map((j) => [
          `#${j.id}`,
          j.entryType === 'reversal' ? `reversal of #${j.reversesId}` : 'recognition',
          j.kind,
          // A split has no USD value at all; "unknown" is reserved for a dividend whose value is missing.
          j.kind === 'dividend' ? usd(j.usd) : '-',
          j.issuerRevision ?? '-',
          j.changeReason,
        ]),
      ),
      '',
      `The original recognition (#${original?.id}, ${usd(original?.usd)}) is still there. It is reversed by #${reversal?.id} and replaced by #${replacement?.id} at ${usd(replacement?.usd)}. Nothing was edited or deleted. The income entry now shows ${usd(d5?.usd)} as revision ${d5?.revision}.`,
      '',
      `Conversion for this position: ${p5?.conversionDisabledReasons.join('; ')}.`,
    ].join('\n'),
  );
  checks.push(
    check(
      'Step 5: the correction appends a reversal and a replacement; the original row survives',
      reversal !== undefined &&
        replacement !== undefined &&
        eq(original?.usd, '35') &&
        eq(replacement.usd, '33') &&
        eq(d5?.usd, '33') &&
        d5?.revision === 2 &&
        journalBefore.every((old) => j5.some((j) => j.id === old.id && j.usd === old.usd && j.entryType === old.entryType)) &&
        includes(p5?.conversionDisabledReasons ?? [], 'issuer corrected'),
      `reversal #${reversal?.id} of #${reversal?.reversesId}; replacement #${replacement?.id} ${replacement?.usd}; income ${d5?.usd} revision ${d5?.revision}`,
      'Corrections never rewrite history (ADR-0003)',
    ),
  );

  return { checks, asset, actions, history };
}
