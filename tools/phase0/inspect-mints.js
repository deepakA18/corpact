/**
 * Phase 0 / §0.1 - Token-2022 extension inspector.
 *
 * Reads every candidate wrapper mint from mints.json and reports the full
 * extension list, hook program, delegate authorities and metadata. Output is
 * the raw material for docs/findings/token-extensions.md.
 *
 *   node inspect-mints.js [--rpc <url>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
  getExtensionTypes,
  getExtensionData,
  ExtensionType,
  getTransferHook,
  getPermanentDelegate,
  getDefaultAccountState,
  getTransferFeeConfig,
  getMintCloseAuthority,
  getMetadataPointerState,
  getTokenMetadata,
  AccountState,
} from '@solana/spl-token';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rpcUrl =
  (args.includes('--rpc') ? args[args.indexOf('--rpc') + 1] : null) ??
  process.env.SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com';
const asJson = args.includes('--json');

const NULL_KEY = PublicKey.default.toBase58();
const some = (k) => (k && k.toBase58 ? k.toBase58() : k) ?? null;

/** Extensions that can seize, freeze or block tokens held by a pool PDA. */
const CUSTODY_CRITICAL = new Set([
  'TransferHook',
  'TransferHookAccount',
  'PermanentDelegate',
  'DefaultAccountState',
  'TransferFeeConfig',
  'NonTransferable',
  'ConfidentialTransferMint',
  'MintCloseAuthority',
  'PausableConfig',
]);

async function inspect(conn, entry, underlying) {
  const mint = new PublicKey(entry.mint);
  const info = await conn.getAccountInfo(mint, 'confirmed');
  if (!info) return { ...entry, underlying, error: 'mint account not found' };

  const owner = info.owner.toBase58();
  const isT22 = owner === TOKEN_2022_PROGRAM_ID.toBase58();
  const isSpl = owner === TOKEN_PROGRAM_ID.toBase58();
  if (!isT22 && !isSpl) {
    return { ...entry, underlying, error: `unexpected mint owner ${owner}` };
  }

  const m = unpackMint(mint, info, info.owner);
  const out = {
    ...entry,
    underlying,
    tokenProgram: isT22 ? 'Token-2022' : 'SPL Token',
    tokenProgramId: owner,
    decimals: m.decimals,
    supply: m.supply.toString(),
    uiSupply: Number(m.supply) / 10 ** m.decimals,
    mintAuthority: some(m.mintAuthority),
    freezeAuthority: some(m.freezeAuthority),
    isInitialized: m.isInitialized,
    accountSize: info.data.length,
    extensions: [],
    custodyCritical: [],
    details: {},
  };

  if (!isT22) return out;

  out.extensions = getExtensionTypes(m.tlvData).map((t) => ExtensionType[t] ?? `Unknown(${t})`);
  out.custodyCritical = out.extensions.filter((e) => CUSTODY_CRITICAL.has(e));

  const hook = getTransferHook(m);
  if (hook) {
    out.details.transferHook = {
      programId: some(hook.programId),
      programIdIsNull: some(hook.programId) === NULL_KEY,
      authority: some(hook.authority),
      // A non-null authority can *add* a hook later even if none is set today.
      canBeSetLater: some(hook.authority) !== NULL_KEY,
    };
  }

  const pd = getPermanentDelegate(m);
  if (pd) out.details.permanentDelegate = { delegate: some(pd.delegate) };

  const das = getDefaultAccountState(m);
  if (das) {
    out.details.defaultAccountState = {
      state: AccountState[das.state] ?? das.state,
      // Frozen-by-default means a fresh pool PDA ATA cannot receive tokens
      // until the freeze authority thaws it.
      blocksFreshAtas: das.state === AccountState.Frozen,
    };
  }

  const fee = getTransferFeeConfig(m);
  if (fee) {
    out.details.transferFeeConfig = {
      withdrawWithheldAuthority: some(fee.withdrawWithheldAuthority),
      transferFeeConfigAuthority: some(fee.transferFeeConfigAuthority),
      olderBasisPoints: fee.olderTransferFee.transferFeeBasisPoints,
      newerBasisPoints: fee.newerTransferFee.transferFeeBasisPoints,
      newerMaximumFee: fee.newerTransferFee.maximumFee.toString(),
    };
  }

  const close = getMintCloseAuthority(m);
  if (close) out.details.mintCloseAuthority = { closeAuthority: some(close.closeAuthority) };

  const ptr = getMetadataPointerState(m);
  if (ptr) {
    out.details.metadataPointer = {
      authority: some(ptr.authority),
      metadataAddress: some(ptr.metadataAddress),
    };
  }

  try {
    const md = await getTokenMetadata(conn, mint, 'confirmed', info.owner);
    if (md) {
      out.details.metadata = {
        name: md.name,
        symbol: md.symbol,
        uri: md.uri,
        updateAuthority: some(md.updateAuthority),
        additional: Object.fromEntries(md.additionalMetadata ?? []),
      };
    }
  } catch (e) {
    out.details.metadata = { error: String(e.message ?? e) };
  }

  // Raw TLV for any extension the SDK has no typed getter for.
  for (const name of out.extensions) {
    const t = ExtensionType[name];
    if (t === undefined) continue;
    const data = getExtensionData(t, m.tlvData);
    if (data) out.details[`raw_${name}`] = data.toString('hex');
  }

  return out;
}

function render(rows) {
  const verdict = (r) => {
    if (r.error) return `ERROR: ${r.error}`;
    const blockers = [];
    if (r.details.transferHook && !r.details.transferHook.programIdIsNull) {
      blockers.push('transfer hook SET - PDA custody must be proven on fork');
    }
    if (r.details.permanentDelegate) blockers.push('PERMANENT DELEGATE - pool assets clawbackable');
    if (r.details.defaultAccountState?.blocksFreshAtas) blockers.push('default state FROZEN');
    if (r.details.transferFeeConfig?.newerBasisPoints) blockers.push('transfer fee > 0');
    if (r.freezeAuthority) blockers.push('freeze authority set (pool ATA freezable)');
    if (r.details.transferHook?.canBeSetLater && r.details.transferHook.programIdIsNull) {
      blockers.push('hook authority live - hook can be added post-listing');
    }
    return blockers.length ? blockers.join('; ') : 'no custody blockers detected';
  };

  for (const r of rows) {
    console.log('='.repeat(78));
    console.log(`${r.underlying}  ${r.symbol}  (${r.issuer})`);
    console.log(`  mint          ${r.mint}`);
    if (r.error) { console.log(`  ERROR         ${r.error}`); continue; }
    console.log(`  program       ${r.tokenProgram}  (${r.tokenProgramId})`);
    console.log(`  decimals      ${r.decimals}    supply ${r.uiSupply.toLocaleString()}`);
    console.log(`  mintAuth      ${r.mintAuthority ?? '(none)'}`);
    console.log(`  freezeAuth    ${r.freezeAuthority ?? '(none)'}`);
    console.log(`  extensions    ${r.extensions.length ? r.extensions.join(', ') : '(none)'}`);
    if (r.custodyCritical.length) console.log(`  !! critical   ${r.custodyCritical.join(', ')}`);
    for (const [k, v] of Object.entries(r.details)) {
      if (k.startsWith('raw_')) continue;
      console.log(`  ${k}:`);
      for (const [kk, vv] of Object.entries(v)) console.log(`      ${kk.padEnd(26)} ${JSON.stringify(vv)}`);
    }
    console.log(`  VERDICT       ${verdict(r)}`);
  }
  console.log('='.repeat(78));
}

const conn = new Connection(rpcUrl, 'confirmed');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mints.json'), 'utf8'));
const rows = [];
for (const [underlying, entries] of Object.entries(cfg.underlyings)) {
  for (const e of entries) rows.push(await inspect(conn, e, underlying));
}
if (asJson) console.log(JSON.stringify({ rpcUrl, inspectedAt: new Date().toISOString(), rows }, null, 2));
else render(rows);
