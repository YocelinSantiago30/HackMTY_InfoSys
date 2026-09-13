// Una respuesta REST puede llegar después de un tick más reciente del socket.
// Nunca debe mover hacia atrás el reloj ni el marcador del repartidor.
export function applySimulationRefresh(prev,simulation,comparison){
 const second=simulation.visualState?.second??simulation.current_simulation_second;
 const current=Number(second)>=Number(prev.clock.second);
 return {...prev,simulation,speed:simulation.speed_multiplier||prev.speed,
  ...(current?{agents:comparison.agents||prev.agents,comparison:comparison.comparison||prev.comparison}:{}),
  clock:{...prev.clock,second:Math.max(Number(prev.clock.second),Number(second)),durationSeconds:simulation.simulation_duration_seconds,...(current&&simulation.visualState?{trafficLevel:simulation.visualState.trafficLevel}: {})},
  ...(current&&simulation.visualState?{couriers:simulation.visualState.agents,routes:simulation.visualState.routes}:{}),
 };
}
