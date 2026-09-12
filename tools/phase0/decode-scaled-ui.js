/**
 * Phase 0 / §0.2 - ScaledUiAmountConfig + PausableConfig decoder.
 *
 * Every candidate wrapper carries ScaledUiAmountConfig. That extension *is* the
 * shares-per-token scalar the spec assumed we would have to source off-chain,
 * and it carries a scheduled effective timestamp for the next value. This tool
 * decodes it so docs/findings/normalization-sources.md can be written against
 * observed bytes rather than issuer marketing pages.
 *
 * ScaledUiAmountConfig TLV payload (56 bytes):
 *   authority                        Pubkey   32
 *   multiplier                       f64 LE    8
 *   newMultiplierEffectiveTimestamp  i64 LE    8
 *   newMultiplier                    f64 LE    8
 *
 * PausableConfig TLV payload (33 bytes):
 *   authority  Pubkey  32
 *   paused     bool     1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { unpackMint, getExtensionData, ExtensionType } from '@solana/spl-token';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

function decodeScaledUiAmount(buf) {
  if (!buf || buf.length < 56) return null;
  return {
    authority: new PublicKey(buf.subarray(0, 32)).toBase58(),
    multiplier: buf.readDoubleLE(32),
    newMultiplierEffectiveTimestamp: buf.readBigInt64LE(40),
    newMultiplier: buf.readDoubleLE(48),
  };
}

function decodePausable(buf) {
  if (!buf || buf.length < 33) return null;
  return {
    authority: new PublicKey(buf.subarray(0, 32)).toBase58(),
    paused: buf[32] === 1,
  };
}

const iso = (t) => (t === 0n ? '(unset)' : new Date(Number(t) * 1000).toISOString());

const conn = new Connection(rpcUrl, 'confirmed');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mints.json'), 'utf8'));
const nowSec = BigInt(Math.floor(Date.now() / 1000));

console.log('mint multipliers as of', new Date().toISOString(), '\n');
for (const [underlying, entries] of Object.entries(cfg.underlyings)) {
  for (const e of entries) {
    const pk = new PublicKey(e.mint);
    const info = await conn.getAccountInfo(pk, 'confirmed');
    if (!info) { console.log(`${e.symbol}: mint not found`); continue; }
    const m = unpackMint(pk, info, info.owner);
    const scaled = decodeScaledUiAmount(getExtensionData(ExtensionType.ScaledUiAmountConfig, m.tlvData));
    const pause = decodePausable(getExtensionData(ExtensionType.PausableConfig, m.tlvData));

    console.log(`${underlying.padEnd(5)} ${e.symbol.padEnd(8)} ${e.mint}`);
    if (!scaled) { console.log('    ScaledUiAmountConfig: ABSENT'); }
    else {
      const ts = scaled.newMultiplierEffectiveTimestamp;
      const pending = ts > nowSec;
      // The active scalar is `newMultiplier` once its effective timestamp passes.
      const active = pending ? scaled.multiplier : scaled.newMultiplier;
      console.log(`    multiplier(current)   ${scaled.multiplier}`);
      console.log(`    multiplier(new)       ${scaled.newMultiplier}`);
      console.log(`    effectiveAt           ${ts}  ${iso(ts)}  ${pending ? '<< PENDING' : '(elapsed)'}`);
      console.log(`    => active scalar      ${active}`);
      console.log(`    authority             ${scaled.authority}`);
      // f64 exactness matters: the spec bans floating point in program code.
      console.log(`    f64 bits              0x${Buffer.from(new Float64Array([active]).buffer).reverse().toString('hex')}`);
      console.log(`    exactly representable in Q64.64? ${Number.isFinite(active) ? 'yes (dyadic f64 -> exact Q64.64 lift)' : 'NO'}`);
    }
    if (pause) console.log(`    Pausable              paused=${pause.paused} authority=${pause.authority}`);
    console.log();
  }
}
