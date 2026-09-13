# SmartCourier AI — Documentación completa del proyecto

> Documento de referencia para entender **todo** lo que hace el proyecto y para **migrarlo a una aplicación 100 % web** conservando exactamente el mismo comportamiento. Todo lo descrito aquí refleja el código actual del repositorio.

---

## Índice

1. [Qué es SmartCourier AI](#1-qué-es-smartcourier-ai)
2. [Arquitectura general](#2-arquitectura-general)
3. [Cómo ejecutarlo hoy](#3-cómo-ejecutarlo-hoy)
4. [Variables de entorno](#4-variables-de-entorno)
5. [Base de datos (PostgreSQL)](#5-base-de-datos-postgresql)
6. [Backend: API REST](#6-backend-api-rest)
7. [Backend: eventos en tiempo real (Socket.IO)](#7-backend-eventos-en-tiempo-real-socketio)
8. [Módulo 1 · Simulador comparativo (Baseline vs SmartCourier)](#8-módulo-1--simulador-comparativo-baseline-vs-smartcourier)
9. [Módulo 2 · Agente Courier (contrato de los jueces)](#9-módulo-2--agente-courier-contrato-de-los-jueces)
10. [Servicio Python (optimization-service)](#10-servicio-python-optimization-service)
11. [Frontend actual (Expo / React Native)](#11-frontend-actual-expo--react-native)
12. [Resultados y por qué el agente Courier "rechaza pedidos"](#12-resultados-y-por-qué-el-agente-courier-rechaza-pedidos)
13. [Pruebas y scripts](#13-pruebas-y-scripts)
14. [Guía de migración a 100 % web](#14-guía-de-migración-a-100--web)
15. [Checklist de paridad (para validar la versión web)](#15-checklist-de-paridad-para-validar-la-versión-web)
16. [Mapa de archivos](#16-mapa-de-archivos)

---

## 1. Qué es SmartCourier AI

Un sistema que ayuda a un repartidor (Rappi/DiDi/Uber) a decidir **qué pedidos aceptar** para ganar más, sin romper reglas de seguridad. El repositorio contiene **dos módulos** que conviven en el mismo backend:

| Módulo | Para qué sirve | Quién lo usa |
|---|---|---|
| **1. Simulador comparativo** | Corre un turno simulado en Monterrey donde **dos agentes** (Baseline y SmartCourier) reciben **exactamente los mismos pedidos** y compiten. Se ve en vivo: ganancias, mapa con rutas, decisiones explicadas, eventos (tráfico, cierres, surge), velocidad 1x–10x. | La app (pantallas Comparación, Mapa, Historial, Ajustes) |
| **2. Agente Courier** | Implementa el reglamento de la carpeta `courier/`: un endpoint `/decide` que responde ACCEPT/SKIP en <50 ms con 5 reglas de seguridad, capa de estrategia con modelo entrenado, replay determinista, modo degradado y tabla de resultados contra baselines. | Los jueces (endpoints HTTP, sin app) |

Ambos comparten la idea central: **no basta con mirar el pago**. Hay que considerar km vacíos hasta el pickup, tiempo de espera del restaurante, costo del vehículo, dónde termina la entrega y reglas de seguridad.

---

## 2. Arquitectura general

```
┌───────────────────────────┐        REST (axios) + Socket.IO
│  Frontend (Expo / RN)     │ ─────────────────────────────────┐
│  Login, Registro,         │                                  │
│  Comparación, Mapa,       │                                  ▼
│  Historial, Ajustes       │                    ┌─────────────────────────────┐
└───────────────────────────┘                    │ Backend Node.js (Express)   │
                                                 │ puerto 5001                 │
   Jueces / curl ───── POST /decide ───────────▶ │ • API REST /api/...         │
                                                 │ • Socket.IO (salas por sim) │
                                                 │ • SimulationEngine/Core     │
                                                 │ • Agente Courier (tier 1)   │
                                                 └───────┬─────────┬───────────┘
                                                         │         │ HTTP (entre pedidos)
                                           PostgreSQL ◀──┘         ▼
                                           (puerto 5432)   ┌─────────────────────────────┐
                                                           │ optimization-service (Python│
                                           OSRM público ◀──│ FastAPI, puerto 8000)       │
                                           (rutas reales)  │ • /optimize-batch (OR-Tools)│
                                                           │ • /strategy (tier 2 Courier)│
                                                           └─────────────────────────────┘
```

- **Backend** (`backend/`): Node.js + Express 5 + Socket.IO + `pg`. Toda la lógica de negocio vive aquí.
- **Frontend** (`frontend/`): Expo SDK 57, React Native 0.86, React 19. Ya incluye `react-native-web` y compila para web.
- **Python** (`optimization-service/`): FastAPI + OR-Tools. Optimización de batch y el agente de estrategia del módulo Courier.
- **Modelos entrenados** (`models/courier/`): JSON generados por el entrenamiento.
- **OSRM**: `https://router.project-osrm.org` para rutas reales (distancia, duración y geometría).

> **Para migrar a web: el backend, la base de datos, el servicio Python y los modelos NO cambian.** Solo se reemplaza el frontend (sección 14).

---

## 3. Cómo ejecutarlo hoy

Requisitos: Node 20+, PostgreSQL 14+, Python 3.12 (venv ya incluido en `optimization-service/venv`).

```bash
# 1) Base de datos
cd backend
npm install
npm run migrate        # aplica src/config/schema.sql (idempotente)
npm run seed           # inserta los agentes BASELINE y SMARTCOURIER

# 2) Servicio Python (misma clave que COURIER_MODEL_API_KEY en backend/.env)
cd ../optimization-service
COURIER_MODEL_API_KEY=smartcourier-local-model-key venv/bin/uvicorn main:app --port 8000

# 3) Backend
cd ../backend
npm start              # http://localhost:5001

# 4) Frontend
cd ../frontend
npm install
npx expo start         # QR para Expo Go, o "w" para web (http://localhost:8081)
```

---

## 4. Variables de entorno

`backend/.env` (ver `backend/.env.example`):

| Variable | Uso |
|---|---|
| `PORT` | Puerto del backend (5001) |
| `DATABASE_URL` | `postgresql://usuario@localhost:5432/smartcourier` |
| `JWT_SECRET` | Firma de los tokens de sesión (7 días) |
| `OSRM_BASE_URL` | `https://router.project-osrm.org`; si está vacío se usa el estimador |
| `OPTIMIZATION_SERVICE_URL` | `http://localhost:8000` (OR-Tools) |
| `COURIER_MODEL_URL` | `http://localhost:8000` (agente de estrategia, tier 2) |
| `COURIER_MODEL_API_KEY` | Credencial del tier 2; debe coincidir con la del proceso Python |
| `COURIER_DECISION_LOG` | (opcional) ruta del log de decisiones del agente Courier |
| `LLM_PROVIDER`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL` | Reservadas, sin uso actual |

Frontend:

| Variable | Uso |
|---|---|
| `EXPO_PUBLIC_API_URL` | (opcional) URL fija del backend. Si no está, en desarrollo se usa la IP del servidor de Expo y en web `http://localhost:5001` (`frontend/src/constants/config.js`) |

---

## 5. Base de datos (PostgreSQL)

Esquema completo en `backend/src/config/schema.sql`. Todas las tablas usan UUID. **Postgres devuelve `NUMERIC` como texto** en Node: siempre convertir con `Number()` antes de sumar (fue un bug real del proyecto).

| Tabla | Contenido |
|---|---|
| `users` | nombre, email único, hash bcrypt |
| `user_preferences` | vehículo (`bike`/`motorcycle`/`car`), mochila (medidas y peso), zona de trabajo (centro + radio), zonas preferidas/evitadas, horario, pago mínimo, pago/min, pago/km, distancia máxima, límite nocturno |
| `shifts` | turnos reales (reservado) |
| `simulation_sessions` | seed, modo (`DEMO`/`FRESH`/`CUSTOM`), estado (`CREATED`/`RUNNING`/`PAUSED`/`FINISHED`/`CANCELLED`), duración (s simulados), segundo actual, `speed_multiplier` |
| `simulation_events` | eventos inyectados (surge, tráfico, cierres, demanda, cancelación, urgente) |
| `orders` | pedido publicado: comercio, pickup/dropoff (lat/lng), pago base, surge, pago final, distancia, tiempo estimado, tráfico, demanda del destino, paquete, preparación, `route_source` (`ROUTED`/`ESTIMATED`) |
| `agents` | catálogo: `BASELINE`, `SMARTCOURIER` |
| `agent_states` | contadores por agente y simulación: ingresos brutos (`earnings`), `operating_cost`, km, minutos activos, aceptados/rechazados/completados/cancelados/agrupados, posición, entregas tarde, retraso y error ETA acumulados, horas extra |
| `agent_decisions` | cada decisión con score, razones, factores positivos/negativos, restricciones, impacto estimado (economía, lookahead) y posición. Índice único por oferta (idempotencia) |
| `order_assignments` | pedido ↔ agente: grupo de batch, hora comprometida, hora de entrega, retraso, monto cobrado (una sola vez) |
| `agent_metrics` | snapshot final de métricas por agente |
| `routes` | reservado para rutas persistidas |
| `simulation_runtime` | **recuperación**: lista única de pedidos del turno + snapshot completo del motor (reloj, rutas, progreso, tráfico, RNG, contadores) |

---

## 6. Backend: API REST

Base: `http://<host>:5001`. Rutas con 🔒 requieren `Authorization: Bearer <token>`. Errores: `{ "status": "ERROR", "message": "..." }` o `{ "error": "..." }`.

### 6.1 Salud y utilidades

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/` | `{ mensaje }` |
| GET | `/api/health` | `{ status: "OK" }` |
| GET | `/api/db-health` | `{ status, agents }` |
| POST | `/api/routing/route` | body `{originLat, originLng, destinationLat, destinationLng}` (acepta strings numéricos) → `{distanceKm, durationMinutes, geometry (GeoJSON [lng,lat]), source}` |
| POST | `/api/optimization/batch` | body `{start, stops}` → orden óptimo (OR-Tools) |
| POST | `/api/evaluar-baseline` | endpoint legado de demostración |

### 6.2 Autenticación

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, email, password}` | `{user, token}` (409 si el correo existe) |
| POST | `/api/auth/login` | `{email, password}` | `{user, token}` (401 si falla) |
| GET 🔒 | `/api/auth/me` | — | `{user}` |

### 6.3 Usuario

| Método | Ruta | Body / respuesta |
|---|---|---|
| GET 🔒 | `/api/user/profile` | `{profile}` |
| PUT 🔒 | `/api/user/profile` | `{name}` → `{profile}` |
| GET 🔒 | `/api/user/preferences` | `{preferences}` (se crean vacías si no existen) |
| PUT 🔒 | `/api/user/preferences` | cualquier subconjunto de los campos de `user_preferences` → `{preferences}` |

### 6.4 Simulaciones

| Método | Ruta | Descripción |
|---|---|---|
| POST 🔒 | `/api/simulations` | `{mode: "DEMO"\|"FRESH"\|"CUSTOM", durationSeconds?, seed?}` → `{simulation}`. DEMO usa seed fija `42026` y dura 3 h simuladas |
| GET 🔒 | `/api/simulations` | lista (`limit`, `offset`) |
| GET 🔒 | `/api/simulations/:id` | `{simulation}` |
| POST 🔒 | `/api/simulations/:id/start` | genera la lista única de pedidos (con rutas OSRM), guarda el snapshot inicial y arranca |
| POST 🔒 | `/api/simulations/:id/pause` | pausa |
| POST 🔒 | `/api/simulations/:id/resume` | reanuda; si el servidor se reinició, **recupera desde el snapshot** |
| POST 🔒 | `/api/simulations/:id/stop` | termina: las entregas en curso se completan para ambos agentes |
| POST 🔒 | `/api/simulations/:id/speed` | `{speed: 1\|2\|5\|10}` |
| POST 🔒 | `/api/simulations/:id/events` | `{eventType, payload}`: `SURGE_STARTED {multiplier}`, `SURGE_ENDED`, `TRAFFIC_INCREASED {level}`, `TRAFFIC_DECREASED`, `ROAD_CLOSED`, `ROAD_REOPENED`, `HIGH_DEMAND`, `LOW_DEMAND`, `URGENT_ORDER`, `ORDER_CANCELLED` |
| GET 🔒 | `/api/simulations/:id/orders` | pedidos publicados |
| GET 🔒 | `/api/simulations/:id/comparison` | `{agents: {BASELINE, SMARTCOURIER}, comparison}` (métricas, ver 8.9) |
| GET 🔒 | `/api/orders/:orderId/decisions` | `{order, decisions[]}` para el Decision Inspector |
| GET 🔒 | `/api/history` | `?agent=&decision=&simulationId=&limit=&offset=` → `{records, hasMore}` |

Al arrancar el servidor, las simulaciones que estaban en `RUNNING` pasan a `PAUSED` (perdieron su motor en memoria) y se pueden reanudar.

### 6.5 Agente Courier (sin autenticación)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/decide` | decisión ACCEPT/SKIP (sección 9) |
| GET | `/explain/:orderId` | explicación completa desde el log |
| GET | `/status` | `degraded`, estado del tier 2, shocks activos, latencia p50/p99 |
| POST | `/shock` | `{sim_time, shock_type: surge\|closure\|rain\|delay, ...}` |
| POST | `/shift/start` | `{seed, shift_hours, vehicle: moto\|car\|bike, start_location_zone, shift_start_time?}` |
| POST | `/strategy/refresh` | fuerza revisión del tier 2 |
| POST | `/replay` | cuerpo = log JSONL; devuelve `{compared, mismatches, identical}` y carga `/explain` |
| POST | `/admin/model-credential` | `{key}` para ensayar la falla del modelo |

---

## 7. Backend: eventos en tiempo real (Socket.IO)

Conexión: `io("http://<host>:5001", { transports: ["polling", "websocket"] })`.

**Cliente → servidor**

| Evento | Payload | Nota |
|---|---|---|
| `join_simulation` | `{simulationId, token}` + callback `({status, message})` | Verifica JWT y que la simulación sea del usuario. Hay que **unirse antes de `start`** para no perder los primeros eventos, y **re-unirse al reconectar** |
| `leave_simulation` | `{simulationId}` | Al cambiar de simulación |

**Servidor → cliente** (todos incluyen `simulationId`; el cliente debe ignorar los de otra simulación). Se emiten **después** del commit en la base.

| Evento | Payload |
|---|---|
| `simulation_started` / `simulation_paused` / `simulation_resumed` / `simulation_finished` | fila de `simulation_sessions` |
| `simulation_tick` | `{second, durationSeconds, speed, trafficLevel, trafficVersion, agents: {BASELINE: {lat, lng, status}, SMARTCOURIER: {...}}}`. Estados: `IDLE`, `TO_PICKUP`, `WAITING_PICKUP`, `TO_DROPOFF`, `REPOSITIONING` |
| `new_order` | fila del pedido |
| `baseline_decision` / `smart_decision` | `{orderId, orderNumber, decision, score, reasons, positiveFactors, negativeFactors, restrictions, estimatedImpact}` |
| `route_updated` | `{agentCode, route, position}`; `route = null` cuando termina. `route = {kind, endSecond, trafficVersion, coordinates: [[lng,lat],...], stops: [{type, lat, lng, orderNumber, etaSecond}], orders: [{id, orderNumber, merchantName, finalPayment, distanceKm, estimatedTimeMinutes, routeSource, promisedSecond, etaSecond}]}` |
| `order_completed` | `{agentCode, orderId, orderNumber, second, position, promisedSecond, delaySeconds}` |
| `order_cancelled` | `{agentCode, orderId, orderNumber, second}` |
| `metrics_updated` | `{agents, comparison}` (mismo formato que `/comparison`) |
| `simulation_event` | `{eventType, payload, occurredAtSimulationSecond, effect}` |
| `simulation_speed_changed` | `{speed}` |

---

## 8. Módulo 1 · Simulador comparativo (Baseline vs SmartCourier)

Código: `backend/src/simulation/` y `backend/src/agents/`.

### 8.1 Reloj y velocidad

- El reloj es **lógico**: cada evento (pedido nuevo, llegada, entrega, cambio de tráfico) se procesa en su segundo simulado exacto.
- El motor (`SimulationEngine.js`) hace un tick cada **250 ms reales** y avanza `15 × velocidad` segundos simulados: **1x = 1 minuto simulado por segundo real**.
- DEMO = **3 horas simuladas** (12:00–15:00), que duran 3 minutos a 1x y 18 s a 10x. FRESH/CUSTOM = 8 h por defecto.
- **La velocidad no altera ningún resultado** (hay una prueba que corre con ticks de 15 s y de 150 s y compara contadores).

### 8.2 Lista única de pedidos (comparación justa)

`OrderGenerator.js` genera desde la seed **una sola lista** (`simulationOrders`) que reciben ambos agentes, en el mismo segundo y con los mismos pagos y distancias:

- Área de servicio: centro de Monterrey (25.6866, −100.3161), radio 8 km.
- Un pedido nuevo cada **2–6 minutos simulados**.
- 60 % de los pickups nacen cerca (2 km) de zonas con demanda según la hora (Centro, San Pedro, San Nicolás, Guadalupe, Cumbres, Apodaca); el resto, dispersos.
- Destino a 0.8–6 km del pickup; la demanda del destino se calcula por su ubicación y la hora.
- Pago = `distancia × tarifa ($9–14/km) + fijo ($15–25)`, multiplicado por el surge (según demanda) y por 1.3 si es urgente.
- Paquete (tamaño y peso), preparación de 5–20 min y comercio.
- Las rutas pickup→destino vienen de **OSRM**; si falla, se usa un estimador calibrado contra OSRM: factor de calle 1.38 y 45 km/h (`routing.service.js`, con caché).
- Los eventos se aplican **al publicar** el pedido, sin mover la secuencia aleatoria.

### 8.3 Física (igual para ambos agentes)

- Misma ubicación inicial (centro), mismo vehículo (preferencia del usuario) y mismos costos.
- Un repartidor ocupado **no puede tomar otro pedido** (Baseline rechaza con `AGENT_BUSY`; SmartCourier puede agrupar).
- Plan de ruta (`routePlanner.js`): repartidor → pickup (espera hasta que la comida está lista) → destino. La posición se interpola sobre la geometría real.
- **Cobro al entregar**, exactamente una vez. **Costo operativo por km recorrido** (`economics.js`):

| Vehículo | Costo/km | Tiempo | Sensibilidad al tráfico |
|---|---|---|---|
| bike | $0.40 | 16 km/h propios | 0.15 |
| motorcycle | $2.00 | OSRM × 0.85 | 0.6 |
| car | $4.50 | OSRM × 1.0 | 1.0 |

- **Tráfico global y versionado** (`trafficModel.js`): un calendario por franjas de 30 min generado desde la seed, más los eventos. Multiplicadores de auto: LOW 1.0, MEDIUM 1.15, HIGH 1.35, SEVERE 1.6. **Cada cambio re-temporiza las rutas activas de ambos agentes.** Un cierre vial multiplica distancia y tiempo × 1.6.
- **Hora comprometida**: al aceptar se promete una ETA que anticipa el tráfico de las próximas franjas. Nunca cambia. Retraso = entrega real − promesa; "tarde" = más de 1 min.
- Al cerrar el turno, las entregas en curso se completan (cobran y cuestan) y ese tiempo cuenta como horas extra.

### 8.4 Agente Baseline (`agents/baselineAgent.js`)

Estrategia simple de repartidor: acepta si cumple **todos** estos umbrales (o los de las preferencias):

| Criterio | Default |
|---|---|
| pago final ≥ mínimo | $0 |
| pago / minuto de entrega ≥ | $3 |
| pago / km de entrega ≥ | $8 |
| distancia de entrega ≤ | 15 km |

No mira el trayecto vacío hasta el pickup ni los costos.

### 8.5 Agente SmartCourier (`agents/smartCourierAgent.js`)

1. Calcula la **economía real** (`offerEconomics`): km y minutos al pickup, espera, entrega, km totales, costo operativo, ganancia neta, neto/min y neto/km.
2. **Restricciones duras** (vetan cualquier score): capacidad de mochila, límite de distancia nocturno, fuera de zona de trabajo y ganancia neta ≤ 0.
3. **smartScore 0–100**:

| Factor | Puntos | Normalización |
|---|---|---|
| PROFIT_PER_MINUTE | 35 | $0.5 → $4.0 netos/min |
| NET_PROFIT | 15 | $0 → $120 |
| PROFIT_PER_KM | 15 | $2 → $12 netos/km |
| DISTANCE_TO_PICKUP | 10 | 0 → 8 km (menos es mejor) |
| TOTAL_TIME | 10 | 15 → 60 min (menos es mejor) |
| DESTINATION_DEMAND | 15 | demanda en el destino **a la hora de llegada** (LOW 0, MEDIUM 0.4, HIGH 0.7, VERY_HIGH 1) |

4. Decisión:
   - score < 25 → **REJECT**;
   - si no, **lookahead** (`agents/lookaheadPlanner.js`): simula 6 escenarios de 45 min desde el mismo estado, con pedidos **sintéticos** (nunca los reales futuros) y tráfico pronosticado, comparando "aceptar" contra "esperar". Valor = neto dentro del horizonte − minutos extra × **$2.5/min** (costo de esperar). **ACCEPT** si la ventaja media ≥ 0; si no, **WAIT**;
   - dentro de las simulaciones se usa la política por puntaje: ACCEPT si score ≥ 40.
5. **Batching** estando ocupado (`agents/batchEvaluator.js`): máximo 2 pedidos en ruta. El orden de paradas se busca de forma exacta con **ventanas de tiempo** sobre las promesas. Solo agrupa si:
   - el desvío es ≤ 20 min y ≤ 6 km;
   - rinde ≥ $3 netos por minuto extra;
   - ningún pedido ya prometido llega más de 10 min tarde.
6. Reposicionamiento a zonas de demanda: existe, pero está **desactivado** porque medido costaba más de lo que ahorraba.

### 8.6 Eventos

| Evento | Efecto |
|---|---|
| SURGE_STARTED / ENDED | multiplicador de pago para pedidos nuevos |
| TRAFFIC_INCREASED / DECREASED | cambia el tráfico global → re-temporiza rutas activas |
| ROAD_CLOSED / REOPENED | desvío × 1.6 → re-temporiza rutas activas |
| HIGH_DEMAND / LOW_DEMAND | fuerza la demanda del destino en pedidos nuevos |
| URGENT_ORDER | publica un pedido urgente (+30 % de pago) para ambos |
| ORDER_CANCELLED | cancela el pedido más reciente aún no recogido, en **todos** los agentes que lo tengan |

### 8.7 Recuperación tras reinicio

- Cada paso del motor corre en **una transacción**: pedidos, decisiones, cobros, contadores y snapshot (`simulation_runtime`).
- Si el proceso muere a mitad de un paso, se revierte todo, y al reanudar se continúa desde el último snapshot. Verificado en vivo con `kill -9`: el resultado final es idéntico.

### 8.8 Determinismo

Todo sale de `SimulationRandomService` (mulberry32) sembrado con la seed: pedidos, tráfico, pedidos urgentes y escenarios del lookahead. Nunca se usa `Math.random` ni el reloj del sistema en decisiones.

### 8.9 Métricas (`utils/metricsCalculator.js`)

Por agente:

| Métrica | Definición |
|---|---|
| `totalEarnings` | **neto** = cobrado − costo operativo |
| `grossEarnings`, `operatingCost` | cobrado y costo por separado |
| `acceptedOrders`, `rejectedOrders`, `completedOrders`, `cancelledOrders`, `batchedOrders`, `repositions` | contadores |
| `distanceKm`, `activeMinutes`, `idleMinutes`, `totalMinutes` | tiempo y distancia |
| `earningsPerMinute`, `earningsPerActiveMinute`, `earningsPerKm`, `averageOrderPayment` | tasas |
| `acceptanceRate`, `completionRate`, `averageDeliveryTime`, `efficiencyScore` (utilización ≤ 100 %) | desempeño |
| `overtimeMinutes`, `workedMinutes`, **`netPerWorkedHour`** | neto por hora realmente trabajada |
| `lateDeliveries`, `lateRate`, `averageDelayMinutes`, `averageEtaErrorMinutes` | cumplimiento de promesas |

`comparison.totalEarnings = {baseline, smartcourier, absoluteDifference, percentageImprovement}`.

---

## 9. Módulo 2 · Agente Courier (contrato de los jueces)

Código: `backend/src/courier/`. La documentación de entrega está en `courier/AGENT_README.md`. La carpeta `courier/` **no es un dataset**: es el reglamento (formatos, protocolo y validador). Los datos se generan por seed.

### 9.1 Dos capas

- **Tier 1 · fast path** (`fastPath.js`): decide sin llamar a ningún modelo. Es determinista y su p99 ronda los 0.1 ms.
- **Tier 2 · estrategia** (Python `/strategy`, cliente `strategyClient.js`): entre pedidos fija el **salario de reserva** por vehículo y franja horaria y la zona objetivo, con parámetros entrenados.
  - Si falla, el tier 1 sigue con la última estrategia y responde `degraded: true`.

### 9.2 Mundo simulado

- 12 zonas de Monterrey (`config.js`); zonas marcadas: **3 (Independencia) y 10 (Apodaca)**.
- Flujo de pedidos por seed, idéntico byte a byte (`orderStream.js`, se verifica con sha256): 40 ofertas/h en toda la ciudad, con picos de comida y cena.
- Solo se ofrecen pedidos dentro del radio del vehículo y con el repartidor libre.
- Shocks sembrados o inyectados: surge, lluvia, cierre y retraso de restaurante.

| Vehículo | Velocidad | Peso máx. | Volumen máx. | Combustible | Radio de ofertas |
|---|---|---|---|---|---|
| moto | 28 km/h | 12 kg | 45 L | $1.2/km | 7 km |
| car | 22 km/h | 40 kg | 200 L | $2.4/km | 8 km |
| bike | 14 km/h | 7 kg | 25 L | $0/km | 4 km |

### 9.3 Las 5 reglas de seguridad (`config.js` + `safety.js`)

| Regla | Constraint |
|---|---|
| No entregar en zona marcada después de las 22:00 (hasta las 06:00) | `flagged_zone_night` |
| Descanso de 20 min tras 4 h continuas | `mandatory_break` |
| Calor: máx. 90 min continuos entre 12:00 y 16:00 | `heat_rule` |
| Rechazar lo que no termina antes del fin de turno (leído del estado) | `shift_end_infeasible` |
| Peso y volumen por vehículo (incluida la carga apilada) | `vehicle_capacity` |

Las predicciones usan un **margen de 5 min**. El pago nunca revierte una negativa de seguridad.

### 9.4 Decisión económica

```
bruto      = base × surge + propina estimada
neto       = bruto − km (vacío + entrega) × combustible/km
tasa_cruda = neto / minutos_totales × 60
tasa_ajust = (neto − km_vacío_esperado_siguiente × combustible) / (minutos_totales + espera_esperada_en_destino) × 60
ACCEPT si round2(tasa_ajust) ≥ round2(salario_reserva)   (empate = ACCEPT)
```

La espera esperada y el km vacío siguiente por zona y hora salen del **modelo de demanda entrenado** (`models/courier/demand_model.json`).

Apilado (`trip.js`): prueba "terminar lo que lleva primero" y "recoger el nuevo primero", valida las horas prometidas y la carga combinada, y admite máximo 2 pedidos en curso.

### 9.5 Entrenamiento y evaluación

- `npm run courier:train`: seeds de **ajuste 1–54**. Entrena el modelo de demanda, los salarios de reserva por vehículo y franja (descenso coordenado con dos pasadas, consultando al servicio Python real), los ajustes por lluvia, surge y fin de turno, y el umbral de GreedyRate.
- `npm run courier:evaluate`: seeds de **reporte 90001–90030** (nunca usadas para ajustar). Compara contra AcceptAll, HighestPay, NearestFirst, GreedyRate, sus versiones `+Safety` y el Oracle (DP offline). Escribe `courier/results_table.csv`, `courier/results_by_vehicle.csv` y logs validados, y verifica el replay.

---

## 10. Servicio Python (optimization-service)

`optimization-service/main.py` (FastAPI):

| Ruta | Descripción |
|---|---|
| GET `/health` | estado |
| POST `/optimize-batch` | `{start, stops}` → orden de paradas con OR-Tools (pickup antes de su entrega) |
| POST `/strategy` | header `X-Model-Key` = `COURIER_MODEL_API_KEY`. Body `{vehicle, sim_time, shift_start_time, shift_end_time, earnings_mxn, orders_completed, current_zone, active_shocks, params?}` → `{reservation_wage_mxn_hr, target_zone, reasoning, confidence, model_version}`. Lee `models/courier/strategy_model.json` (se recarga si cambia) |

---

## 11. Frontend actual (Expo / React Native)

### 11.1 Navegación

```
App.js
└─ SafeAreaProvider
   └─ AuthProvider              (sesión)
      └─ SimulationProvider     (estado de la simulación compartido)
         └─ NavigationContainer
            └─ RootNavigator
               ├─ isLoading → spinner
               ├─ sin usuario → AuthStack:  Login · Register
               └─ con usuario → MainTabs:   Mapa · Comparación · Historial · Ajustes
```

### 11.2 Estado global

**`AuthContext`**: `user`, `token`, `isLoading`, `login(email, password)`, `register(name, email, password)`, `logout()` y `updateUserLocal()`.
- Al iniciar lee el token guardado y llama a `/api/auth/me`; siempre termina la carga.
- Token: almacenamiento seguro en móvil y `localStorage` en web (`services/secureStorage.js`).

**`SimulationContext`** (el corazón de la app): `simulation`, `isStarting`, `speed`, `clock {second, durationSeconds, trafficLevel}`, `agents` (métricas), `comparison`, `currentOrder`, `baselineDecision`, `smartDecision`, `recentEvents` (últimos 5), `couriers {BASELINE, SMARTCOURIER}` (posición y estado), `routes {BASELINE, SMARTCOURIER}`.

Acciones:
- `startDemo()`: crea la simulación DEMO → se une a la sala → la arranca → refresca métricas cada 5 s.
- `pause()`, `resume()`, `stop()`, `changeSpeed(n)` y `reset()`.

Reglas que hay que conservar:
- Quitar los listeners de la simulación anterior antes de agregar nuevos.
- Ignorar eventos cuyo `simulationId` no sea el actual.
- Mostrar una decisión solo si su `orderId` es el del pedido actual.
- Al reconectar el socket: re-unirse a la sala y volver a leer la simulación (puede estar en `PAUSED` tras un reinicio).

### 11.3 Pantallas

| Pantalla | Qué muestra y hace |
|---|---|
| **Login** | email + contraseña → `login`; errores en pantalla; enlace a Registro |
| **Register** | nombre, email, contraseña → `register` |
| **Comparación** | sin simulación: botón "Iniciar simulación DEMO" (muestra "Calculando rutas..."). Con simulación: estado, reloj del turno (desde 12:00), % del turno, nivel de tráfico, barra de progreso, **control de velocidad 1x/2x/5x/10x**, botones Pausar/Reanudar/Detener, **dos tarjetas de métricas** (neto, cobrado, costo, aceptados, rechazados, entregados, agrupados, distancia, neto/h trabajada, entregas tarde, error ETA, ganancia/km, tiempo ocioso, utilización), **pedido actual** (pago, km, min, decisión de cada agente, score y economía de SmartCourier, resumen del lookahead, detalle del batch, botón al Decision Inspector), **panel de eventos** (Surge ×2, Cierre vial, Tráfico pesado SEVERE, Pedido urgente, Demanda baja, Demanda alta) y **eventos recientes**. Al terminar: **banner de resultado** (neto, desglose, neto/h, horas extra, entregas y tarde, retraso medio, % de mejora) |
| **Mapa** | Leaflet + OpenStreetMap. Sin simulación: ubicación del dispositivo. Con simulación: marcadores **B** (gris) y **S** (azul) moviéndose; ruta de cada agente (repartidor → **P** recolección → **D** entrega; punteada si es reposicionamiento); encuadre automático a la nueva ruta de SmartCourier; al terminar un pedido se borra la ruta y el marcador queda en el destino. Panel inferior por agente: estado, pedido (#, comercio, $, km, OSRM/estimada, agrupados), **"Llega HH:MM · prometido HH:MM (+N min / a tiempo)"** |
| **Historial** | filtros por turno, agente (Todos/Baseline/SmartCourier) y decisión (Todas/Aceptado/Rechazado/Esperar); tarjetas de decisión con score y acceso al Inspector |
| **Ajustes** | editar nombre; preferencias: vehículo (Bicicleta/Motocicleta/Auto), mochila, zona de trabajo, horario HH:MM, pago mínimo, pago/min, pago/km, distancia máxima, evitar zonas, límite nocturno; cerrar sesión |

**Decision Inspector** (modal):
- Información del pedido.
- Decisión de Baseline (restricciones y criterios ✓/✗) y de SmartCourier (score, restricciones, factores y economía: km al pickup, km de entrega, tiempo total, costo, neto, neto/min, neto/km; detalle del batch con retraso contra la promesa).
- **"¿Qué habría pasado si...?"**: Baseline con su economía real; SmartCourier con "Aceptar $X (p10–p90)" contra "Esperar $Y", más la ventaja, según el lookahead.

### 11.4 Mapa (detalle técnico)

`components/mapHtml.js` genera un HTML con Leaflet 1.9.4 (desde unpkg). Protocolo:
- **Hacia el mapa**: `window.syncState({couriers, routes, user, followRoutes})` y `window.centerMap(lat, lng, zoom)`.
- **Desde el mapa**: mensajes `READY`, `ERROR`, `MAP_CLICK`. **No se sincroniza nada antes de `READY`.**
- Las coordenadas llegan en GeoJSON `[lng, lat]` y se invierten a `[lat, lng]` para Leaflet en un solo lugar.
- Mover un repartidor no redibuja la ruta; la ruta se redibuja solo si cambia su firma (tipo, `endSecond`, paradas).

Versiones: `LeafletMap.js` (móvil, `react-native-webview`) y `LeafletMap.web.js` (navegador, `iframe` + `postMessage`).

### 11.5 Estilo

`constants/theme.js`:
- **Colores de agentes**: Baseline `#616161`, SmartCourier `#1976d2`.
- **Colores de decisiones**: ACCEPT `#2e7d32`, REJECT `#c62828`, WAIT `#f9a825`, BATCH `#6a1b9a`.
- **Íconos**: Ionicons.
- **Texto**: `#212121`, `#555555`, `#757575`.
- **Tamaño táctil mínimo**: 44 px.

---

## 12. Resultados y por qué el agente Courier "rechaza pedidos"

### 12.1 Simulador comparativo (Módulo 1)

41 seeds de prueba, 3 h, moto (`backend/scripts/compareStrategies.js`):

| Escenario | Neto/h trabajada Baseline → SmartCourier | Gana en |
|---|---|---|
| Normal | $138 → $187 (**+35.5 %**) | 37/41 |
| Tráfico severo | $135 → $185 (+36.6 %) | 39/41 |
| Cierre vial | $101 → $160 (+57.7 %) | 37/41 |
| Bicicleta | $84 → $125 (+49 %) | 37/41 |
| Auto | $24 → $115 | 41/41 |

La ventaja viene de no aceptar pedidos con mucho km vacío o poca ganancia neta y de agrupar pedidos compatibles.

### 12.2 Agente Courier (Módulo 2): lo que se ve como "perder dinero"

En las 30 seeds de reporte, SmartCourier **gana menos que las baselines sin reglas** ($466 contra $544 de AcceptAll y $559 de GreedyRate) y **rechaza mucho** (acepta 213 de 789 ofertas). Medido pedido por pedido:

| Causa del SKIP | Rechazos | Qué significa |
|---|---|---|
| `shift_end_infeasible` | 144 | no alcanzaba a terminar antes del fin de turno (con margen de 5 min) |
| `heat_rule` | 95 | habría superado 90 min continuos entre 12:00 y 16:00 |
| `vehicle_capacity` | 68 | el paquete no cabía en el vehículo |
| `mandatory_break` | 39 | tocaba descanso tras 4 h |
| `flagged_zone_night` | 9 | entrega en zona marcada de noche |
| **Subtotal seguridad** | **355 (62 %)** | **obligatorios por el reglamento** |
| `reservation_wage` (pago) | 221 (38 %) | el pedido rendía menos que el salario de reserva aprendido |

- **La mayor parte del dinero "perdido" viene de reglas que no se pueden romper.** AcceptAll gana $95 más por turno que su versión segura precisamente con pedidos que violan reglas (87 violaciones en 30 turnos). El reglamento exige 0 violaciones.
- **Comparando con las mismas reglas**, SmartCourier gana más:

| Política (misma seguridad) | Neto medio |
|---|---|
| AcceptAll+Safety | $448 |
| GreedyRate+Safety | $458 |
| **SmartCourier** | **$466** |

- **Donde sí pierde por exigir demasiado**: en **bicicleta**, SmartCourier gana $396 contra $402 de AcceptAll+Safety. Ahí sus rechazos por pago cuestan dinero.
- La ventaja sobre las baselines seguras es **pequeña** (+1.7 %): el salario de reserva aprendido deja pasar poco más que "todo lo seguro y rentable".

**Mejoras posibles** (probar primero en seeds de ajuste y reportar en las de reporte):

1. Bajar el margen de seguridad de 5 a 2 min (en ajuste dio +$4 a +$7 por turno sin violaciones). Evaluar en reporte que siga con 0 violaciones.
2. Salario de reserva 0 en bici para todas las franjas; ya se aprendió 0 en 3 de 5.
3. Valorar el tiempo restante del turno: cerca del final aceptar pedidos cortos que sí caben, en lugar de esperar.
4. Si se busca ganar más que las baselines sin reglas, la única vía legítima es encontrar pedidos seguros mejor pagados: más ofertas vistas o reposicionamiento. Nunca relajar reglas.

---

## 13. Pruebas y scripts

```bash
cd backend
npm test                      # 71 pruebas: agentes, planificador, núcleo, recuperación con Postgres,
                              # sondas Courier por categoría, endpoints en vivo + validador oficial
node scripts/compareStrategies.js            # Módulo 1 en seeds de prueba
node scripts/compareStrategies.js --grid     # calibración en seeds de entrenamiento
node scripts/compareStrategies.js --promises # ETA con pronóstico vs tráfico actual
npm run courier:train
npm run courier:evaluate
npm run courier:shift -- '{"seed":1234,"shift_hours":8,"vehicle":"moto","start_location_zone":7}' --out turno.jsonl
npm run courier:shift -- --replay turno.jsonl
python3 ../courier/validate_format.py --endpoint http://localhost:5001/decide
```

---

## 14. Guía de migración a 100 % web

### 14.1 Qué NO cambia

Backend completo, base de datos, Socket.IO, servicio Python, modelos, scripts y pruebas del backend. La web consume **la misma API REST (sección 6) y los mismos eventos (sección 7)**. Toda la lógica de decisión está en el backend: **la versión web no debe recalcular nada**, solo mostrar.

### 14.2 Opción A (mínimo cambio): quedarse en Expo para web

El proyecto ya compila para web (`npx expo start --web` o `npx expo export --platform web` para publicar):
- Existe `LeafletMap.web.js` (mapa en iframe).
- La sesión se guarda en `localStorage`.
- La ubicación tiene un timeout.
- Solo falta quitar las dependencias móviles que no se usen y fijar `EXPO_PUBLIC_API_URL`.

### 14.3 Opción B (web nativa): React + Vite (recomendada si se abandona Android)

Stack sugerido: **React 19 + Vite + React Router + axios + socket.io-client + Leaflet (react-leaflet) + CSS/Tailwind**.

| Pieza actual (React Native / Expo) | Equivalente web |
|---|---|
| `View`, `Text`, `ScrollView`, `Pressable` | `div`, `span/p`, `div` con `overflow:auto`, `button` |
| `TextInput` / `LabeledInput` | `<label>` + `<input>` |
| `Switch` | `<input type="checkbox">` |
| `ActivityIndicator` | spinner CSS |
| `Alert.alert` | toast o `window.alert` / modal propio |
| `Modal` (DecisionInspectorModal) | modal/drawer con portal |
| `StyleSheet.create` | CSS modules / Tailwind (mismos colores de `theme.js`) |
| `SafeAreaView`, `useSafeAreaInsets` | innecesario (layout normal) |
| `@react-navigation/native-stack` (Login/Register) | rutas `/login`, `/register` |
| `@react-navigation/bottom-tabs` | layout con barra lateral o de navegación: `/map`, `/comparison`, `/history`, `/settings` |
| `RootNavigator` (spinner / auth / tabs) | rutas protegidas: si `isLoading` spinner, si no hay usuario redirigir a `/login` |
| `@expo/vector-icons` (Ionicons) | `react-icons/io5` (mismos nombres: `IoMap`, `IoBarChart`, `IoReceipt`, `IoSettings`...) |
| `expo-secure-store` | `localStorage` (o cookie httpOnly si se cambia el backend) |
| `expo-location` | `navigator.geolocation.getCurrentPosition` / `watchPosition` con timeout de 5 s |
| `react-native-webview` + `mapHtml.js` | **react-leaflet** directo (`MapContainer`, `TileLayer`, `Marker` con `divIcon`, `Polyline`), portando la lógica de `syncState` a componentes; o reutilizar `LeafletMap.web.js` (iframe) sin cambios |
| `expo-constants` (`hostUri`) | `import.meta.env.VITE_API_URL` |
| `expo-status-bar` | no aplica |

Archivos que se **copian casi sin cambios** (no dependen de React Native):
- `src/api/*.js` (solo cambia de dónde sale `API_BASE_URL`).
- `src/services/socket.js`.
- `src/contexts/AuthContext.js` y `src/contexts/SimulationContext.js` (quitando los imports móviles).
- `src/constants/theme.js`.
- `src/utils/shiftClock.js`.
- `src/components/mapHtml.js` (si se usa iframe).

### 14.4 Pasos sugeridos

1. Crear el proyecto (`npm create vite@latest smartcourier-web -- --template react`) e instalar `react-router-dom axios socket.io-client leaflet react-leaflet react-icons`.
2. Copiar `api/`, `services/socket.js`, `contexts/`, `constants/theme.js` y `utils/shiftClock.js`. Reemplazar `secureStorage` por `localStorage` y `API_BASE_URL` por `import.meta.env.VITE_API_URL`.
3. Recrear el layout: login/registro, luego un layout autenticado con las 4 secciones.
4. Portar pantalla por pantalla usando la sección 11.3 como especificación funcional exacta.
5. Mapa: marcadores B/S, polilínea por agente, P/D, punteado para reposicionamiento, encuadre a la nueva ruta de SmartCourier y borrado al terminar.
6. Configurar CORS: el backend ya permite cualquier origen (`cors()` y Socket.IO con `origin: "*"`). En producción conviene restringirlo al dominio web.
7. Validar con el checklist de la sección 15.

### 14.5 Detalles que se rompen fácil (ya resueltos en el código actual)

- **Unirse a la sala del socket antes de `start`** y re-unirse al reconectar.
- **Quitar los listeners anteriores** en cada simulación nueva.
- **Filtrar por `simulationId`** y por `orderId` actual.
- Todas las peticiones con **timeout** (10 s) y mensaje de error visible.
- **Coordenadas GeoJSON `[lng, lat]` → Leaflet `[lat, lng]`.**
- Los números que vienen de la base como texto (`final_payment`, `distance_km`...) se convierten con `Number()` antes de operar.
- No dibujar en el mapa antes de que esté listo.
- El reloj del turno es `12:00 + segundo simulado`.

---

## 15. Checklist de paridad (para validar la versión web)

- [ ] Registro, login, sesión persistente al recargar y logout.
- [ ] Error visible (no spinner infinito) si el backend no responde.
- [ ] "Iniciar simulación DEMO" crea, se une y arranca; aparecen pedidos en segundos.
- [ ] Reloj del turno, % de avance y nivel de tráfico se actualizan.
- [ ] Velocidad 1x/2x/5x/10x cambia el ritmo; el resultado final de la DEMO es el mismo a cualquier velocidad.
- [ ] Pausar, reanudar y detener funcionan. Tras reiniciar el backend, la simulación aparece en pausa y reanuda con las rutas.
- [ ] Las tarjetas muestran neto, cobrado, costo, contadores, neto/h trabajada, entregas tarde y error ETA.
- [ ] Pedido actual con decisión de ambos agentes, score, economía, lookahead y batch.
- [ ] Los 6 botones de eventos funcionan; tráfico y cierre re-temporizan rutas.
- [ ] Mapa: B y S se mueven; rutas P → D; al entregar se borra la ruta; ETA vs prometido.
- [ ] Historial con los 3 filtros y acceso al Inspector.
- [ ] Decision Inspector con el "¿qué habría pasado si...?".
- [ ] Ajustes guarda perfil y preferencias (el vehículo cambia costos y velocidad en la siguiente simulación).
- [ ] Banner de resultado al terminar.
- [ ] (Courier) `python3 courier/validate_format.py --endpoint http://<host>:5001/decide` → PASS.

---

## 16. Mapa de archivos

```
HackMTY_InfoSys/
├── PROYECTO_SMARTCOURIER.md          ← este documento
├── backend/
│   ├── src/
│   │   ├── server.js, app.js         Express + Socket.IO; marca simulaciones interrumpidas
│   │   ├── config/                   database.js, schema.sql, migrate.js, seed.js
│   │   ├── routes/ controllers/      API REST (sección 6)
│   │   ├── middlewares/              auth JWT, errores, 404
│   │   ├── socket/                   index.js (salas), socketBus.js
│   │   ├── services/                 auth, user, simulation, metrics, history, order, event,
│   │   │                             routing (OSRM + caché + estimador), optimization,
│   │   │                             simulationPersistence (escrituras idempotentes)
│   │   ├── simulation/               SimulationEngine (reloj real, transacciones, sockets)
│   │   │                             SimulationCore (física, decisiones, snapshot)
│   │   │                             OrderGenerator, routePlanner, trafficModel, economics,
│   │   │                             zones, simulatedTime, SimulationRandomService
│   │   ├── agents/                   baselineAgent, smartCourierAgent, lookaheadPlanner,
│   │   │                             batchEvaluator, repositionEvaluator
│   │   ├── courier/                  Módulo 2: config (límites), safety, fastPath, trip,
│   │   │                             orderStream, world, demandModel, strategyClient,
│   │   │                             simulator, baselines, oracle, replay, seedSets,
│   │   │                             courierService
│   │   └── utils/                    metricsCalculator, geo, logger, httpError, asyncHandler
│   ├── scripts/                      compareStrategies.js, courier/{train,evaluate,runShift,modelService}.js
│   └── test/                         71 pruebas (node --test)
├── frontend/
│   ├── App.js, index.js, app.json
│   └── src/
│       ├── api/                      client (timeout), auth, user, simulation, history, order
│       ├── contexts/                 AuthContext, SimulationContext
│       ├── navigation/               RootNavigator, AuthStack, MainTabs
│       ├── screens/                  Login, Register, Comparison, Map, History, Settings
│       ├── components/               AgentMetricsCard, CurrentOrderCard, DecisionInspectorModal,
│       │                             DemoResultBanner, InjectEventPanel, SpeedControl,
│       │                             LeafletMap(.web).js, mapHtml, decisionDisplay, LabeledInput
│       ├── services/                 socket.js, secureStorage.js
│       ├── constants/                config.js (URL del backend), theme.js
│       └── utils/                    shiftClock.js
├── optimization-service/             main.py (OR-Tools + /strategy), venv
├── models/courier/                   demand_model.json, strategy_model.json, training_report.json
└── courier/                          reglamento de los jueces + AGENT_README.md + resultados y logs
```
