// Laboratorio web por solicitud: no modifica el turno global de los jueces.
const { Router } = require('express');
const auth = require('../middlewares/auth.middleware');
const { decide } = require('../courier/fastPath');
const { loadDemandModel } = require('../courier/demandModel');
const StrategyClient = require('../courier/strategyClient');
const { toSeconds, toIso } = require('../courier/world');
const { ZONES } = require('../courier/config');
const router = Router();
router.use(auth);
router.get('/config', (_req,res)=>res.json({zones:ZONES.map(({id,name})=>({id,name}))}));
router.post('/evaluate', async (req,res)=>{
 try{
  const demandModel=loadDemandModel();
  const client=new StrategyClient({timeoutMs:3000});
  // Validar antes de consultar la estrategia. Los overrides son obligatorios
  // porque cada prueba es independiente y no puede heredar otra sesión.
  const checked=decide(req.body,{demandModel,strategy:client.current()});
  const state=checked.explain.inputs.courier_state;
  const context={vehicle:req.body.vehicle,sim_time:req.body.sim_time,shift_start_time:toIso(toSeconds(req.body.sim_time)-state.shift_elapsed_hours*3600),shift_end_time:state.shift_end_time,current_zone:state.current_zone??req.body.zone_pickup,earnings_mxn:0,orders_completed:0,active_shocks:[]};
  const strategy=await client.refresh(context);
  const start=performance.now();
  const result=decide(req.body,{demandModel,strategy});
  res.json({...result.response,latency_ms:Math.round((performance.now()-start)*100)/100,model_version:strategy.model_version,explanation:result.explain});
 }catch(error){res.status(400).json({error:error.message});}
});
module.exports=router;
