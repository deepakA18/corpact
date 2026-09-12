import { Connection, PublicKey } from '@solana/web3.js';
const conn = new Connection('https://api.mainnet-beta.solana.com','confirmed');
// Sponsored price-feed accounts are PDAs of the *push oracle* program, not the
// receiver program; the receiver only verifies Wormhole VAAs.
const PROGRAMS = {
  push_oracle: new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT'),
  receiver: new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ'),
};
const feeds = {
  'NVDA(US)':'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  'NVDA(24/7)':'a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852',
  'AAPL(US)':'49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
  'SPCX(US)':'8a593d6edde7a3095213c88116d8840d01e93c2ddeb800bc891772eb8b93bb94',
  'BTC(ctrl)':'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
};
for (const [name,hex] of Object.entries(feeds)) {
  const id = Buffer.from(hex,'hex');
  let hit=null;
  outer: for (const [pname,prog] of Object.entries(PROGRAMS)) {
    for (const shard of [0,1,2,3]) {
      const s=Buffer.alloc(2); s.writeUInt16LE(shard);
      const [pda]=PublicKey.findProgramAddressSync([s,id],prog);
      const info=await conn.getAccountInfo(pda,'confirmed');
      if(info){hit={shard,pda,info,pname};break outer;}
    }
  }
  if(!hit){console.log(`${name.padEnd(11)} no sponsored on-chain feed account (push_oracle/receiver, shards 0-3)`);continue;}
  const d=hit.info.data;
  // PriceUpdateV2: disc(8) write_authority(32) verification_level(1) then PriceFeedMessage:
  // feed_id(32) price(i64) conf(u64) expo(i32) publish_time(i64) prev_publish_time(i64) ema_price(i64) ema_conf(u64)
  let o=8+32+1+32;
  const price=d.readBigInt64LE(o); o+=8;
  const conf=d.readBigUInt64LE(o); o+=8;
  const expo=d.readInt32LE(o); o+=4;
  const pt=d.readBigInt64LE(o);
  const px=Number(price)*10**expo, cf=Number(conf)*10**expo;
  const age=(Date.now()/1000)-Number(pt);
  console.log(`${name.padEnd(11)} ${hit.pname} shard${hit.shard} ${hit.pda.toBase58()} (${hit.info.data.length}B)`);
  console.log(`${''.padEnd(11)} price=${px.toFixed(4)} conf=±${cf.toFixed(4)} (${(cf/px*10000).toFixed(1)}bps) publish=${new Date(Number(pt)*1000).toISOString()} age=${(age/3600).toFixed(2)}h`);
}
