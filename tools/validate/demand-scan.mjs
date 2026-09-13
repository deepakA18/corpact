// Phase 0.1 demand estimate. Current holders as proxy for event-time holders (caveat: no archival history).
import fs from 'node:fs';
import { PublicKey } from '@solana/web3.js';
const RPC=process.env.SOLANA_RPC_URL??'https://api.mainnet-beta.solana.com';
const T22='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=async(method,params)=>{for(let i=0;i<6;i++){try{const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(r.status===429){await sleep(2000*(i+1));continue;}const j=await r.json();if(j.error){if(i<5){await sleep(1500*(i+1));continue;}throw new Error(JSON.stringify(j.error));}return j.result;}catch(e){if(i===5)throw e;await sleep(1500*(i+1));}}throw new Error('rpc exhausted '+method)};
const {assets}=JSON.parse(fs.readFileSync('out/xstocks-solana-history.json','utf8'));
const since=Date.parse('2025-09-13T00:00:00Z');
const div=assets.map(a=>({...a,events:a.history.filter(h=>h.reason==='Dividend'&&Date.parse(h.activationDateTime)>=since)})).filter(a=>a.events.length);
// decimals
const dec={};
for(let i=0;i<div.length;i+=100){const res=await rpc('getMultipleAccounts',[div.slice(i,i+100).map(a=>a.mint),{encoding:'base64',dataSlice:{offset:44,length:1}}]);res.value.forEach((v,k)=>dec[div[i+k].mint]=v?Buffer.from(v.data[0],'base64')[0]:null);}
const onCurveCache=new Map(); const onCurve=h=>{if(!onCurveCache.has(h))onCurveCache.set(h,PublicKey.isOnCurve(Buffer.from(h,'hex')));return onCurveCache.get(h)};
const union=new Map(); // ownerHex -> {assets, usd}
const rows=[]; const q=(arr,p)=>arr.length?arr[Math.min(arr.length-1,Math.floor(p*arr.length))]:null;
let done=0;
async function one(a){
  const price=await fetch(`https://api.xstocks.fi/api/v2/public/assets/${a.symbol}/price-data`).then(r=>r.ok?r.json():null).catch(()=>null);
  const res=await rpc('getProgramAccounts',[T22,{encoding:'base64',dataSlice:{offset:32,length:40},filters:[{memcmp:{offset:0,bytes:a.mint}}]}]);
  const owners=new Map();
  for(const x of res){if(x.account.space<165)continue;const b=Buffer.from(x.account.data[0],'base64');const amt=b.readBigUInt64LE(32);if(amt>0n){const o=b.subarray(0,32).toString('hex');owners.set(o,(owners.get(o)??0n)+amt);}}
  const d=dec[a.mint]; const p=price?.quote??null;
  const dMsum=a.events.reduce((s,e)=>s+(e.multiplier-e.previousMultiplier),0);
  const perEvent=[]; let offCurve=0, offCurveBal=0, totalBal=0; const holderYearUsd=[];
  for(const [o,raw] of owners){const B=Number(raw)/10**d; totalBal+=B; const pda=!onCurve(o); if(pda){offCurve++;offCurveBal+=B;continue;}
    if(p!=null){for(const e of a.events)perEvent.push(B*(e.multiplier-e.previousMultiplier)*p); const y=B*dMsum*p; holderYearUsd.push(y); const u=union.get(o)??{assets:0,usd:0}; u.assets++; u.usd+=y; union.set(o,u);} else {const u=union.get(o)??{assets:0,usd:0};u.assets++;union.set(o,u);} }
  perEvent.sort((x,y)=>x-y); holderYearUsd.sort((x,y)=>x-y);
  rows.push({symbol:a.symbol,mint:a.mint,decimals:d,price:p,events:a.events.length,dMsum,holdersNonzero:owners.size,offCurveOwners:offCurve,offCurveShareOfBalance:totalBal?offCurveBal/totalBal:null,
    walletEvents:perEvent.length,eventUsdP50:q(perEvent,.5),eventUsdP90:q(perEvent,.9),eventsGe1:perEvent.filter(v=>v>=1).length,eventsGe10:perEvent.filter(v=>v>=10).length,
    totalHolderIncomeUsd:holderYearUsd.reduce((s,v)=>s+v,0)});
  done++; if(done%20===0)console.error(`${done}/${div.length}`);
}
const queue=[...div]; await Promise.all(Array.from({length:3},async()=>{while(queue.length){const a=queue.shift();try{await one(a)}catch(e){rows.push({symbol:a.symbol,mint:a.mint,error:e.message});console.error('FAIL',a.symbol,e.message)}await sleep(300)}}));
const allEv=[]; // recompute distribution of per-wallet-event usd across all assets is too big to keep; use per-asset medians + union stats
const uv=[...union.values()]; const uUsd=uv.map(v=>v.usd).sort((x,y)=>x-y);
const summary={computedAt:new Date().toISOString(),rpc:RPC.includes('mainnet-beta')?'public':'custom',dividendAssets:div.length,failed:rows.filter(r=>r.error).length,
  uniqueOnCurveWallets:union.size,walletsYearIncomeGe1:uUsd.filter(v=>v>=1).length,walletsYearIncomeGe10:uUsd.filter(v=>v>=10).length,walletsYearIncomeGe100:uUsd.filter(v=>v>=100).length,
  walletYearIncomeP50:q(uUsd,.5),walletYearIncomeP90:q(uUsd,.9),walletYearIncomeP99:q(uUsd,.99),
  totalWalletEvents:rows.reduce((s,r)=>s+(r.walletEvents||0),0),totalEventsGe1:rows.reduce((s,r)=>s+(r.eventsGe1||0),0),totalEventsGe10:rows.reduce((s,r)=>s+(r.eventsGe10||0),0),
  totalHolderIncomeUsd:rows.reduce((s,r)=>s+(r.totalHolderIncomeUsd||0),0)};
fs.writeFileSync('out/demand-result.json',JSON.stringify({summary,rows:rows.sort((a,b)=>(b.holdersNonzero||0)-(a.holdersNonzero||0))},null,1));
console.log(JSON.stringify(summary,null,1));
