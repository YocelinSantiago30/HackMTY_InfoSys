import { useEffect, useRef, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { getOrderDecisionsRequest } from '../api/order.api';
import { Badge, Loading, Notice } from './UI';
import { agentTitle, errorMessage, fixed, money, num } from '../utils/display';

const factorNames={PROFIT_PER_MINUTE:'Ganancia por minuto',NET_PROFIT:'Ganancia neta',PROFIT_PER_KM:'Ganancia por km',DISTANCE_TO_PICKUP:'Cercanía al negocio',TOTAL_TIME:'Tiempo total',DESTINATION_DEMAND:'Demanda en destino',finalPayment:'Pago final',paymentPerMinute:'Pago por minuto',paymentPerKm:'Pago por km',distanceKm:'Distancia'};
export function Reasons({items=[]}){return <ul className="reasons">{items.map((r,i)=><li key={i} className={r.passed===false?'failed':''}>{r.message||<><span>{factorNames[r.factor||r.criterion]||r.factor||r.criterion||r.code}</span><b>{r.points!==undefined?`${fixed(r.points,2)} pts`:r.value!==undefined?`${r.value} ${r.comparator} ${r.threshold} ${r.passed?'✓':'✕'}`:''}</b></>}</li>)}</ul>;}
export function Economics({impact}){
 if(!impact)return null;
 const rows=impact.netProfit!==undefined?[
  ['Al negocio',`${fixed(impact.distanceToPickupKm)} km`],['Entrega',`${fixed(impact.deliveryDistanceKm)} km`],['Tiempo total',`${fixed(impact.totalMinutes)} min`],['Espera',`${fixed(impact.waitMinutes)} min`],['Costo operativo',money(impact.operatingCost)],['Ganancia neta',money(impact.netProfit)],['Neto por minuto',money(impact.profitPerMinute)],['Neto por km',money(impact.profitPerKm)],
 ]:impact.additionalNetProfit!==undefined?[
  ['Km adicionales',fixed(impact.additionalDistance)],['Minutos adicionales',fixed(impact.additionalTime)],['Pago adicional',money(impact.additionalRevenue)],['Costo adicional',money(impact.additionalCost)],['Neto adicional',money(impact.additionalNetProfit)],['Retraso vs promesa',`${fixed(impact.maxLateMinutesVsPromise)} min`],
 ]:[];
 return rows.length?<dl className="economics">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>:null;
}
export function Lookahead({data,compact=false}){
 if(!data)return null;
 return <div className="lookahead"><div className="section-top"><span>ACEPTAR VS ESPERAR</span><small>{data.scenarios} escenarios · {data.horizonMinutes} min</small></div><div className="lookahead-values"><div><small>Aceptar</small><strong>{money(data.accept?.mean)}</strong>{!compact&&<small>p10 {money(data.accept?.p10)} · p90 {money(data.accept?.p90)}</small>}</div><ArrowRight size={18}/><div><small>Esperar</small><strong>{money(data.wait?.mean)}</strong>{!compact&&<small>p10 {money(data.wait?.p10)} · p90 {money(data.wait?.p90)}</small>}</div></div>{!compact&&<p>Ventaja de aceptar: <b>{money(data.acceptAdvantage)}</b> (p10 {money(data.advantageP10)} · p90 {money(data.advantageP90)}). Costo de oportunidad: {money(data.opportunityCostPerMinute)}/min extra.{data.waitAdvantageRequired!=null&&<> Esperar exige superar {money(data.waitAdvantageRequired)} de variación estimada del muestreo.</>}</p>}</div>;
}
function WhatIf({decision,impact}){
 if(!impact||impact.netProfit===undefined||['BATCH','REPOSITION','REROUTE'].includes(decision))return null;
 const sign=decision==='ACCEPT'?-1:1;
 return <div className="what-if"><h4>{decision==='ACCEPT'?'Si hubiera rechazado':'Si hubiera aceptado'}</h4><p>Neto: {money(sign*num(impact.netProfit))} · distancia: {fixed(sign*num(impact.totalKm))} km · tiempo: {fixed(sign*num(impact.totalMinutes))} min.</p><small>Impacto estimado del pedido individual.</small></div>;
}
export default function DecisionInspector({orderId,onClose}){
 const dialog=useRef(null);const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!orderId)return;let active=true;setData(null);setError('');setLoading(true);dialog.current?.showModal();getOrderDecisionsRequest(orderId).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;dialog.current?.close();};},[orderId]);
 if(!orderId)return null;
 return <dialog ref={dialog} className="inspector" aria-labelledby="inspector-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><header className="inspector-header"><div><p className="eyebrow">EXPLICACIÓN DE LA DECISIÓN</p><h2 id="inspector-title">Decision Inspector</h2></div><button className="icon-button" aria-label="Cerrar inspector" onClick={onClose}><X/></button></header><div className="inspector-body"><Notice>{error}</Notice>{loading?<Loading/>:data&&<>
  <section className="panel"><span className="eyebrow">PEDIDO #{data.order.external_order_number}</span><h3>{data.order.merchant_name}</h3><p>{money(data.order.final_payment)} · {fixed(data.order.distance_km)} km · {fixed(data.order.estimated_time_minutes)} min</p><small>Recolección: {fixed(data.order.pickup_lat,4)}, {fixed(data.order.pickup_lng,4)}<br/>Destino: {fixed(data.order.dropoff_lat,4)}, {fixed(data.order.dropoff_lng,4)}<br/>Tráfico: {data.order.traffic_level} · Surge: ×{data.order.surge_multiplier}</small></section>
  {['BASELINE','SMARTCOURIER'].map(code=>{const d=data.decisions.find(x=>x.agent_code===code);return <section className={`panel agent-${code}`} key={code}><div className="section-top"><h3>{agentTitle(code)}</h3><Badge decision={d?.decision}/></div>{!d?<p>Sin decisión registrada para este agente.</p>:<>{d.score!=null&&<p className="score">Puntaje <b>{d.score}/100</b></p>}<Reasons items={d.restrictions}/><Economics impact={d.estimated_impact}/><Reasons items={code==='BASELINE'?d.reasons:[...(d.positive_factors||[]),...(d.negative_factors||[])]}/><h4>¿Qué habría pasado si...?</h4>{d.estimated_impact?.lookahead?<Lookahead data={d.estimated_impact.lookahead}/>:<WhatIf decision={d.decision} impact={d.estimated_impact}/>}</>}</section>;})}
 </>}</div></dialog>;
}
