import { useState } from 'react';
import { Play, Pause, Square, Plus, Clock3, TrafficCone } from 'lucide-react';
import { useSimulation } from '../contexts/SimulationContext';
import { Notice } from './UI';
import { errorMessage, fixed, num, statusLabel } from '../utils/display';
import { formatShiftClock } from '../utils/shiftClock';

export default function SimulationControls(){
 const s=useSimulation();const [busy,setBusy]=useState(''),[error,setError]=useState('');
 async function run(name,fn){setBusy(name);setError('');try{await fn();}catch(e){setError(errorMessage(e));}finally{setBusy('');}}
 const status=s.simulation?.status,active=['RUNNING','PAUSED','CREATED'].includes(status);
 const progress=Math.min(100,Math.max(0,num(s.clock.second)/Math.max(1,num(s.clock.durationSeconds))*100));
 return <><div className="simulation-controls panel"><div className="turn-info"><span className={`status-pill ${status==='RUNNING'?'running':''}`}><i/>{s.simulation?statusLabel(status):'Listo para comenzar'}</span><span className="turn-clock"><Clock3 size={17}/>{formatShiftClock(s.clock.second)}</span><span className="muted">{s.simulation?`${s.simulation.mode} · seed ${s.simulation.seed}`:'Turno DEMO · 3 horas simuladas'}</span></div><div className="control-actions">{s.simulation&&<div className="speed-control" aria-label="Velocidad de simulación">{[1,2,5,10].map(n=><button key={n} onClick={()=>run('speed',()=>s.changeSpeed(n))} aria-pressed={s.speed===n} disabled={!active||!!busy||s.isStarting} className={s.speed===n?'selected':''}>{n}x</button>)}</div>}
 {status==='RUNNING'&&<button className="button secondary" disabled={!!busy} onClick={()=>run('pause',s.pause)}><Pause size={16}/>Pausar</button>}
 {status==='PAUSED'&&<button className="button primary" disabled={!!busy} onClick={()=>run('resume',s.resume)}><Play size={16}/>Reanudar</button>}
 {status==='CREATED'&&!s.isStarting&&<button className="button primary" disabled={!!busy} onClick={()=>run('start',s.startCreated)}><Play size={16}/>Reintentar inicio</button>}
 {['RUNNING','PAUSED'].includes(status)&&<button className="button secondary danger" disabled={!!busy} onClick={()=>run('stop',s.stop)}><Square size={15}/>Detener</button>}
 {!active&&<button className="button primary" disabled={s.isStarting||s.isRestoring||!!busy} onClick={()=>run('start',()=>s.startDemo())}>{s.simulation?<Plus size={17}/>:<Play size={17}/>} {s.isStarting?'Calculando rutas...':s.simulation?'Nueva simulación':'Iniciar simulación DEMO'}</button>}
 {!active&&<button className="button secondary" disabled={s.isStarting||s.isRestoring||!!busy} onClick={()=>run('start',()=>s.startDemo({mode:'FRESH',durationSeconds:10800}))}>Escenario aleatorio</button>}
 {s.isStarting&&active&&<span className="muted">Calculando rutas...</span>}
 </div>{s.simulation&&<div className="turn-progress"><progress value={progress} max="100" aria-label="Avance del turno"/><span>{fixed(progress,0)}% del turno</span>{s.clock.trafficLevel&&<span><TrafficCone size={14}/>Tráfico {s.clock.trafficLevel}</span>}</div>}{!active&&<small className="scenario-help">DEMO repite la misma semilla para comparar cambios. Escenario aleatorio genera otro turno de 3 horas.</small>}</div><Notice>{error||s.syncError}</Notice>{s.isRestoring&&<p className="muted">Recuperando el turno anterior...</p>}</>;
}
