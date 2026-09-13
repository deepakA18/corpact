const RPC='https://api.mainnet-beta.solana.com';
const {assets}=JSON.parse((await import('node:fs')).readFileSync('out/xstocks-solana-history.json','utf8'));
for (const sym of ['SPYx','KOx','NVDAx']) {
  const a=assets.find(x=>x.symbol===sym);
  const r=await (await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getAccountInfo',params:[a.mint,{encoding:'base64'}]})})).json();
  const v=r.result.value; const b=Buffer.from(v.data[0],'base64');
  const exts=[]; let scaled=null;
  for(let o=166;o+4<=b.length;){const t=b.readUInt16LE(o),l=b.readUInt16LE(o+2); if(t===0&&l===0)break; const p=b.subarray(o+4,o+4+l); exts.push(`${t}:${l}`);
    if(l===56&&!scaled){scaled={type:t,multiplier:p.readDoubleLE(32),multiplierHex:p.subarray(32,40).toString('hex'),newMultiplierEffectiveTimestamp:p.readBigInt64LE(40).toString(),newMultiplier:p.readDoubleLE(48)};} o+=4+l;}
  const api=await (await fetch(`https://api.xstocks.fi/api/v2/public/assets/${sym}/multiplier?network=Solana`)).json();
  const last=a.history[0];
  console.log(sym,a.mint,'owner',v.owner,'decimals',b[44],'accountType',b[165],'exts',exts.join(' '));
  console.log('  chain',JSON.stringify(scaled));
  console.log('  api  ',JSON.stringify(api),'| history head',last?.multiplier,last?.activationDateTime);
  console.log('  chain==api current?',scaled?.multiplier===api.currentMultiplier || scaled?.newMultiplier===api.currentMultiplier);
}
