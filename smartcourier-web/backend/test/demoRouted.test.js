const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../src/simulation/SimulationCore');
const directory=path.resolve(__dirname,'../../output/validation/demo-review');
test('regresión del DEMO de la captura: mismas rutas OSRM y Baseline intacto',async()=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));
 const cache=JSON.parse(fs.readFileSync(path.join(directory,'routes.json')));
 const decisions=[];
 const core=new Core({simulationId:'demo-regression',seed:fixture.seed,durationSeconds:fixture.durationSeconds,preferences:fixture.preferences,getRoute:async p=>{
  const key=['originLat','originLng','destinationLat','destinationLng'].map(k=>Number(p[k]).toFixed(5)).join(',');
  assert.ok(cache[key],`Falta ruta grabada ${key}; esta prueba no usa Internet`);return cache[key];
 },hooks:{onDecision:d=>decisions.push(d)}});
 core.setSimulationOrders(fixture.orders);core.nextOrderNumber=fixture.orders.at(-1).spec.orderNumber+1;
 await core.advanceTo(fixture.durationSeconds);await core.finishShift();
 const net=code=>Number((core.agents[code].counters.grossEarnings-core.agents[code].counters.operatingCost).toFixed(2));
 assert.equal(net('BASELINE'),809.66,'La física de la referencia no se cambia para favorecer a SmartCourier');
 assert.ok(net('SMARTCOURIER')>=809.66,'No debe repetirse la pérdida de oportunidad del DEMO reportado');
 assert.equal(decisions.find(d=>d.agentCode==='SMARTCOURIER'&&d.order.external_order_number===17).decision,'ACCEPT');
});
