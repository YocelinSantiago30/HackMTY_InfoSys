require('dotenv').config({path:require('path').resolve(__dirname,'../.env'),quiet:true});
const fs=require('fs'),path=require('path'),axios=require('axios');
const SimulationCore=require('../src/simulation/SimulationCore');
const out=path.resolve(__dirname,'../../output/validation/demo-review');fs.mkdirSync(out,{recursive:true});
const cachePath=path.join(out,'routes.json');
const cache=fs.existsSync(cachePath)?JSON.parse(fs.readFileSync(cachePath)):{};
async function routed(params){
 const key=['originLat','originLng','destinationLat','destinationLng'].map(k=>Number(params[k]).toFixed(5)).join(',');
 if(!cache[key]){cache[key]=(await axios.post('http://127.0.0.1:5002/api/routing/route',params,{timeout:15000})).data;const temp=`${cachePath}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(cache));fs.renameSync(temp,cachePath);}
 return cache[key];
}
async function capture(){
 const pool=require('../src/config/database');
 try{
  const s=(await pool.query("SELECT s.id,s.seed,s.simulation_duration_seconds,r.simulation_orders FROM simulation_sessions s JOIN simulation_runtime r ON r.simulation_id=s.id WHERE s.seed=42026 AND s.status='FINISHED' AND s.current_simulation_second=10800 ORDER BY s.created_at DESC LIMIT 1")).rows[0];
  if(!s)throw Error('No existe un DEMO completo para reproducir');
  const p=(await pool.query('SELECT p.* FROM user_preferences p JOIN simulation_sessions s ON s.user_id=p.user_id WHERE s.id=$1',[s.id])).rows[0];
  delete p.id;delete p.user_id;delete p.created_at;delete p.updated_at;
  fs.writeFileSync(path.join(out,'fixture.json'),JSON.stringify({seed:Number(s.seed),durationSeconds:s.simulation_duration_seconds,preferences:p,orders:s.simulation_orders}));
 }finally{await pool.end();}
}
async function main(){
 const before=process.argv.includes('--capture-before');
 if(before)await capture();
 const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.json')));
 const decisions=[];
 const core=new SimulationCore({simulationId:'demo-audit',seed:fixture.seed,durationSeconds:fixture.durationSeconds,preferences:fixture.preferences,getRoute:routed,hooks:{onDecision:d=>decisions.push(d)}});
 core.setSimulationOrders(fixture.orders);core.nextOrderNumber=fixture.orders.at(-1).spec.orderNumber+1;
 await core.advanceTo(fixture.durationSeconds);await core.finishShift();
 const metrics=Object.fromEntries(Object.entries(core.agents).map(([code,a])=>[code,{...a.counters,net:Number((a.counters.grossEarnings-a.counters.operatingCost).toFixed(2))}]));
 const report={seed:fixture.seed,routeSources:[...new Set(fixture.orders.map(o=>o.route.source))],metrics,decisions};
 fs.writeFileSync(path.join(out,before?'before.json':'after.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({metrics,waits:decisions.filter(d=>d.decision==='WAIT').map(d=>({order:d.order.external_order_number,...d.estimatedImpact?.lookahead}))},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={routed};
