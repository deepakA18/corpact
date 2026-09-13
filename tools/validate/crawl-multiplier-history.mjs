import fs from 'node:fs';
const B='https://api.xstocks.fi/api/v2/public';
const get=async u=>{for(let i=0;i<4;i++){const r=await fetch(u);if(r.ok)return r.json();if(r.status===404)return {__status:404};await new Promise(s=>setTimeout(s,800*(i+1)));}throw new Error('fetch failed '+u)};
const first=await get(`${B}/assets`); console.error('page field',JSON.stringify(first.page));
let assets=[...first.nodes], page=first.page;
for(let p=1; page?.hasNextPage && p<50; p++){ const j=await get(`${B}/assets?page=${p}`); if(!j.nodes?.length)break; assets.push(...j.nodes); page=j.page; }
const ids=new Set(); assets=assets.filter(a=>!ids.has(a.id)&&ids.add(a.id));
const sol=assets.filter(a=>a.deployments.some(d=>d.network==='Solana'));
console.error('assets',assets.length,'solana',sol.length);
const out=[]; const reasons={};
for(let i=0;i<sol.length;i+=6){
  await Promise.all(sol.slice(i,i+6).map(async a=>{
    let nodes=[],pg=0,status='ok';
    while(true){const j=await get(`${B}/assets/${a.symbol}/multiplier/history?network=Solana&page=${pg}`).catch(e=>({__err:e.message}));
      if(j.__err||j.__status){status=j.__err||('HTTP '+j.__status);break;}
      nodes.push(...j.nodes); if(!j.page?.hasNextPage||pg>20)break; pg++;}
    for(const n of nodes)reasons[n.reason]=(reasons[n.reason]||0)+1;
    out.push({symbol:a.symbol,underlying:a.underlyingSymbol,mint:a.deployments.find(d=>d.network==='Solana').address,halted:a.isTradingHalted,status,history:nodes});
  }));
}
fs.writeFileSync('out/xstocks-solana-history.json',JSON.stringify({fetchedAt:new Date().toISOString(),assets:out},null,1));
const since=Date.parse('2025-09-13T00:00:00Z');
const withDiv=out.filter(a=>a.history.some(h=>h.reason==='Dividend'&&Date.parse(h.activationDateTime)>=since));
console.log('solana assets',out.length,'fetch failures',out.filter(a=>a.status!=='ok').length);
console.log('reasons',reasons);
console.log('assets with >=1 dividend activation in last 12m',withDiv.length);
console.log(withDiv.map(a=>`${a.symbol}:${a.history.filter(h=>h.reason==='Dividend'&&Date.parse(h.activationDateTime)>=since).length}`).join(' '));
