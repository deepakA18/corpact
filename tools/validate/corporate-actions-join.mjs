import fs from 'node:fs';
const B='https://api.xstocks.fi/api/v2/public/corporate-actions';
const get=async u=>{for(let i=0;i<4;i++){const r=await fetch(u);if(r.ok)return r.json();await new Promise(s=>setTimeout(s,1000*(i+1)));}throw new Error(u)};
async function all(kind){let out=[],p=1,ps=100,meta;for(;;){const j=await get(`${B}/${kind}?page=${p}&pageSize=${ps}`);meta=j.page;out.push(...j.nodes);if(!j.page.hasNextPage||p>100)break;p++;}return {out,meta};}
const hist=await all('history'), up=await all('upcoming');
console.log('history nodes',hist.out.length,'reported',hist.meta.totalNodes,'pageSize honoured',hist.meta.pageSize,'| upcoming',up.out.length,'reported',up.meta.totalNodes);
fs.writeFileSync('out/ca-history.json',JSON.stringify(hist.out,null,1)); fs.writeFileSync('out/ca-upcoming.json',JSON.stringify(up.out,null,1));
const tally=(arr,f)=>arr.reduce((m,x)=>(m[f(x)]=(m[f(x)]||0)+1,m),{});
console.log('history caType',tally(hist.out,x=>x.caType)); console.log('history status',tally(hist.out,x=>x.status)); console.log('upcoming status',tally(up.out,x=>x.status),'upcoming caType',tally(up.out,x=>x.caType));
const ids=tally(hist.out,x=>x.eventId); const multi=Object.entries(ids).filter(([,c])=>c>1); console.log('eventIds appearing >1 in history',multi.length, 'versions',tally(hist.out,x=>x.version));
const {assets}=JSON.parse(fs.readFileSync('out/xstocks-solana-history.json','utf8'));
const mh=assets.flatMap(a=>a.history.map(h=>({sym:a.symbol,...h})));
const f64eq=(s,n)=>s!=null&&Number(s)===n;
let matched=0,unmatchedMH=[],reasonVsType={};
const caBySym=new Map(); for(const c of hist.out){if(!caBySym.has(c.xstockSymbol))caBySym.set(c.xstockSymbol,[]);caBySym.get(c.xstockSymbol).push(c);}
for(const h of mh){const cands=(caBySym.get(h.sym)||[]).filter(c=>c.status!=='Cancelled'&&f64eq(c.multiplierNew,h.multiplier)&&f64eq(c.multiplierOld,h.previousMultiplier));
  if(cands.length){matched++;const c=cands[0];const k=`${h.reason}->${c.caType}`;reasonVsType[k]=(reasonVsType[k]||0)+1;
    const tDiff=(Date.parse(c.effectiveTimeUtc)-Date.parse(h.activationDateTime))/1000; if(tDiff!==0)unmatchedMH.push(`TIME ${h.sym} ${h.activationDateTime} vs ${c.effectiveTimeUtc}`);}
  else unmatchedMH.push(`NOCA ${h.sym} ${h.reason} ${h.activationDateTime} ${h.previousMultiplier}->${h.multiplier}`);}
console.log('multiplier-history rows',mh.length,'matched to CA by exact f64 old/new',matched); console.log('reason->caType',reasonVsType);
console.log('unmatched/time-mismatch sample',unmatchedMH.length, unmatchedMH.slice(0,15));
const divs=hist.out.filter(c=>/Dividend/.test(c.caType)&&c.status!=='Cancelled');
console.log('dividend CAs',divs.length,'net null',divs.filter(c=>c.netCashflowUsd==null).length,'gross null',divs.filter(c=>c.grossCashflowUsd==null).length,'multipliers null',divs.filter(c=>c.multiplierNew==null).length,'notes present',divs.filter(c=>c.notes).length);
const strPrecision=hist.out.filter(c=>c.multiplierNew&&String(Number(c.multiplierNew))!==c.multiplierNew).length; console.log('CA multiplier strings not round-tripping through f64',strPrecision);
// implied reinvestment price = M_old * net / (M_new - M_old)
const implied=divs.filter(c=>c.netCashflowUsd&&c.multiplierOld&&c.multiplierNew).map(c=>{const mo=Number(c.multiplierOld),mn=Number(c.multiplierNew);return {sym:c.xstockSymbol,eff:c.effectiveTimeUtc,px:mo*Number(c.netCashflowUsd)/(mn-mo),net:Number(c.netCashflowUsd),gross:Number(c.grossCashflowUsd),wht:c.withholdingTaxRate}});
const bad=implied.filter(x=>!(x.px>0.01&&x.px<1e5)); console.log('implied reinvest prices computed',implied.length,'non-sane',bad.length,bad.slice(0,5));
const whtMismatch=divs.filter(c=>c.netCashflowUsd&&c.grossCashflowUsd&&c.withholdingTaxRate!=null&&Math.abs(Number(c.grossCashflowUsd)*(1-Number(c.withholdingTaxRate))-Number(c.netCashflowUsd))>1e-6);
console.log('net != gross*(1-wht)',whtMismatch.length,whtMismatch.slice(0,3).map(c=>`${c.xstockSymbol} g${c.grossCashflowUsd} n${c.netCashflowUsd} w${c.withholdingTaxRate}`));
console.log('non-Initial samples',JSON.stringify(hist.out.filter(c=>c.status!=='Initial').slice(0,4),null,0));
console.log('createdAfter semantics sample earliest/latest effective',hist.out.map(c=>c.effectiveTimeUtc).sort()[0],hist.out.map(c=>c.effectiveTimeUtc).sort().at(-1));
