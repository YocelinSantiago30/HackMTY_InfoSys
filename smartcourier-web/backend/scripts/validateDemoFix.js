// Comparación emparejada contra el motor anterior, sin alterar las seeds.
require('dotenv').config({path:require('path').resolve(__dirname,'../.env'),quiet:true});
const fs=require('fs'),path=require('path');
const NewCore=require('../src/simulation/SimulationCore');
const OldCore=require('../../../backend/src/simulation/SimulationCore');
const {estimateRoute}=require('../src/services/routing.service');
const {routed}=require('./auditDemo');
const {generateSimulationOrders}=require('../src/simulation/OrderGenerator');
const Random=require('../src/simulation/SimulationRandomService');
const {SCENARIOS}=require('./compareStrategies');
const out=path.resolve(__dirname,'../../output/validation/demo-review');
async function run(Core,seed,vehicle,orders,getRoute,events){
 const core=new Core({simulationId:'fix-validation',seed,durationSeconds:10800,preferences:{vehicle_type:vehicle},getRoute});
 core.setSimulationOrders(orders);core.nextOrderNumber=orders.at(-1).spec.orderNumber+1;
 for(const event of events){await core.advanceTo(event.at);await core.applyEvent(event.type,event.payload);}
 await core.advanceTo(10800);await core.finishShift();
 return Object.fromEntries(Object.entries(core.agents).map(([code,a])=>[code,{net:Number((a.counters.grossEarnings-a.counters.operatingCost).toFixed(2)),completed:a.counters.completedOrders,late:a.counters.lateDeliveries,idleMinutes:Number((180+ a.counters.overtimeMinutes-a.counters.activeMinutes).toFixed(2))}]));
}
async function main(){
 const real=process.argv.includes('--routed');
 const holdout=process.argv.includes('--holdout');
 const getRoute=real?routed:async p=>estimateRoute(p);
 const rows=[];
 for(let i=0;i<(real?6:27);i++){
  const seed=(holdout?(real?170001:171001):(real?161001:162001))+i,vehicle=['motorcycle','bike','car'][i%3];
  const orders=await generateSimulationOrders({random:new Random(seed),durationSeconds:10800,getRoute});
  for(const [scenario,events] of Object.entries(real?{normal:[]}:SCENARIOS)){
   const before=await run(OldCore,seed,vehicle,orders,getRoute,events);
   const after=await run(NewCore,seed,vehicle,orders,getRoute,events);
   if(JSON.stringify(before.BASELINE)!==JSON.stringify(after.BASELINE))throw Error(`Baseline cambió en ${seed}`);
   rows.push({seed,vehicle,scenario,routeSources:[...new Set(orders.map(e=>e.route.source))],before,after});
   console.log(`${seed} ${vehicle} ${scenario}: antes ${before.SMARTCOURIER.net}, ahora ${after.SMARTCOURIER.net}, baseline ${after.BASELINE.net}`);
  }
 }
 const mean=(f)=>Math.round(rows.reduce((sum,r)=>sum+f(r),0)/rows.length*100)/100;
 const summary={runs:rows.length,beforeMean:mean(r=>r.before.SMARTCOURIER.net),afterMean:mean(r=>r.after.SMARTCOURIER.net),baselineMean:mean(r=>r.after.BASELINE.net),positive:rows.filter(r=>r.after.SMARTCOURIER.net>0).length,wins:rows.filter(r=>r.after.SMARTCOURIER.net>r.after.BASELINE.net).length,ties:rows.filter(r=>r.after.SMARTCOURIER.net===r.after.BASELINE.net).length,losses:rows.filter(r=>r.after.SMARTCOURIER.net<r.after.BASELINE.net).length,beforeLate:rows.reduce((n,r)=>n+r.before.SMARTCOURIER.late,0),afterLate:rows.reduce((n,r)=>n+r.after.SMARTCOURIER.late,0)};
 fs.writeFileSync(path.join(out,`${holdout?'holdout-':''}${real?'routed-validation':'estimated-validation'}.json`),JSON.stringify({summary,rows},null,2));
 console.log('SUMMARY',JSON.stringify(summary));
}
main().catch(e=>{console.error(e);process.exitCode=1});
