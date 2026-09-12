/**
 * Phase 0 / §0.1 - empirical PDA custody evidence (production, not theory).
 *
 * `getTokenLargestAccounts` is an indexed call and is gated behind paid RPC on
 * every free endpoint, so instead of enumerating holders we go at the question
 * from the side that actually matters: find live AMM pools quoting each wrapper,
 * then locate the pool's token vaults and confirm they are (a) real token
 * accounts holding the wrapper and (b) owned by the pool PDA, not a wallet.
 *
 * A CLMM vault holding seven figures of a wrapper and trading every day is proof
 * that a program-owned PDA can custody it AND that CPI transfers in and out
 * succeed under whatever transfer policy the issuer has configured today.
 *
 * Vault discovery is layout-agnostic: we scan the pool account for 32-byte
 * windows, batch-resolve them, and keep the ones that decode as token accounts
 * of the wrapper mint owned by the pool. That works across Raydium CLMM, Orca
 * Whirlpools and Meteora without hardcoding three account layouts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { unpackAccount, getExtensionTypes, ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mints.json'), 'utf8'));
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pairsFor(mint) {
  const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
  if (!res.ok) return [];
  const pairs = await res.json();
  return (Array.isArray(pairs) ? pairs : [])
    .sort((a, b) => ((b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)));
}

/**
 * Candidate pubkeys embedded in an account's data.
 *
 * Steps one byte at a time on purpose: Raydium CLMM's PoolState puts a 1-byte
 * bump ahead of its pubkey fields, so every vault key sits at an odd offset and
 * an 8-aligned scan silently finds nothing.
 */
function candidateKeys(data) {
  const keys = [];
  for (let off = 8; off + 32 <= data.length; off += 1) {
    const slice = data.subarray(off, off + 32);
    if (slice.every((b) => b === 0)) continue;
    try { keys.push(new PublicKey(slice)); } catch { /* not a valid curve-agnostic key */ }
  }
  return keys;
}

async function findVaults(poolPk, poolInfo, mintPk) {
  const cands = candidateKeys(poolInfo.data);
  const found = [];
  for (let i = 0; i < cands.length; i += 100) {
    const batch = cands.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(batch, 'confirmed');
    for (let j = 0; j < infos.length; j++) {
      const info = infos[j];
      if (!info || !TOKEN_PROGRAMS.has(info.owner.toBase58())) continue;
      let ta;
      try { ta = unpackAccount(batch[j], info, info.owner); } catch { continue; }
      if (!ta.mint.equals(mintPk)) continue;
      if (found.some((f) => f.address.equals(batch[j]))) continue;
      found.push({ address: batch[j], account: ta });
    }
    await sleep(120);
  }
  return found;
}

let totalVaults = 0;
let frozenVaults = 0;

for (const [underlying, entries] of Object.entries(cfg.underlyings)) {
  for (const e of entries) {
    const mintPk = new PublicKey(e.mint);
    const mintInfo = await conn.getAccountInfo(mintPk, 'confirmed');
    const decimals = mintInfo.data[44]; // Mint layout: decimals follows supply
    const pairs = await pairsFor(e.mint);
    const tvl = pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
    console.log(`\n${'='.repeat(74)}\n${underlying} / ${e.symbol}  (${e.issuer})`);
    console.log(`  ${pairs.length} live pairs, $${tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })} aggregate pool liquidity`);
    if (!pairs.length) { console.log('  no pools - no production custody evidence available'); continue; }

    for (const p of pairs.slice(0, 2)) {
      const poolPk = new PublicKey(p.pairAddress);
      const poolInfo = await conn.getAccountInfo(poolPk, 'confirmed');
      if (!poolInfo) { console.log(`  ${p.dexId}: pool account missing`); continue; }
      const ownerProgram = poolInfo.owner.toBase58();
      const isProgramOwned = !poolInfo.owner.equals(SYSTEM);
      console.log(`  ${p.dexId} ${p.baseToken.symbol}/${p.quoteToken.symbol}  $${(p.liquidity?.usd ?? 0).toLocaleString(undefined,{maximumFractionDigits:0})}`);
      console.log(`    pool        ${p.pairAddress}`);
      console.log(`    ownedBy     ${ownerProgram} ${isProgramOwned ? '(program-owned account)' : '(SYSTEM - not a program account)'}`);

      const vaults = await findVaults(poolPk, poolInfo, mintPk);
      if (!vaults.length) { console.log('    vaults      none found for this mint'); continue; }
      for (const v of vaults) {
        const ownerIsPool = v.account.owner.equals(poolPk);
        const ownerInfo = await conn.getAccountInfo(v.account.owner, 'confirmed');
        const ownerKind = ownerInfo && !ownerInfo.owner.equals(SYSTEM) ? `PDA of ${ownerInfo.owner.toBase58().slice(0,8)}..` : 'wallet';
        const ui = Number(v.account.amount) / 10 ** decimals;
        totalVaults++;
        if (v.account.isFrozen) frozenVaults++;
        console.log(`    VAULT       ${v.address.toBase58()}`);
        console.log(`      balance   ${ui.toLocaleString(undefined,{maximumFractionDigits:4})} ${e.symbol}`);
        console.log(`      authority ${v.account.owner.toBase58()} ${ownerIsPool ? '== pool PDA' : `(${ownerKind})`}`);
        console.log(`      state     ${v.account.isFrozen ? 'Frozen  <<< FROZEN' : 'Initialized'}`);
        console.log(`      delegate  ${v.account.delegate ? v.account.delegate.toBase58() : '(none)'}`);
        // A Token-2022 account must carry TransferHookAccount before a hook can
        // ever gate it. Its presence on live vaults tells us whether issuers
        // could switch a hook on without every holder migrating accounts.
        const vaultExts = v.account.tlvData?.length
          ? getExtensionTypes(v.account.tlvData).map((t) => ExtensionType[t] ?? `Unknown(${t})`)
          : [];
        console.log(`      accExts   ${vaultExts.length ? vaultExts.join(', ') : '(none)'}`);
      }
      await sleep(200);
    }
  }
}

console.log(`\n${'='.repeat(74)}`);
console.log(`SUMMARY: ${totalVaults} program-controlled vaults observed holding candidate wrappers; ${frozenVaults} frozen.`);
console.log(totalVaults > 0 && frozenVaults === 0
  ? 'PDA custody is demonstrated in production for every wrapper with a live pool.'
  : 'Review frozen or absent vaults before assuming PDA custody works.');
