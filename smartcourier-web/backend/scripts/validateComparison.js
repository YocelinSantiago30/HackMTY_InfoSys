const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {runSeed,SCENARIOS}=require('./compareStrategies');
const round=n=>Math.round(n*100)/100;
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
async function main(){
 const rows=[];
 for(const [index,vehicle] of ['motorcycle','bike','car'].entries()){
  for(const [scenario,events] of Object.entries(SCENARIOS)){
   for(let i=0;i<18;i++){
    const seed=150001+index*18+i;
    rows.push({seed,vehicle,scenario,...await runSeed(seed,{vehicle,events})});
   }
  }
 }
 const summarize=rs=>({runs:rs.length,positive:rs.filter(r=>r.SMARTCOURIER.net>0).length,zero:rs.filter(r=>r.SMARTCOURIER.net===0).length,negative:rs.filter(r=>r.SMARTCOURIER.net<0).length,min_net_mxn:round(Math.min(...rs.map(r=>r.SMARTCOURIER.net))),smart_mean_net_mxn:round(mean(rs.map(r=>r.SMARTCOURIER.net))),baseline_mean_net_mxn:round(mean(rs.map(r=>r.BASELINE.net))),smart_mean_net_hour:round(mean(rs.map(r=>r.SMARTCOURIER.netPerWorkedHour))),baseline_mean_net_hour:round(mean(rs.map(r=>r.BASELINE.netPerWorkedHour))),wins_by_net_hour:rs.filter(r=>r.SMARTCOURIER.netPerWorkedHour>r.BASELINE.netPerWorkedHour).length,smart_late:rs.reduce((n,r)=>n+r.SMARTCOURIER.late,0),baseline_late:rs.reduce((n,r)=>n+r.BASELINE.late,0)});
 const report={seeds:[150001,150054],note:'Holdout del comparador: 54 seeds × 3 escenarios. 18 seeds por vehículo. Rutas deterministas estimadas; mismas condiciones para ambos agentes. Sin reentrenar.',summary:summarize(rows),by_vehicle:Object.fromEntries(['motorcycle','bike','car'].map(v=>[v,summarize(rows.filter(r=>r.vehicle===v))])),by_scenario:Object.fromEntries(Object.keys(SCENARIOS).map(s=>[s,summarize(rows.filter(r=>r.scenario===s))])),rows};
 const out=path.resolve(__dirname,'../../output/validation');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'comparison-162.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined},null,2));
 assert.equal(report.summary.negative,0,'Turnos con pérdida: revisar el informe sin ocultarlos');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
