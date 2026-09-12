"""
Microservicio de optimización (sección 11 y 52 del prompt).

Responsabilidad limitada a propósito: solo geometría (encontrar el mejor
orden de paradas). Sin autenticación, sin lógica de negocio, sin acceso a
la base de datos — Node.js sigue siendo el backend principal.

Limitación documentada: las distancias se calculan con haversine x factor
de calle (STREET_FACTOR, igual que routing.service.js en el backend), no
llamando a OSRM por cada par de puntos — hacerlo sería demasiado tráfico de
red para el tamaño de este proyecto. Es una aproximación consistente, no
la distancia real de calles.
"""

import math
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from pydantic import BaseModel

app = FastAPI(title="SmartCourier AI - Optimization Service")

STREET_FACTOR = 1.3  # debe coincidir con backend/src/services/routing.service.js


class Point(BaseModel):
    lat: float
    lng: float


class Stop(BaseModel):
    id: str
    type: str  # "pickup" | "dropoff"
    order_id: str
    lat: float
    lng: float


class OptimizeBatchRequest(BaseModel):
    start: Point
    stops: List[Stop]


class OptimizeBatchResponse(BaseModel):
    order: List[str]
    total_distance_km: float


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return radius_km * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_distance_matrix_meters(points) -> List[List[int]]:
    n = len(points)
    matrix = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            km = haversine_km(points[i].lat, points[i].lng, points[j].lat, points[j].lng) * STREET_FACTOR
            matrix[i][j] = int(km * 1000)
    return matrix


@app.get("/health")
def health():
    return {"status": "OK"}


@app.post("/optimize-batch", response_model=OptimizeBatchResponse)
def optimize_batch(req: OptimizeBatchRequest):
    if not req.stops:
        raise HTTPException(status_code=400, detail="Se requiere al menos una parada")

    points = [req.start] + req.stops
    n = len(points)

    distance_matrix = build_distance_matrix_meters(points)

    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        return distance_matrix[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    routing.AddDimension(transit_callback_index, 0, 3_000_000, True, "Distance")
    distance_dimension = routing.GetDimensionOrDie("Distance")

    # Restricción: cada recolección debe visitarse antes que su propia
    # entrega. Una entrega sin recolección correspondiente en esta lista
    # (el pedido activo, ya recolectado antes de este cálculo) queda como
    # una parada libre, sin restricción de precedencia.
    for i, stop in enumerate(req.stops, start=1):
        if stop.type != "pickup":
            continue
        dropoff_position = next(
            (j for j, other in enumerate(req.stops, start=1) if other.type == "dropoff" and other.order_id == stop.order_id),
            None,
        )
        if dropoff_position is None:
            continue

        pickup_index = manager.NodeToIndex(i)
        delivery_index = manager.NodeToIndex(dropoff_position)
        routing.AddPickupAndDelivery(pickup_index, delivery_index)
        routing.solver().Add(routing.VehicleVar(pickup_index) == routing.VehicleVar(delivery_index))
        routing.solver().Add(
            distance_dimension.CumulVar(pickup_index) <= distance_dimension.CumulVar(delivery_index)
        )

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC

    solution = routing.SolveWithParameters(search_parameters)

    if not solution:
        raise HTTPException(status_code=422, detail="No se encontró una ruta factible")

    order_sequence: List[str] = []
    total_distance_meters = 0
    index = routing.Start(0)
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != 0:
            order_sequence.append(points[node].id)
        next_index = solution.Value(routing.NextVar(index))
        total_distance_meters += routing.GetArcCostForVehicle(index, next_index, 0)
        index = next_index

    return OptimizeBatchResponse(order=order_sequence, total_distance_km=total_distance_meters / 1000)
