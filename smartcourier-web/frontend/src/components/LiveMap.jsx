import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AGENT_COLORS } from '../constants/theme';

const CENTER=[25.6866,-100.3161];
const icon=(label,color,small=false)=>L.divIcon({className:'courier-marker-shell',html:`<span class="courier-marker ${small?'small':''}" style="--marker-color:${color}">${label}</span>`,iconSize:small?[26,26]:[36,36],iconAnchor:small?[13,13]:[18,18]});
export default function LiveMap({couriers,routes,user,centerRequest=0,simulationId,onError}){
 const container=useRef(null),map=useRef(null),markers=useRef({}),layers=useRef({}),signatures=useRef({}),userMarker=useRef(null);
 useEffect(()=>{
   const m=L.map(container.current,{zoomControl:false}).setView(CENTER,12);map.current=m;
   L.control.zoom({position:'topright'}).addTo(m);
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).on('tileerror',()=>onError?.('No se pudo cargar una parte del mapa. Las rutas y los datos del turno siguen disponibles.')).addTo(m);
   const resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(container.current);
   return()=>{resize.disconnect();m.remove();map.current=null;markers.current={};layers.current={};signatures.current={};};
 },[]);
 useEffect(()=>{map.current?.setView(CENTER,12);},[simulationId]);
 useEffect(()=>{
   const m=map.current;if(!m)return;
   for(const code of ['BASELINE','SMARTCOURIER']){
     const p=couriers?.[code];
     if(p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))){
       const location=[Number(p.lat),Number(p.lng)];
       if(!markers.current[code])markers.current[code]=L.marker(location,{icon:icon(code==='BASELINE'?'B':'S',AGENT_COLORS[code]),zIndexOffset:500}).addTo(m).bindTooltip(code==='BASELINE'?'Baseline':'SmartCourier AI');
       else markers.current[code].setLatLng(location);
     }else if(markers.current[code]){m.removeLayer(markers.current[code]);delete markers.current[code];}
   }
 },[couriers]);
 useEffect(()=>{
   const m=map.current;if(!m)return;
   for(const code of ['BASELINE','SMARTCOURIER']){
     const route=routes?.[code];const signature=JSON.stringify([route?.kind,route?.coordinates]);
     if(signatures.current[code]===signature)continue;
     signatures.current[code]=signature;
     if(layers.current[code])m.removeLayer(layers.current[code]);
     layers.current[code]=null;
     if(!route?.coordinates?.length)continue;
     const color=AGENT_COLORS[code],points=route.coordinates.map(([lng,lat])=>[Number(lat),Number(lng)]);
     const group=L.layerGroup().addTo(m);layers.current[code]=group;
     L.polyline(points,{color,weight:code==='SMARTCOURIER'?5:4,opacity:0.8,dashArray:route.kind==='REPOSITION'?'8 8':undefined}).addTo(group);
     for(const stop of route.displayStops||route.stops||[]){
       L.marker([Number(stop.lat),Number(stop.lng)],{icon:icon(stop.type==='PICKUP'?'P':stop.type==='DROPOFF'?'D':'R',color,true)}).bindTooltip(`${stop.type==='PICKUP'?'Recolección':'Entrega'} #${Number(stop.orderNumber)}`).addTo(group);
     }
   }
 },[routes]);
 useEffect(()=>{
   const m=map.current;if(!m)return;
   if(user&&!simulationId){
     if(userMarker.current)m.removeLayer(userMarker.current);
     userMarker.current=L.circleMarker([user.lat,user.lng],{radius:8,color:'#fff',weight:3,fillColor:'#1976d2',fillOpacity:1}).addTo(m).bindTooltip('Tu ubicación');
     m.setView([user.lat,user.lng],14);
   }else if(userMarker.current){m.removeLayer(userMarker.current);userMarker.current=null;}
 },[user,simulationId]);
 useEffect(()=>{if(!centerRequest)return;const points=Object.values(routes||{}).flatMap(route=>(route?.coordinates||[]).map(([lng,lat])=>[lat,lng]));if(points.length)map.current?.fitBounds(L.latLngBounds(points),{padding:[40,40],maxZoom:15,animate:false});else{const p=couriers?.SMARTCOURIER||user;map.current?.setView(p?[p.lat,p.lng]:CENTER,13,{animate:false});}},[centerRequest]);
 return <div ref={container} className="live-map" aria-label="Mapa de Monterrey con rutas y repartidores"/>;
}
