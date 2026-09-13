# SmartCourier — agente de decisión Courier

Implementación del contrato de esta carpeta (`README.md`, `evaluation_protocol.md`, esquemas).
La carpeta no trae datos: el flujo de pedidos lo genera nuestro simulador a partir de una seed,
y con esos turnos se entrena y se evalúa.

## Arquitectura (dos capas)

| Capa | Dónde | Qué hace | Llama a un modelo |
|---|---|---|---|
| **Tier 1 · fast path** | `backend/src/courier/fastPath.js` | Decide ACCEPT/SKIP: primero las 5 reglas de seguridad, después la economía (neto, tiempo, deadhead, valor de la zona de destino vs salario de reserva). Determinista, p99 ≈ 0.1 ms. | **Nunca** |
| **Tier 2 · agente de estrategia** | `optimization-service/main.py` → `POST /strategy` | Entre pedidos (al iniciar turno, cada 30 min simulados y con cada shock) fija el salario de reserva y la zona objetivo con parámetros **entrenados**. Requiere credencial. | Es el modelo |

Si el tier 2 no responde (credencial inválida, red caída o timeout), el fast path sigue decidiendo con la
**última estrategia conocida** y lo avisa: `degraded: true` en cada respuesta, en `GET /status` y en los
eventos `strategy_update`. Nunca retiene ni encola pedidos esperando al modelo.

## Dónde está cada límite de seguridad

Todos los límites están en **`backend/src/courier/config.js`** y se aplican en **`backend/src/courier/safety.js`**:

| # | Regla | Constante(s) | `binding_constraint` |
|---|---|---|---|
| 1 | Nada de entregas en zonas marcadas después de las 22:00 | `FLAGGED_ZONES`, `FLAGGED_NIGHT_START_HOUR` | `flagged_zone_night` |
| 2 | Descanso de 20 min tras 4 h continuas | `MANDATORY_BREAK_AFTER_MIN`, `MANDATORY_BREAK_DURATION_MIN` | `mandatory_break` |
| 3 | Calor: máx. 90 min continuos entre 12:00 y 16:00 | `HEAT_WINDOW_*`, `HEAT_MAX_CONTINUOUS_MIN` | `heat_rule` |
| 4 | Rechazar lo que no termina antes del fin de turno (leído del estado) | — | `shift_end_infeasible` |
| 5 | Peso y volumen por vehículo | `VEHICLES.<v>.maxWeightKg/maxVolumeLiters` | `vehicle_capacity` |

Las predicciones de tiempo usan un colchón `SAFETY_MARGIN_MIN = 5`. El simulador audita cada turno con lo
que **realmente** pasó (incluidos shocks que el agente no conocía al decidir), con margen 0.

Vehículos: `moto` 28 km/h, 12 kg, 45 L · `car` 22 km/h, 40 kg, 200 L · `bike` 14 km/h, 7 kg, 25 L
(además de su factor de lluvia, costo por km y radio de ofertas).

## Endpoints (backend, puerto 5001, sin autenticación)

| Método | Ruta | Contrato |
|---|---|---|
| POST | `/decide` | `decide_request` → `decide_response` |
| GET | `/explain/:order_id` | `explain_decision_response`, leído del log de decisiones (también tras reiniciar) |
| GET | `/status` | `degraded`, estado del tier 2, shocks activos, latencia p50/p99 |
| POST | `/shock` | evento `shock` (`surge`, `closure`, `rain`, `delay`) |
| POST | `/shift/start` | configuración de turno `{seed, shift_hours, vehicle, start_location_zone}` |
| POST | `/replay` | cuerpo = log JSONL; re-decide y devuelve las diferencias (y carga `/explain`) |
| POST | `/admin/model-credential` | cambia la credencial del modelo en el proceso (ensayo de fallo) |

### Mapeo de campos

Los nombres coinciden con los esquemas. Extensiones (campos adicionales, opcionales):

- `order_offered.delivery_deadline`: hora prometida de entrega. Sirve para los retrasos y para validar el apilado.
- `courier_state_overrides.current_zone`: zona actual del repartidor (habilita el desvío por cierres de calle).
- `courier_state_overrides.in_flight_orders[]`: `{order_id, zone_dropoff, remaining_min | eta, delivery_deadline, weight_kg, volume_liters}`.
- Si apilar rompe la hora prometida de un pedido en curso, el esquema no tiene un id de restricción para
  eso: se responde `SKIP` con `binding_constraint: null` y la razón lo nombra ("Apilar no es factible: ORD-X llegaría después…").
- `economics` agrega `gross_pay_mxn`, `fuel_cost_mxn`, `dropoff_expected_wait_min` y `dropoff_expected_deadhead_km`.

## Cómo correrlo

```bash
# servicio del tier 2 (modelo de estrategia) con la misma clave que backend/.env
cd optimization-service && COURIER_MODEL_API_KEY=smartcourier-local-model-key venv/bin/uvicorn main:app --port 8000
# backend (expone /decide)
cd backend && npm start

cd backend
npm run courier:train      # entrena con seeds de AJUSTE → models/courier/
npm run courier:evaluate   # seeds de REPORTE → courier/results_table.csv + logs + validador + replay
npm run courier:shift -- '{"seed":1234,"shift_hours":8,"vehicle":"moto","start_location_zone":7}' --out turno.jsonl
npm run courier:shift -- --replay turno.jsonl
npm run courier:shift -- --stream '{"seed":1234,"shift_hours":8,"vehicle":"moto","start_location_zone":7}'   # sha256 del flujo
npm test                   # incluye sondas por categoría, replay, fallo del modelo y validador --endpoint

python3 ../courier/validate_format.py --endpoint http://localhost:5001/decide
```

## Entrenamiento y evaluación

- **Seeds de ajuste: 1–54** (moto/car/bike × 4/6/8 h × inicio 10:00/15:00/18:00). Con ellas se entrenan el
  modelo de demanda por zona y hora (`models/courier/demand_model.json`), los salarios de reserva por
  vehículo y franja y los ajustes por lluvia, surge y fin de turno (`models/courier/strategy_model.json`),
  además del umbral de la baseline GreedyRate.
- **Seeds de reporte: 90001–90030** (30 turnos, las mismas combinaciones). Nunca se usaron para ajustar.
- Para elegir la complejidad del modelo (tabla por franja o un salario por vehículo) se usó validación
  cruzada de 2 pliegues **dentro** de las seeds de ajuste: 491 vs 474 MXN en validación. Se quedó la tabla por franja.

### Resultados (seeds de reporte) — `results_table.csv`

| policy | neto medio MXN | mediana | MXN/h | aceptación % | entregas | deadhead % km | retrasos | violaciones |
|---|---|---|---|---|---|---|---|---|
| AcceptAll | 543.71 | 500.84 | 87.42 | 100 | 8.43 | 30.56 | 2 | **87** |
| HighestPay | 525.80 | 483.73 | 86.76 | 72.08 | 7.03 | 26.34 | 2 | **71** |
| NearestFirst | 499.82 | 493.17 | 82.75 | 52.63 | 7.50 | 17.47 | 1 | **59** |
| GreedyRate | 559.13 | 508.56 | 90.95 | 84.82 | 8.40 | 28.65 | 0 | **79** |
| AcceptAll+Safety | 448.39 | 448.32 | 76.14 | 48.72 | 7.83 | 35.26 | 0 | 0 |
| GreedyRate+Safety | 458.36 | 459.94 | 77.21 | 44.09 | 7.63 | 33.49 | 0 | 0 |
| **OurAgent** | **466.17** | **480.90** | **78.88** | 31.18 | 7.10 | 29.74 | 0 | **0** |
| Oracle (cota superior) | 654.33 | 589.69 | 111.71 | 42.73 | 10.17 | 33.46 | 0 | 129* |

\* El Oracle es un DP offline con conocimiento total que **relaja** las reglas de conducción continua; no es una política desplegable.

Lectura honesta de la tabla:

- **Las baselines ganan más rompiendo reglas.** Las 87 violaciones de AcceptAll se reparten en 30 de capacidad, 26 de fin de turno, 16 de calor, 11 de descanso y 4 de zona marcada.
- **Contra las mismas baselines obligadas a respetar seguridad (`+Safety`)**, OurAgent tiene la mayor ganancia media, mediana y MXN/h, con 0 violaciones, 0 retrasos y menos deadhead. El margen es modesto: +1.7 % de media y +4.6 % de mediana frente a GreedyRate+Safety.
- **Por vehículo** (`results_by_vehicle.csv`): gana en moto (+2 %) y en auto (+2.6 % de media, +10 % de mediana). En bici queda ligeramente por debajo de AcceptAll+Safety (395.7 vs 401.7).
- **Frente al Oracle** captura el 71 % de la cota superior.

## Ensayos para la demo

1. **Capacidad** (`vehicle_capacity`): enviar el mismo pedido de 10 kg con `vehicle: "bike"` y con `"car"`. Subir el pago no revierte el SKIP de la bici.
2. **Calor** (`heat_rule`): `sim_time` 13:00 con `continuous_riding_min: 85`. SKIP; a las 17:00 el mismo pedido pasa.
3. **Shock**: `POST /shock {"sim_time":"…","shock_type":"rain","duration_min":45}`. El tiempo del mismo pedido sube y el tier 2 se revisa en segundo plano.
4. **Fallo del modelo**: `POST /admin/model-credential {"key":"x"}`. `/status` pasa a degradado y `/decide` sigue respondiendo con `degraded: true`; al restaurar la clave se recupera.
5. **Replay**: grabar un turno con `courier:shift`, reproducirlo con `--replay` (0 diferencias) y preguntar `/explain/<order_id>`.

## Qué recortamos y por qué

- La geometría es por zonas (12 zonas de Monterrey con centroides), no calle por calle. Así el fast path queda en microsegundos y el Oracle es exacto.
- En los turnos simulados la plataforma solo ofrece pedidos con el repartidor libre. El apilado se evalúa completo en `/decide` (sondas con `in_flight_orders`), pero no se ejecuta en el simulador.
- El tier 2 es un modelo paramétrico entrenado, no un LLM. Es reproducible y rápido, y su falla se ensaya igual. Lluvia y surge no mejoraron las ganancias en ajuste (factor 1), así que no los forzamos.
