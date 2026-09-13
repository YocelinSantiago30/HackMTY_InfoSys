# Corrección del mapa y del DEMO - 13 septiembre 2026

Se trabajó solo en `smartcourier-web`. Los 99 archivos del manifiesto inicial del proyecto original siguen intactos.

## Caso reproducido, sin cambiar los pedidos

Se recuperó el flujo y las rutas OSRM del DEMO completo guardado (seed 42026, 3 horas, preferencias originales). La reproducción coincide exactamente con la captura del usuario:

| Política | Antes | Después |
| --- | ---: | ---: |
| Baseline | $809.66 | $809.66 |
| SmartCourier | $701.71 | $809.66 |
| Diferencia de SmartCourier | -13.3% | 0.0% |

El cambio recupera $107.95 de ganancia en ese caso. Ambas políticas ahora entregan 8 pedidos; antes SmartCourier entregaba 7. **El resultado corregido es un empate.** No se cambió la semilla, el pago, el costo por km ni la física de Baseline. La cifra negativa de la captura representaba menor ganancia frente a Baseline, no una pérdida neta de dinero.

El pedido 17 dejaba $66.05 netos estimados. El planificador lo omitía porque seis escenarios sintéticos daban a esperar una ventaja media de $17.35, con alta dispersión. Esperar lo llevaba a otra secuencia de pedidos y una entrega menos en el turno. La corrección evita esa espera cuando la evidencia es débil y el rendimiento del pedido actual cubre el costo de oportunidad.

## Correcciones

1. El mapa ya no encuadra automáticamente cada respuesta de rutas. La vista cambia con los controles del usuario o al iniciar otro turno.
2. La asignación conserva su geometría y sus paradas visuales. Avanzar, recoger, cambiar ETA o recibir un snapshot mueve el marcador; no reconstruye el trazo. Un pedido realmente nuevo, agrupación aceptada o cancelación puede cambiar la asignación.
3. Las respuestas REST atrasadas no pueden hacer retroceder la posición, el reloj ni las métricas ya recibidas por socket.
4. El horizonte de planificación termina como máximo al cierre del turno. Antes se simulaban pedidos después de ese cierre.
5. El margen de espera se obtiene del error estándar de diferencias pareadas de aceptar frente a esperar. Solo se aplica si el neto/minuto del pedido actual alcanza el costo de oportunidad ya existente ($2.50/min). No cambia las restricciones obligatorias.
6. Un batch se compara con el costo que falta de la ruta ya asignada. Se eliminó el recálculo innecesario de esa ruta de referencia desde cada posición móvil.
7. Se añadió **Escenario aleatorio** (FRESH, 3 horas). DEMO mantiene 42026 para que repetirlo sea una comparación controlada.

Los resultados históricos permanecen como ocurrieron. Para usar la política corregida, iniciar un turno nuevo. El módulo Courier entrenado y sus parámetros no se modificaron en esta revisión.

## Evaluación y límites

Se usaron 161001-161006 (rutas OSRM) y 162001-162027 (81 combinaciones estimadas) durante el diagnóstico; no se presentan como evaluación independiente. Se ensayaron 24 escenarios, pero no mejoraron el conjunto de desarrollo y se descartaron. La versión final mantiene 6, incorpora el margen condicionado por rendimiento y corrige el horizonte. Luego se congeló esa versión y se abrieron semillas distintas:

| Evaluación independiente | Casos | Neto medio anterior | Neto medio corregido | Baseline | Positivos | Gana / empata / pierde frente a Baseline |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| OSRM, seeds 170001-170006 | 6 | $442.03 | $433.04 | $310.62 | 6 | 4 / 0 / 2 |
| Estimadas, seeds 171001-171027, 3 escenarios | 81 | $439.70 | $432.79 | $261.59 | 81 | 74 / 0 / 7 |

**No hay evidencia de una mejora general de ganancia frente a la versión anterior:** la media bajó aproximadamente 2% en los seis casos OSRM y 1.6% en los 81 casos estimados, aunque sigue por encima de Baseline. OSRM registró 6 retrasos frente a 3 antes; en rutas estimadas fueron 90 frente a 92. El cambio corrige el caso reportado y la interpretación de incertidumbre, pero tiene un intercambio entre oportunidades que no debe ocultarse. No se volvió a ajustar con esas semillas para fabricar un resultado positivo.

Las rutas OSRM se guardaron en `routes.json`. El mundo sigue siendo un simulador: la demanda y los pagos son sintéticos, aunque las geometrías y distancias provengan de OSRM. Ninguna política que desconozca el futuro puede prometer ganar todos los enfrentamientos. Los informes y PDFs del 12 de septiembre describen la versión anterior; este documento registra los resultados posteriores.

## Pruebas terminadas

- 80 pruebas del backend: regresión del DEMO con rutas grabadas, seguridad, horizonte, costos, geometría fija, recuperación y determinismo por velocidad.
- 4 pruebas web: 3 recorridos Chromium (flujo completo, fallos de sesión/red, DEMO completo y FRESH) y 1 prueba de estado contra respuestas atrasadas.
- En el navegador se verifica que el marcador cambie de posición mientras las polilíneas conservan sus nodos y coordenadas SVG y la cámara conserva su transformación, incluso tras el refresco REST.
- El DEMO completo desde la interfaz a 10x devuelve y muestra $809.66 por agente.
- Compilación Vite y comprobación de los tres servicios locales.

## Archivos y reproducción

- `before.json` y `after.json`: métricas y decisiones del caso original.
- `fixture.json` y `routes.json`: pedidos y rutas grabadas para reproducirlo sin elegir otra seed.
- `holdout-routed-validation.json` y `holdout-estimated-validation.json`: todos los casos, incluidos los desfavorables.
- `development-six-scenarios.json` y `development-24-scenarios.json`: ensayos del diagnóstico.
- `demo-completo-result.json`: resultado de la prueba completa en navegador.

Desde `smartcourier-web`:

```sh
npm run test:backend
npm run test:web
npm run build
npm run status
node backend/scripts/auditDemo.js
node backend/scripts/validateDemoFix.js --holdout --routed
node backend/scripts/validateDemoFix.js --holdout
```

Los dos últimos comandos comparan contra el código del proyecto original en la carpeta padre; se conserva intacto como referencia. El test de regresión del DEMO usa las rutas grabadas y no depende de Internet. `npm start` deja la copia local corriendo en segundo plano y `npm stop` la detiene.
