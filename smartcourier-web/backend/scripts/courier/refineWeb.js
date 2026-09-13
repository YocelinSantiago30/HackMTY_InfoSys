// Ajusta solo en 1–54. Congela el modelo antes de abrir el holdout 130001–130108.
// node scripts/courier/refineWeb.js train | holdout
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { TUNING_CONFIGS, TUNING_SEEDS, REPORTING_SEEDS, configsFor } = require('../../src/courier/seedSets');
const { runShift, ourAgent } = require('../../src/courier/simulator');
const { loadDemandModel } = require('../../src/courier/demandModel');
const { acceptAll, greedyRate, withSafety } = require('../../src/courier/baselines');
const { replayEvents } = require('../../src/courier/replay');
const StrategyClient = require('../../src/courier/strategyClient');
const { startModelService } = require('./modelService');
const root = path.resolve(__dirname, '../../..');
const out = path.join(root, 'output/validation');
const models = path.join(root, 'models/courier');
const freshSeeds = Array.from({length:108}, (_,i)=>130001+i);
assert.equal(freshSeeds.some(s=>TUNING_SEEDS.includes(s)||REPORTING_SEEDS.includes(s)), false);
const demandModel=loadDemandModel();
const read=name=>JSON.parse(fs.readFileSync(path.join(models,name),'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const round=n=>Math.round(n*100)/100;
function summarize(runs){
 const earnings=runs.map(r=>r.metrics.earnings_mxn);
 const decisions=runs.flatMap(r=>r.events.filter(e=>e.event==='decision'));
 const accepts=decisions.filter(e=>e.decision==='ACCEPT');
 const noTip=runs.map(r=>r.events.filter(e=>e.event==='decision'&&e.decision==='ACCEPT').reduce((n,e)=>n+(e.economics?.net_before_tip_mxn??0),0));
 return {shifts:runs.length,mean_net_mxn:round(avg(earnings)),min_net_mxn:Math.min(...earnings),positive_shifts:earnings.filter(n=>n>0).length,zero_shifts:earnings.filter(n=>n===0).length,negative_shifts:earnings.filter(n=>n<0).length,accepted:accepts.length,skipped:decisions.length-accepts.length,safety_violations:runs.reduce((n,r)=>n+r.metrics.safety_violations,0),deadline_misses:runs.reduce((n,r)=>n+r.metrics.deadline_misses,0),degraded_decisions:runs.reduce((n,r)=>n+r.metrics.degraded_decisions,0),max_p99_ms:Math.max(...runs.map(r=>r.metrics.p99_latency_ms)),accepted_nonpositive_before_tip:accepts.filter(e=>e.economics&&e.economics.net_before_tip_mxn<=0).length,...(accepts.every(e=>e.economics)?{mean_net_without_tips_mxn:round(avg(noTip)),min_net_without_tips_mxn:round(Math.min(...noTip))}:{})};
}
async function runsFor(configs,make){
 const runs=[];
 for(let i=0;i<configs.length;i+=9)runs.push(...await Promise.all(configs.slice(i,i+9).map(c=>runShift(c,make()))));
 return runs;
}
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const service=await startModelService({port:8014});
 const agent=params=>()=>ourAgent({demandModel,strategyClient:new StrategyClient({baseUrl:service.url,getApiKey:()=>service.apiKey,paramsOverride:params,timeoutMs:10000})});
 const measure=async(params,configs=TUNING_CONFIGS)=>{
   const runs=await runsFor(configs,agent(params));
   const summary=summarize(runs);
   assert.equal(summary.degraded_decisions,0,'No se permite entrenar/evaluar con estrategia de fallback');
   return {runs,summary};
 };
 try{
 if(process.argv[2]==='train'){
   const model=read('strategy_model.json');
   const backup=path.join(out,'before-refinement');
   fs.mkdirSync(backup,{recursive:true});
   for(const file of ['strategy_model.json','training_report.json','demand_model.json']){
     const destination=path.join(backup,file);
     if(!fs.existsSync(destination))fs.copyFileSync(path.join(models,file),destination);
   }
   // La selección siempre parte del modelo respaldado, no de un holdout visto.
   const before=JSON.parse(fs.readFileSync(path.join(backup,'strategy_model.json')));
   const history=[];
   const selected=structuredClone(before.params);
   for(const vehicle of ['moto','car','bike']){
     const configs=TUNING_CONFIGS.filter(c=>c.vehicle===vehicle);
     let best=null;
     for(const scale of [1,0.75,0.5,0,1.25]){
       const params=structuredClone(before.params);
       for(const band of Object.keys(params.vehicles[vehicle]))params.vehicles[vehicle][band]=round(params.vehicles[vehicle][band]*scale);
       const {summary}=await measure(params,configs);
       history.push({vehicle,scale,...summary});
       console.log(`${vehicle} reserva ×${scale}: neto medio $${summary.mean_net_mxn}, violaciones ${summary.safety_violations}`);
       if(summary.safety_violations===0 && (!best||summary.mean_net_mxn>best.summary.mean_net_mxn))best={params,summary};
     }
     assert.ok(best,`Ningún candidato seguro en ${vehicle}`);
     selected.vehicles[vehicle]=best.params.vehicles[vehicle];
   }
   let best=null;
   for(const taper of [before.params.end_taper_factor,0.25,0]){
     const params={...selected,end_taper_factor:taper};
     const {summary}=await measure(params);
     history.push({taper,...summary});
     console.log(`Reserva al final ×${taper}: neto medio $${summary.mean_net_mxn}`);
     if(summary.safety_violations===0&&(!best||summary.mean_net_mxn>best.summary.mean_net_mxn))best={params,summary};
   }
   assert.ok(best);
   const hash=crypto.createHash('sha256').update(JSON.stringify(best.params)).digest('hex');
   const version=`courier-web-${hash.slice(0,12)}`;
   write(path.join(models,'strategy_model.json'),{...model,version,params:best.params,trained_on_seeds:TUNING_SEEDS,objective:'Ganancia neta media; restricciones intactas y pago base mayor al costo del viaje'});
   const training=read('training_report.json');
   write(path.join(models,'training_report.json'),{...training,strategy_model_version:version,web_refinement:{frozen_at:new Date().toISOString(),tuning_seeds:TUNING_SEEDS,excluded:[...REPORTING_SEEDS,...freshSeeds],history,selected_summary:best.summary,params_sha256:hash}});
   write(path.join(out,'training-refinement.json'),{version,tuning_seeds:TUNING_SEEDS,history,selected:best,holdout_seeds_excluded:freshSeeds});
   console.log(`CONGELADO ${version}. Holdout aún sin abrir.`);
 }else if(process.argv[2]==='holdout'){
   const model=read('strategy_model.json');
   const original=JSON.parse(fs.readFileSync(path.join(out,'before-refinement/strategy_model.json')));
   const configs=configsFor(freshSeeds);
   const ours=await measure(null,configs); // Carga el artefacto congelado mediante Python real.
   const old=await measure(original.params,configs);
   const threshold=read('training_report.json').greedy_rate_threshold_mxn_hr;
   const safeAll=await runsFor(configs,()=>withSafety(acceptAll(),{demandModel}));
   const safeGreedy=await runsFor(configs,()=>withSafety(greedyRate({thresholdMxnHr:threshold}),{demandModel}));
   const sets={SmartCourier:ours.runs,PreviousStrategy:old.runs,AcceptAllSafety:safeAll,GreedyRateSafety:safeGreedy};
   const summaries=Object.fromEntries(Object.entries(sets).map(([name,runs])=>[name,summarize(runs)]));
   const byVehicle=Object.fromEntries(['moto','car','bike'].map(v=>[v,Object.fromEntries(Object.entries(sets).map(([name,runs])=>[name,summarize(runs.filter(r=>r.config.vehicle===v))]))]));
   const paired=Object.fromEntries(Object.entries(sets).filter(([name])=>name!=='SmartCourier').map(([name,runs])=>[name,{wins:ours.runs.filter((r,i)=>r.metrics.earnings_mxn>runs[i].metrics.earnings_mxn).length,ties:ours.runs.filter((r,i)=>r.metrics.earnings_mxn===runs[i].metrics.earnings_mxn).length,losses:ours.runs.filter((r,i)=>r.metrics.earnings_mxn<runs[i].metrics.earnings_mxn).length}]));
   const replayMismatches=ours.runs.reduce((n,r)=>n+replayEvents(r.events,{demandModel}).mismatches.length,0);
   const report={model_version:model.version,seed_range:[freshSeeds[0],freshSeeds.at(-1)],seeds:freshSeeds,created_at:new Date().toISOString(),summaries,by_vehicle:byVehicle,paired,replay_mismatches:replayMismatches,per_shift:Object.fromEntries(Object.entries(sets).map(([name,runs])=>[name,runs.map(r=>({seed:r.config.seed,vehicle:r.config.vehicle,...r.metrics}))])),limits:'Simulación sintética Courier: neto de combustible. No incluye desgaste, impuestos ni cambios reales en pago. Propinas simuladas; escenario sin propinas calculado por separado. Resultados de prueba, no garantía.'};
   write(path.join(out,'holdout-108.json'),report);
   fs.writeFileSync(path.join(out,'holdout-decisions.jsonl'),ours.runs.flatMap(r=>r.events.filter(e=>e.event==='decision').map(e=>JSON.stringify({seed:r.config.seed,...e}))).join('\n')+'\n');
   console.log(JSON.stringify({summaries,by_vehicle:byVehicle,paired,replay_mismatches:replayMismatches},null,2));
   assert.equal(ours.summary.safety_violations,0);
   assert.equal(ours.summary.accepted_nonpositive_before_tip,0);
   assert.equal(ours.summary.negative_shifts,0);
   assert.equal(replayMismatches,0);
   assert.ok(ours.summary.max_p99_ms<50);
 }else throw new Error('Usa train o holdout');
 }finally{await service.stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
