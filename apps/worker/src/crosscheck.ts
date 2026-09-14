import type { Queryable } from '@corpact/db';
import { TOKEN_2022_PROGRAM, decodeToken2022Mint, type TokenAccountSnapshot } from '@corpact/solana';
import type { Context } from './context';

/**
 * Independent reconciliation provider (PLAN Appendix B). Balances and mint multiplier state
 * read from the primary RPC are compared with a second provider at the same slot or later.
 * A disagreement pauses conversion for what it affects; it never changes the ledger.
 */

export type ProviderOutcome = 'agree' | 'disagree' | 'inconclusive';
type RawAccount = { owner: string; data: Uint8Array } | null;

export interface BalanceDifference {
  account: string;
  mint: string;
  primaryRaw: string | null;
  secondaryRaw: string | null;
}

export interface MintStateDifference {
  mint: string;
  field: string;
  primary: string;
  secondary: string;
}

/** Allowlisted token-account differences. An account absent on one side matches only a zero balance. */
export function compareTokenBalances(
  primary: readonly TokenAccountSnapshot[],
  secondary: readonly TokenAccountSnapshot[],
  mints: ReadonlySet<string>,
): BalanceDifference[] {
  const index = (list: readonly TokenAccountSnapshot[]) => new Map(list.filter((a) => mints.has(a.mint)).map((a) => [a.address as string, a]));
  const p = index(primary);
  const s = index(secondary);
  const differences: BalanceDifference[] = [];
  for (const account of [...new Set([...p.keys(), ...s.keys()])].sort()) {
    const a = p.get(account);
    const b = s.get(account);
    const sameMint = !a || !b || a.mint === b.mint;
    if (sameMint && (a?.amount ?? 0n) === (b?.amount ?? 0n)) continue;
    differences.push({
      account,
      mint: (a ?? b)!.mint,
      primaryRaw: a ? a.amount.toString() : null,
      secondaryRaw: b ? b.amount.toString() : null,
    });
  }
  return differences;
}

/** The mint fields a multiplier or balance depends on. Supply is excluded: it moves with every mint and burn. */
function describeMint(account: RawAccount): Record<string, string> {
  if (!account) return { account: 'missing' };
  try {
    const decoded = decodeToken2022Mint(account.data);
    const c = decoded.scaledUiAmount;
    return {
      owner: account.owner,
      decimals: String(decoded.decimals),
      multiplierAuthority: c?.authority ?? 'none',
      multiplier: c?.multiplierBits ?? 'none',
      newMultiplier: c?.newMultiplierBits ?? 'none',
      newMultiplierEffectiveTimestamp: c ? c.newMultiplierEffectiveTimestamp.toString() : 'none',
    };
  } catch (error) {
    return { account: `undecodable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function compareMintStates(
  primary: ReadonlyMap<string, RawAccount>,
  secondary: ReadonlyMap<string, RawAccount>,
  mints: readonly string[],
): MintStateDifference[] {
  const differences: MintStateDifference[] = [];
  for (const mint of mints) {
    const a = describeMint(primary.get(mint) ?? null);
    const b = describeMint(secondary.get(mint) ?? null);
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      if (a[field] !== b[field]) differences.push({ mint, field, primary: a[field] ?? 'absent', secondary: b[field] ?? 'absent' });
    }
  }
  return differences;
}

const hostOf = (url: string) => new URL(url).host;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const amountOf = (accounts: readonly TokenAccountSnapshot[], address: string) => accounts.find((a) => a.address === address)?.amount ?? 0n;

interface CheckRow {
  kind: 'token_balances' | 'mint_state';
  subject: string;
  primaryHost: string;
  secondaryHost: string;
  primarySlot: bigint;
  secondarySlot: bigint | null;
  outcome: ProviderOutcome;
  details: readonly unknown[];
}

/**
 * Append a check and return the previous outcome for its subject. A repeated agreement is
 * written at most once per `quietSeconds`, so polling does not flood the table.
 */
export async function recordProviderCheck(q: Queryable, row: CheckRow, quietSeconds = 0): Promise<ProviderOutcome | null> {
  const { rows } = await q.query(
    `SELECT outcome, extract(epoch FROM now() - checked_at)::bigint AS age FROM provider_checks
      WHERE kind = $1 AND subject = $2 ORDER BY id DESC LIMIT 1`,
    [row.kind, row.subject],
  );
  const previous = (rows[0]?.outcome as ProviderOutcome | undefined) ?? null;
  if (previous === 'agree' && row.outcome === 'agree' && Number(rows[0].age) < quietSeconds) return previous;
  await q.query(
    `INSERT INTO provider_checks (kind, subject, primary_host, secondary_host, primary_slot, secondary_slot, outcome, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.kind, row.subject, row.primaryHost, row.secondaryHost, row.primarySlot.toString(), row.secondarySlot?.toString() ?? null,
      row.outcome, JSON.stringify(row.details),
    ],
  );
  return previous;
}

/**
 * Compare a wallet's primary inventory snapshot with the independent provider. Null when none is configured.
 *
 * The providers rarely answer for the same slot. A difference is re-read on the primary at the
 * secondary's slot or later; if the primary has moved past it, the difference still counts where the
 * primary reports the same balance on both sides of that slot, since nothing legitimately changed in between.
 */
export async function crossCheckBalances(
  ctx: Context,
  owner: string,
  primary: { slot: bigint; accounts: TokenAccountSnapshot[] },
  mints: ReadonlySet<string>,
): Promise<{ outcome: ProviderOutcome; differences: BalanceDifference[] } | null> {
  const reconciler = ctx.reconciler;
  if (!reconciler) return null;
  const base = { kind: 'token_balances' as const, subject: owner, primaryHost: hostOf(ctx.chain.rpcUrl), secondaryHost: hostOf(reconciler.rpcUrl) };
  try {
    const secondary = await reconciler.tokenAccountsByOwner(owner, TOKEN_2022_PROGRAM, { minContextSlot: primary.slot });
    let primarySlot = primary.slot;
    let differences = compareTokenBalances(primary.accounts, secondary.accounts, mints);
    if (differences.length > 0 && secondary.slot !== primary.slot) {
      const again = await ctx.chain.tokenAccountsByOwner(owner, TOKEN_2022_PROGRAM, { minContextSlot: secondary.slot });
      primarySlot = again.slot;
      differences = compareTokenBalances(again.accounts, secondary.accounts, mints);
      const bracketedAndStable =
        again.slot === secondary.slot || differences.every((d) => amountOf(primary.accounts, d.account) === amountOf(again.accounts, d.account));
      if (differences.length > 0 && !bracketedAndStable) {
        await recordProviderCheck(ctx.db, { ...base, primarySlot, secondarySlot: secondary.slot, outcome: 'inconclusive', details: differences });
        ctx.log('warn', 'provider balance check inconclusive: balances moved around the compared slot', { owner, secondaryHost: base.secondaryHost });
        return { outcome: 'inconclusive', differences };
      }
    }
    const outcome: ProviderOutcome = differences.length > 0 ? 'disagree' : 'agree';
    await recordProviderCheck(ctx.db, { ...base, primarySlot, secondarySlot: secondary.slot, outcome, details: differences });
    if (outcome === 'disagree') ctx.log('error', 'providers disagree on token balances', { owner, differences, ...base });
    return { outcome, differences };
  } catch (error) {
    ctx.log('warn', 'independent provider balance check failed', { owner, secondaryHost: base.secondaryHost, error });
    await recordProviderCheck(ctx.db, { ...base, primarySlot: primary.slot, secondarySlot: null, outcome: 'inconclusive', details: [{ error: errorText(error) }] });
    return { outcome: 'inconclusive', differences: [] };
  }
}

/** Compare mint multiplier state with the independent provider, by the same slot rules. Returns mints whose outcome changed. */
export async function crossCheckMints(
  ctx: Context,
  mints: readonly string[],
  primary: { slot: bigint; accounts: ReadonlyMap<string, RawAccount> },
): Promise<string[]> {
  const reconciler = ctx.reconciler;
  if (!reconciler || mints.length === 0) return [];
  const base = { kind: 'mint_state' as const, primaryHost: hostOf(ctx.chain.rpcUrl), secondaryHost: hostOf(reconciler.rpcUrl) };
  const changed: string[] = [];
  const record = async (mint: string, row: Omit<CheckRow, 'kind' | 'subject' | 'primaryHost' | 'secondaryHost'>) => {
    // Agreement is re-recorded hourly; any other outcome every time it is observed.
    const previous = await recordProviderCheck(ctx.db, { ...base, subject: mint, ...row }, 3600);
    if (previous !== row.outcome && (previous === 'disagree' || row.outcome === 'disagree')) changed.push(mint);
  };

  try {
    const secondary = await reconciler.accounts(mints, { minContextSlot: primary.slot });
    let primarySlot = primary.slot;
    let differences = compareMintStates(primary.accounts, secondary.accounts, mints);
    const unstable = new Set<string>();
    if (differences.length > 0 && secondary.slot !== primary.slot) {
      const differing = [...new Set(differences.map((d) => d.mint))];
      const again = await ctx.chain.accounts(differing, { minContextSlot: secondary.slot });
      primarySlot = again.slot;
      if (again.slot !== secondary.slot) {
        for (const d of compareMintStates(primary.accounts, again.accounts, differing)) unstable.add(d.mint);
      }
      differences = compareMintStates(new Map([...primary.accounts, ...again.accounts]), secondary.accounts, mints);
    }
    for (const mint of mints) {
      const own = differences.filter((d) => d.mint === mint);
      const outcome: ProviderOutcome = own.length === 0 ? 'agree' : unstable.has(mint) ? 'inconclusive' : 'disagree';
      await record(mint, { primarySlot, secondarySlot: secondary.slot, outcome, details: own });
      if (outcome === 'disagree') ctx.log('error', 'providers disagree on mint state', { mint, differences: own, ...base });
    }
  } catch (error) {
    ctx.log('warn', 'independent provider mint check failed', { secondaryHost: base.secondaryHost, error });
    for (const mint of mints) await record(mint, { primarySlot: primary.slot, secondarySlot: null, outcome: 'inconclusive', details: [{ error: errorText(error) }] });
  }
  return changed;
}
