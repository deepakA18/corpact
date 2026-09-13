import fs from 'node:fs';
import { PublicKey } from '@solana/web3.js';
const RPC='https://api.mainnet-beta.solana.com', T22='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {assets}=JSON.parse(fs.readFileSync('out/xstocks-solana-history.json','utf8'));
const since=Date.parse('2025-09-13T00:00:00Z');
const out=[];
for(const sym of ['CMSx','CIx','PHx','GEVx','PMx']){
  const a=assets.find(x=>x.symbol===sym); const events=a.history.filter(h=>h.reason==='Dividend'&&Date.parse(h.activationDateTime)>=since);
  let res=null; for(let i=0;i<8&&!res;i++){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getProgramAccounts',params:[T22,{encoding:'base64',dataSlice:{offset:32,length:40},filters:[{memcmp:{offset:0,bytes:a.mint}}]}]})}).catch(()=>null); const j=r&&r.ok?await r.json():null; if(j?.result)res=j.result; else await sleep(4000*(i+1));}
  if(!res){out.push({sym,error:'still throttled'});continue;}
  const p=(await (await fetch(`https://api.xstocks.fi/api/v2/public/assets/${sym}/price-data`)).json()).quote;
  const dM=events.reduce((s,e)=>s+(e.multiplier-e.previousMultiplier),0);
  let holders=0,ge1=0,ge10=0,ge100=0,total=0;
  for(const x of res){if(x.account.space<165)continue;const b=Buffer.from(x.account.data[0],'base64');const amt=b.readBigUInt64LE(32);if(amt===0n||!PublicKey.isOnCurve(b.subarray(0,32)))continue;holders++;const y=Number(amt)/1e8*dM*p;total+=y;if(y>=1)ge1++;if(y>=10)ge10++;if(y>=100)ge100++;}
  out.push({sym,holders,events:events.length,price:p,walletsGe1:ge1,walletsGe10:ge10,walletsGe100:ge100,totalIncomeUsd:Math.round(total)});
  await sleep(1500);
}
console.log(JSON.stringify(out,null,1)); fs.writeFileSync('out/demand-retry.json',JSON.stringify(out,null,1));
