# Validación de SmartCourier Web - 12 septiembre 2026

76 pruebas backend aprobadas; 2 recorridos Chromium aprobados; build Vite correcto.

## Courier entrenado

Modelo congelado: `courier-web-8b72b5f38fa4`. Entrenamiento 1-54. Holdout 130001-130108.

106 turnos positivos, 2 en cero, 0 pérdidas; media $501.82 netos de combustible. Sin propinas de los pedidos seleccionados: $418.44. 804 aceptaciones, ninguna con neto sin propina no positivo. Cero violaciones de seguridad, 2 retrasos, 0 diferencias de replay. Máximo p99 0.14 ms (solo fast path).

Los candidatos de umbral probados en entrenamiento no mejoraron a los originales: se conservaron los parámetros. No se disminuyó el margen de cinco minutos. Las correcciones son de costos marginales, piso de beneficio sin propina, validación y plazos. El holdout conserva las mismas decisiones del modelo anterior con esas correcciones comunes; no se atribuye una mejora de ingresos inexistente al ajuste.

## Comparador web

54 semillas nuevas (150001-150054) por tres escenarios, 162 pruebas. Las 162 producen beneficio positivo; mínimo $45.35. Media SmartCourier $421.13 frente a Baseline $252.99. SmartCourier gana por neto/hora en 152/162. Registra 189 entregas tardías frente a 190 de Baseline. Rutas estimadas deterministas; costos por km $0.40/$2.00/$4.50 para bici/moto/auto.

## Interpretación

No equivale a ganancia garantizada ni a superioridad en cada turno. Courier tiene dos turnos de auto sin ingresos; en promedio auto pierde frente a GreedyRate+Safety y bici frente a AcceptAll+Safety. El comparador también pierde algunos enfrentamientos y tiene retrasos. Courier mide neto de combustible; no todos los costos reales están incluidos. Las propinas del simulador se pagan como fueron estimadas; el escenario sin propinas mostrado solo resta las propinas de los pedidos ya elegidos.

La carpeta courier aporta protocolo y ejemplos, no un historial masivo real. La evidencia se obtiene con flujos sintéticos reproducibles, no con entregas observadas en campo.

## Archivos verificables

- `output/validation/training-refinement.json`: candidatos evaluados solo en entrenamiento.
- `output/validation/holdout-108.json`: métricas y enfrentamientos por semilla.
- `output/validation/holdout-decisions.jsonl`: decisiones del holdout.
- `output/validation/comparison-162.json`: resultados por semilla y escenario.
- `courier/results_table.csv`: reporte oficial separado, semillas 90001-90030.
- `COPY_AMENDMENTS.json`: modificaciones frente a la copia inicial.
- `README_WEB.md`: instalación, operación y pruebas.

## Resultados Courier completos

```json
{
  "model_version": "courier-web-8b72b5f38fa4",
  "seed_range": [
    130001,
    130108
  ],
  "seeds": [
    130001,
    130002,
    130003,
    130004,
    130005,
    130006,
    130007,
    130008,
    130009,
    130010,
    130011,
    130012,
    130013,
    130014,
    130015,
    130016,
    130017,
    130018,
    130019,
    130020,
    130021,
    130022,
    130023,
    130024,
    130025,
    130026,
    130027,
    130028,
    130029,
    130030,
    130031,
    130032,
    130033,
    130034,
    130035,
    130036,
    130037,
    130038,
    130039,
    130040,
    130041,
    130042,
    130043,
    130044,
    130045,
    130046,
    130047,
    130048,
    130049,
    130050,
    130051,
    130052,
    130053,
    130054,
    130055,
    130056,
    130057,
    130058,
    130059,
    130060,
    130061,
    130062,
    130063,
    130064,
    130065,
    130066,
    130067,
    130068,
    130069,
    130070,
    130071,
    130072,
    130073,
    130074,
    130075,
    130076,
    130077,
    130078,
    130079,
    130080,
    130081,
    130082,
    130083,
    130084,
    130085,
    130086,
    130087,
    130088,
    130089,
    130090,
    130091,
    130092,
    130093,
    130094,
    130095,
    130096,
    130097,
    130098,
    130099,
    130100,
    130101,
    130102,
    130103,
    130104,
    130105,
    130106,
    130107,
    130108
  ],
  "created_at": "2026-09-13T01:03:03.678Z",
  "summaries": {
    "SmartCourier": {
      "shifts": 108,
      "mean_net_mxn": 501.82,
      "min_net_mxn": 0,
      "positive_shifts": 106,
      "zero_shifts": 2,
      "negative_shifts": 0,
      "accepted": 804,
      "skipped": 1934,
      "safety_violations": 0,
      "deadline_misses": 2,
      "degraded_decisions": 0,
      "max_p99_ms": 0.14,
      "accepted_nonpositive_before_tip": 0,
      "mean_net_without_tips_mxn": 418.44,
      "min_net_without_tips_mxn": 0
    },
    "PreviousStrategy": {
      "shifts": 108,
      "mean_net_mxn": 501.82,
      "min_net_mxn": 0,
      "positive_shifts": 106,
      "zero_shifts": 2,
      "negative_shifts": 0,
      "accepted": 804,
      "skipped": 1934,
      "safety_violations": 0,
      "deadline_misses": 2,
      "degraded_decisions": 0,
      "max_p99_ms": 0.05,
      "accepted_nonpositive_before_tip": 0,
      "mean_net_without_tips_mxn": 418.44,
      "min_net_without_tips_mxn": 0
    },
    "AcceptAllSafety": {
      "shifts": 108,
      "mean_net_mxn": 477.74,
      "min_net_mxn": 81.65,
      "positive_shifts": 108,
      "zero_shifts": 0,
      "negative_shifts": 0,
      "accepted": 879,
      "skipped": 1079,
      "safety_violations": 0,
      "deadline_misses": 1,
      "degraded_decisions": 0,
      "max_p99_ms": 0.02,
      "accepted_nonpositive_before_tip": 0
    },
    "GreedyRateSafety": {
      "shifts": 108,
      "mean_net_mxn": 492.06,
      "min_net_mxn": 81.65,
      "positive_shifts": 108,
      "zero_shifts": 0,
      "negative_shifts": 0,
      "accepted": 850,
      "skipped": 1273,
      "safety_violations": 0,
      "deadline_misses": 2,
      "degraded_decisions": 0,
      "max_p99_ms": 0.03,
      "accepted_nonpositive_before_tip": 0
    }
  },
  "by_vehicle": {
    "moto": {
      "SmartCourier": {
        "shifts": 36,
        "mean_net_mxn": 651.63,
        "min_net_mxn": 233.27,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 341,
        "skipped": 676,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.13,
        "accepted_nonpositive_before_tip": 0,
        "mean_net_without_tips_mxn": 542.48,
        "min_net_without_tips_mxn": 202.37
      },
      "PreviousStrategy": {
        "shifts": 36,
        "mean_net_mxn": 651.63,
        "min_net_mxn": 233.27,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 341,
        "skipped": 676,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.04,
        "accepted_nonpositive_before_tip": 0,
        "mean_net_without_tips_mxn": 542.48,
        "min_net_without_tips_mxn": 202.37
      },
      "AcceptAllSafety": {
        "shifts": 36,
        "mean_net_mxn": 605.18,
        "min_net_mxn": 157.5,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 354,
        "skipped": 350,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.02,
        "accepted_nonpositive_before_tip": 0
      },
      "GreedyRateSafety": {
        "shifts": 36,
        "mean_net_mxn": 607,
        "min_net_mxn": 157.5,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 347,
        "skipped": 366,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.02,
        "accepted_nonpositive_before_tip": 0
      }
    },
    "car": {
      "SmartCourier": {
        "shifts": 36,
        "mean_net_mxn": 448.81,
        "min_net_mxn": 0,
        "positive_shifts": 34,
        "zero_shifts": 2,
        "negative_shifts": 0,
        "accepted": 264,
        "skipped": 1010,
        "safety_violations": 0,
        "deadline_misses": 0,
        "degraded_decisions": 0,
        "max_p99_ms": 0.1,
        "accepted_nonpositive_before_tip": 0,
        "mean_net_without_tips_mxn": 354.44,
        "min_net_without_tips_mxn": 0
      },
      "PreviousStrategy": {
        "shifts": 36,
        "mean_net_mxn": 448.81,
        "min_net_mxn": 0,
        "positive_shifts": 34,
        "zero_shifts": 2,
        "negative_shifts": 0,
        "accepted": 264,
        "skipped": 1010,
        "safety_violations": 0,
        "deadline_misses": 0,
        "degraded_decisions": 0,
        "max_p99_ms": 0.05,
        "accepted_nonpositive_before_tip": 0,
        "mean_net_without_tips_mxn": 354.44,
        "min_net_without_tips_mxn": 0
      },
      "AcceptAllSafety": {
        "shifts": 36,
        "mean_net_mxn": 412.94,
        "min_net_mxn": 88.2,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 313,
        "skipped": 503,
        "safety_violations": 0,
        "deadline_misses": 0,
        "degraded_decisions": 0,
        "max_p99_ms": 0.01,
        "accepted_nonpositive_before_tip": 0
      },
      "GreedyRateSafety": {
        "shifts": 36,
        "mean_net_mxn": 464.38,
        "min_net_mxn": 88.2,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 296,
        "skipped": 655,
        "safety_violations": 0,
        "deadline_misses": 0,
        "degraded_decisions": 0,
        "max_p99_ms": 0.03,
        "accepted_nonpositive_before_tip": 0
      }
    },
    "bike": {
      "SmartCourier": {
        "shifts": 36,
        "mean_net_mxn": 405.03,
        "min_net_mxn": 42.2,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 199,
        "skipped": 248,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.14,
        "accepted_nonpositive_before_tip": 0,
        "mean_net_without_tips_mxn": 358.4,
        "min_net_without_tips_mxn": 33.02
      },
      "PreviousStrategy": {
        "shifts": 36,
        "mean_net_mxn": 405.03,
        "min_net_mxn": 42.2,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 199,
        "skipped": 248,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.04,
        "accepted_nonpositive_before_tip": 0,
        "mean_net_without_tips_mxn": 358.4,
        "min_net_without_tips_mxn": 33.02
      },
      "AcceptAllSafety": {
        "shifts": 36,
        "mean_net_mxn": 415.09,
        "min_net_mxn": 81.65,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 212,
        "skipped": 226,
        "safety_violations": 0,
        "deadline_misses": 0,
        "degraded_decisions": 0,
        "max_p99_ms": 0.01,
        "accepted_nonpositive_before_tip": 0
      },
      "GreedyRateSafety": {
        "shifts": 36,
        "mean_net_mxn": 404.81,
        "min_net_mxn": 81.65,
        "positive_shifts": 36,
        "zero_shifts": 0,
        "negative_shifts": 0,
        "accepted": 207,
        "skipped": 252,
        "safety_violations": 0,
        "deadline_misses": 1,
        "degraded_decisions": 0,
        "max_p99_ms": 0.01,
        "accepted_nonpositive_before_tip": 0
      }
    }
  },
  "paired": {
    "PreviousStrategy": {
      "wins": 0,
      "ties": 108,
      "losses": 0
    },
    "AcceptAllSafety": {
      "wins": 45,
      "ties": 27,
      "losses": 36
    },
    "GreedyRateSafety": {
      "wins": 50,
      "ties": 22,
      "losses": 36
    }
  },
  "replay_mismatches": 0,
  "limits": "Simulación sintética Courier: neto de combustible. No incluye desgaste, impuestos ni cambios reales en pago. Propinas simuladas; escenario sin propinas calculado por separado. Resultados de prueba, no garantía."
}
```
