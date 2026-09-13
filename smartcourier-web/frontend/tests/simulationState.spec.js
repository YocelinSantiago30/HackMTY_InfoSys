import {test,expect} from '@playwright/test';
import {applySimulationRefresh} from '../src/utils/simulationState';
test('una respuesta REST atrasada no deshace el progreso recibido por socket',()=>{
 const previous={clock:{second:300,trafficLevel:'HIGH'},couriers:{SMARTCOURIER:{lat:25.7,lng:-100.3}},routes:{SMARTCOURIER:{coordinates:[[1,2],[3,4]]}},agents:{SMARTCOURIER:{totalEarnings:60}}};
 const stale={current_simulation_second:240,simulation_duration_seconds:10800,visualState:{second:240,agents:{SMARTCOURIER:{lat:25.6,lng:-100.4}},routes:{SMARTCOURIER:null},trafficLevel:'LOW'}};
 const result=applySimulationRefresh(previous,stale,{agents:{SMARTCOURIER:{totalEarnings:40}}});
 expect(result.clock.second).toBe(300);expect(result.clock.trafficLevel).toBe('HIGH');
 expect(result.couriers).toEqual(previous.couriers);expect(result.routes).toEqual(previous.routes);expect(result.agents).toEqual(previous.agents);
 const updated=applySimulationRefresh(previous,{...stale,visualState:{...stale.visualState,second:315}},{});
 expect(updated.clock.second).toBe(315);expect(updated.couriers).toEqual(stale.visualState.agents);
});
