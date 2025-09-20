#!/usr/bin/env node
// compare-config.cjs: fetch /api/config and compare with config-best.json for key fields
const fs = require('fs');
const http = require('http');

function get(url){
  return new Promise((resolve, reject)=>{
    const req = http.get(url, res=>{
      let data = '';
      res.on('data', c=> data += c);
      res.on('end', ()=>{
        if(res.statusCode !== 200) return reject(new Error('HTTP '+res.statusCode));
        try{
          resolve(JSON.parse(data));
        }catch(e){
          reject(new Error('JSON parse failed: '+e.message+'; body prefix: '+data.slice(0,120)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, ()=>{ req.destroy(new Error('timeout')); });
  });
}

(async()=>{
  try{
    const cur = await get('http://localhost:3031/api/config');
    // dump current config for inspection
    try { fs.writeFileSync('./config.current.json', JSON.stringify(cur, null, 2)); } catch {}
    const best = JSON.parse(fs.readFileSync('./config-best.json','utf8'));
    const directPick=(o,p)=> p.split('.').reduce((a,k)=> (a&&a[k]!==undefined)?a[k]:undefined, o);
    const pick=(o,p)=>{
      // try root
      let v = directPick(o,p);
      if(v !== undefined) return v;
      // try common wrappers
      for(const w of ['config','data','payload']){
        v = directPick(o, w + '.' + p);
        if(v !== undefined) return v;
      }
      return undefined;
    };
    const keys=[
      'strategy.signalThreshold',
      'strategy.allowOppositeWhileOpen',
      'strategy.oppositeMinConfidence',
      'risk.hourlyOrderCaps.total',
      'risk.hourlyOrderCaps.perDirection.LONG',
      'risk.hourlyOrderCaps.perDirection.SHORT',
      'commission',
      'slippage',
      'recommendation.maxHoldingHours',
      'recommendation.concurrencyCountAgeHours'
    ];
    const diff=[];
    for(const k of keys){
      const a=pick(cur,k), b=directPick(best,k);
      if(JSON.stringify(a)!==JSON.stringify(b)) diff.push({key:k,current:a,best:b});
    }
    if(diff.length===0){
      console.log('MATCH');
      process.exit(0);
    } else {
      console.log('DIFF');
      console.log('TOP_LEVEL_KEYS:', Object.keys(cur));
      console.log(JSON.stringify(diff,null,2));
      process.exit(2);
    }
  }catch(e){
    console.error('ERR', e.message);
    process.exit(1);
  }
})();