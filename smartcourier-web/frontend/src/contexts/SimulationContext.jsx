import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { disconnectSocket, joinSimulation, leaveSimulation } from '../services/socket';
import * as api from '../api/simulation.api';
import { errorMessage } from '../utils/display';
import { applySimulationRefresh } from '../utils/simulationState';

const Context = createContext(null);
const empty = () => ({ simulation:null, speed:1, clock:{second:0,durationSeconds:0,trafficLevel:null}, agents:{BASELINE:{},SMARTCOURIER:{}}, comparison:null, currentOrder:null, baselineDecision:null, smartDecision:null, recentEvents:[], couriers:{BASELINE:null,SMARTCOURIER:null}, routes:{BASELINE:null,SMARTCOURIER:null} });

export function SimulationProvider({children}) {
  const {token,user} = useAuth();
  const [state,set] = useState(empty);
  const [isStarting,setStarting] = useState(false);
  const [isRestoring,setRestoring] = useState(false);
  const [connection,setConnection] = useState('idle');
  const [syncError,setSyncError] = useState('');
  const current=useRef(null), orderId=useRef(null), cleanup=useRef(()=>{}), generation=useRef(0);
  const storageKey=user ? `smartcourier.web.simulation.${user.id}` : null;
  const patch=(part)=>set(prev=>({...prev,...part}));
  const persist=(id)=>{ try { if(storageKey) id ? localStorage.setItem(storageKey,id) : localStorage.removeItem(storageKey); } catch {} };

  async function refresh(id) {
    const [sim,comparison] = await Promise.all([api.getSimulationRequest(id),api.getComparisonRequest(id)]);
    if(current.current!==id) return;
    set(prev=>applySimulationRefresh(prev,sim,comparison));
    setSyncError('');
  }

  function unbind() { cleanup.current(); cleanup.current=()=>{}; }

  async function attach(id,epoch) {
    setConnection('connecting');
    const socket=await joinSimulation(id,token);
    if(epoch!==generation.current) return false;
    setConnection('connected');
    const handlers=[];
    function on(name,fn,filtered=true) {
      const handler=(payload)=>{if(current.current===id && (!filtered||payload?.simulationId===id))fn(payload);};
      socket.on(name,handler); handlers.push([name,handler]);
    }
    on('new_order',order=>{orderId.current=order.id;patch({currentOrder:order,baselineDecision:null,smartDecision:null});});
    on('baseline_decision',d=>{if(d.orderId===orderId.current)patch({baselineDecision:d});});
    on('smart_decision',d=>{if(d.orderId===orderId.current)patch({smartDecision:d});});
    on('metrics_updated',p=>set(prev=>({...prev,agents:p.agents||prev.agents,comparison:p.comparison||prev.comparison})));
    on('simulation_tick',p=>patch({clock:{second:p.second,durationSeconds:p.durationSeconds,trafficLevel:p.trafficLevel},speed:p.speed,couriers:p.agents}));
    on('route_updated',p=>set(prev=>({...prev,routes:{...prev.routes,[p.agentCode]:p.route},couriers:{...prev.couriers,[p.agentCode]:{...prev.couriers[p.agentCode],...p.position}}})));
    on('order_completed',p=>set(prev=>({...prev,couriers:{...prev.couriers,[p.agentCode]:{...prev.couriers[p.agentCode],...p.position}}})));
    on('simulation_event',p=>set(prev=>({...prev,recentEvents:[{...p,id:crypto.randomUUID()},...prev.recentEvents].slice(0,5)})));
    on('simulation_speed_changed',p=>patch({speed:p.speed}));
    for(const name of ['simulation_started','simulation_paused','simulation_resumed','simulation_finished'])on(name,p=>{patch({simulation:p});if(name==='simulation_finished')refresh(id).catch(e=>setSyncError(errorMessage(e)));});
    on('disconnect',()=>setConnection('reconnecting'),false);
    on('connect_error',()=>setConnection('reconnecting'),false);
    on('connect',()=>{setConnection('connected');refresh(id).catch(e=>setSyncError(errorMessage(e)));},false);
    const interval=setInterval(()=>refresh(id).catch(e=>{if(current.current===id)setSyncError(errorMessage(e));}),5000);
    cleanup.current=()=>{clearInterval(interval);handlers.forEach(([name,fn])=>socket.off(name,fn));leaveSimulation(id);};
    return true;
  }

  async function openSimulation(id) {
    const epoch=++generation.current;
    unbind(); current.current=id;orderId.current=null;set(empty());setSyncError('');
    try {
      const sim=await api.getSimulationRequest(id);
      if(epoch!==generation.current)return;
      patch({simulation:sim});
      if(!await attach(id,epoch))return;
      persist(id); await refresh(id);
    } catch(e) {
      if(epoch===generation.current) { unbind();setConnection('idle');setSyncError(errorMessage(e)); }
      throw e;
    }
  }

  async function startDemo(options={mode:'DEMO'}) {
    const epoch=++generation.current;
    setStarting(true);unbind();current.current=null;orderId.current=null;set(empty());setSyncError('');
    try {
      const created=await api.createSimulationRequest(options);
      if(epoch!==generation.current)return;
      current.current=created.id;persist(created.id);patch({simulation:created});
      // Listen before start: the first order may be emitted during this request.
      if(!await attach(created.id,epoch))return;
      const started=await api.startSimulationRequest(created.id);
      if(epoch===generation.current){patch({simulation:started});await refresh(created.id);}
      return started;
    } catch(e) {if(epoch===generation.current)setSyncError(errorMessage(e));throw e;}
    finally {if(epoch===generation.current)setStarting(false);}
  }

  async function action(name) {
    const id=current.current;if(!id)return;
    const result=await api[name](id);if(current.current===id)patch({simulation:result});
    await refresh(id);
  }
  async function changeSpeed(speed) {
    const id=current.current;if(!id)return;
    await api.setSpeedRequest(id,speed);if(current.current===id)patch({speed});
  }
  function reset() {++generation.current;unbind();disconnectSocket();current.current=null;orderId.current=null;persist(null);set(empty());setStarting(false);setRestoring(false);setConnection('idle');setSyncError('');}

  useEffect(()=>{
    if(!token){reset();return;}
    let saved;try{saved=localStorage.getItem(storageKey);}catch{}
    if(saved){setRestoring(true);openSimulation(saved).catch(e=>{if([403,404].includes(e.response?.status))persist(null);}).finally(()=>setRestoring(false));}
    return ()=>{++generation.current;unbind();disconnectSocket();current.current=null;};
  },[token]);

  return <Context.Provider value={{...state,isStarting,isRestoring,connection,syncError,startDemo,openSimulation,pause:()=>action('pauseSimulationRequest'),resume:()=>action('resumeSimulationRequest'),stop:()=>action('stopSimulationRequest'),startCreated:()=>action('startSimulationRequest'),changeSpeed,reset}}>{children}</Context.Provider>;
}
export function useSimulation(){return useContext(Context);}
