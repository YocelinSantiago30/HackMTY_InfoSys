# SmartCourier AI - copia web

La aplicación funciona en **http://127.0.0.1:5173**. Esta carpeta es una copia independiente del proyecto. El frontend móvil original está archivado en `frontend-mobile/`; la aplicación nueva en `frontend/` usa React, Vite y Leaflet en el navegador.

## Actualización del 13 de septiembre: mapa y DEMO

El mapa mantiene su vista y la ruta asignada mientras avanza el marcador. El planificador limita el horizonte al fin del turno y pondera la incertidumbre antes de esperar. El DEMO de la captura pasó de $701.71 frente a $809.66 a un empate de $809.66. Se añadió **Escenario aleatorio** para probar otras semillas. Los turnos históricos no se reescriben.

Pruebas actuales: **80 del backend y 4 de la web**, incluyendo el DEMO completo. La evaluación nueva sigue por encima de Baseline en promedio, pero no demuestra una mejora general frente a la política anterior; consulta los casos y diferencias en [CORRECCION_MAPA_DEMO.md](output/validation/demo-review/CORRECCION_MAPA_DEMO.md). Los informes del 12 de septiembre son resultados históricos de la primera versión web.

## Iniciar, consultar y detener

Desde esta carpeta:

```sh
npm start
npm run status
npm stop
```

`npm start` deja los servicios en segundo plano, independientes de la terminal. `npm run dev` es la alternativa en primer plano, con logs visibles y Ctrl+C para detener. No uses ambos a la vez. El Mac debe permanecer encendido; no es un despliegue público ni un servicio que arranca automáticamente tras reiniciar macOS.

| Servicio | Dirección | Datos |
| --- | --- | --- |
| Web | http://127.0.0.1:5173 | React y mapa web |
| API | http://127.0.0.1:5002 | Base separada `smartcourier_web` |
| Estrategia y optimización Python | http://127.0.0.1:8001 | Modelos de esta copia |

Registra una cuenta en la web. No se copiaron usuarios ni contraseñas de la base original. Los registros de pruebas tienen nombres `Prueba Web` y correos `web-qa-...@example.test` en esta base aislada. Los logs del servidor están en `.runtime/server.log`.

## Qué puedes usar

- **Agente Courier:** consulta el modelo entrenado, cambia pago, propina, vehículo, distancias, zonas, capacidad y horarios, y revisa por qué recomienda aceptar o descartar. Incluye ejemplos de pedido rentable, pérdida sin propina, exceso de peso y fin de turno.
- **Comparación:** DEMO determinista, Baseline y SmartCourier con la misma física; pausa, reanudación, velocidades 1/2/5/10, seis eventos y resultado final.
- **Mapa en vivo:** Leaflet nativo, posiciones y rutas separadas, paradas, ETA y promesas. Recargar en pausa recupera rutas desde el snapshot confirmado.
- **Historial:** turnos, filtros, páginas, decisiones y explicación técnica.
- **Ajustes:** perfil, vehículo, mochila, zona, umbrales y horario guardados por cuenta.

La ganancia neta puede ser negativa al comenzar un recorrido: el simulador registra costos al avanzar y cobra al entregar. La pantalla lo indica. Para valorar el turno completo, usa el resultado final; detenerlo liquida las entregas pendientes según el motor original.

## Hay dos algoritmos distintos

**Comparador de la app:** `backend/src/agents/smartCourierAgent.js`, `lookaheadPlanner.js`, `batchEvaluator.js` y `SimulationCore.js`. Usa puntajes, restricciones y simulación de aceptar frente a esperar. Su costo por km incluye combustible, mantenimiento y depreciación estimados: bici $0.40, moto $2.00, auto $4.50.

**Agente Courier entrenado:** `backend/src/courier/fastPath.js` decide rápidamente; el servicio Python calcula una estrategia a partir de `models/courier/strategy_model.json` y `demand_model.json`. El costo del protocolo Courier es solo combustible: bici $0, moto $1.20/km, auto $2.40/km. No se deben mezclar métricas entre los dos mundos. Ninguno es un chat ni requiere llamar a un LLM para aceptar un pedido.

La carpeta `courier/` contiene el protocolo, esquemas, ejemplos y validadores. No es un historial masivo de repartos reales. Los modelos existentes se entrenaron con flujos sintéticos reproducibles, compatibles con ese protocolo, en las semillas 1-54. El ajuste adicional conservó los parámetros originales porque bajar las reservas redujo los ingresos de entrenamiento. Las semillas de evaluación no se usaron para escogerlos.

## Cambios económicos y de confiabilidad

1. Courier descarta un pedido si `pago_base × surge - combustible` redondeado a centavos es menor o igual a cero, incluso con propina alta o salario de reserva cero.
2. Terminar un pedido anterior y luego hacer el nuevo ya no resta dos veces los kilómetros previamente comprometidos.
3. Los plazos se comprueban también en pedidos individuales y en la alternativa de terminar primero la entrega anterior.
4. Se rechazan distancias, pagos, pesos, tiempos y multiplicadores numéricos inválidos.
5. Las cinco reglas de seguridad y el margen de cinco minutos se mantienen.
6. La web recibe el estado visual persistido; el laboratorio Courier exige JWT y evalúa cada consulta con una estrategia propia, sin modificar el turno global de los jueces.

`PROYECTO_SMARTCOURIER.md` conserva la documentación de referencia anterior a la migración. Este README, `COPY_AMENDMENTS.json` y el informe de validación describen las diferencias actuales. `COPY_MANIFEST.json` conserva los hashes iniciales de 99 archivos; `npm run verify:copy` comprueba los archivos sin cambiar y las modificaciones registradas. Los modelos anteriores están respaldados en `output/validation/before-refinement/`.

## Pruebas y evaluación reproducible

Con PostgreSQL disponible y el servidor iniciado para las pruebas web:

```sh
npm run test:backend
npm run test:web
npm run build
npm run verify:copy
node backend/scripts/courier/refineWeb.js train
node backend/scripts/courier/refineWeb.js holdout
node backend/scripts/courier/evaluate.js
node backend/scripts/validateComparison.js
```

El comando `train` modifica solo los artefactos de esta copia y conserva el respaldo anterior. No hace falta entrenar al arrancar. El holdout usa 108 semillas nuevas (130001-130108); el reporte del protocolo usa 90001-90030. El comparador tiene otro holdout de 54 semillas (150001-150054), con tres escenarios cada una: normal, tráfico severo y cierre vial. Los reportes completos por semilla están en `output/validation/` y `courier/results_table.csv`.

Validación realizada: **80 pruebas del backend**, **4 pruebas web (3 recorridos y 1 de estado)**, build de producción y validadores oficiales. Incluye autenticación, persistencia, mapa tras recargar, móvil, fallos de red, modelo caído y recuperado, repetición de decisiones y recuperación transaccional sin cobros duplicados.

## Instalación limpia en otro equipo

Requiere Node compatible con Vite 7, Python 3.11+ y PostgreSQL. En esta Mac las dependencias ya están instaladas; la copia no utiliza el `node_modules` ni el entorno virtual del original.

```sh
npm --prefix backend ci
npm --prefix frontend ci
python3 -m venv optimization-service/venv
optimization-service/venv/bin/pip install -r optimization-service/requirements.txt
```

Copia `backend/.env.example` a `backend/.env` y configura tu conexión PostgreSQL con base `smartcourier_web`, `PORT=5002`, `OPTIMIZATION_SERVICE_URL=http://127.0.0.1:8001`, `COURIER_MODEL_URL=http://127.0.0.1:8001` y tus claves locales. El lanzador transmite esa configuración al servicio Python. No subas `.env` a Git. Luego ejecuta:

```sh
npm run setup:db
npm start
```

Para instalar el navegador de pruebas: `cd frontend` y `npx playwright install chromium`. El frontend usa el proxy local de Vite para `/api` y `/socket.io`; no necesita una URL de API al usar el lanzador.

## Alcance del resultado

Está listo para uso y demostración local. El build está en `frontend/dist/`. Para publicar se necesita configurar hosting con fallback de rutas SPA, HTTPS, proxy de API/socket, base de datos y credenciales propias. Los endpoints originales de jueces (`/decide`, `/shift/start`, `/admin/model-credential`, etc.) mantienen su contrato local sin autenticación; no deben exponerse como una API pública multiusuario. El laboratorio `/api/courier` sí exige sesión.

OSRM y las teselas del mapa dependen de Internet. Si OSRM falla, el backend usa su estimador de rutas; si las teselas fallan, la web indica el problema. La evaluación offline usa rutas estimadas deterministas.

Las ganancias son resultados de simulación y dependen de los costos modelados. Se obtuvo ganancia media mayor que las referencias seguras, pero existen turnos donde otra política gana más, dos turnos Courier sin ingresos y retrasos de entrega. No hay garantía de beneficio en todos los pedidos o situaciones reales; no se alteran los resultados ni las reglas para aparentarla.
