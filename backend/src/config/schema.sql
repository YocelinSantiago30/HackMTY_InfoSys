-- SmartCourier AI — esquema PostgreSQL (FASE 2)
-- Estrategia de IDs: UUID en todas las tablas (gen_random_uuid()), para que
-- el backend Node y el optimization-service Python puedan generar
-- referencias sin depender de un orden de inserción compartido.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==================================================
-- USERS
-- ==================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  vehicle_type TEXT CHECK (vehicle_type IN ('bike', 'motorcycle', 'car')),

  bag_height NUMERIC,
  bag_width NUMERIC,
  bag_depth NUMERIC,
  bag_max_weight NUMERIC,
  bag_capacity NUMERIC,

  work_zone_center_lat NUMERIC,
  work_zone_center_lng NUMERIC,
  work_zone_radius_km NUMERIC,
  preferred_zones JSONB NOT NULL DEFAULT '[]',
  avoided_zones JSONB NOT NULL DEFAULT '[]',

  shift_start_time TIME,
  shift_end_time TIME,

  minimum_payment NUMERIC,
  minimum_payment_per_minute NUMERIC,
  minimum_payment_per_km NUMERIC,
  maximum_distance_km NUMERIC,

  avoid_configured_zones BOOLEAN NOT NULL DEFAULT true,
  night_distance_limit_km NUMERIC,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==================================================
-- SHIFTS (turno real de un repartidor, distinto de una simulación)
-- ==================================================

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ENDED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==================================================
-- SIMULATION SESSIONS
-- ==================================================

CREATE TABLE IF NOT EXISTS simulation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  seed BIGINT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('DEMO', 'FRESH', 'CUSTOM')),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'RUNNING', 'PAUSED', 'FINISHED', 'CANCELLED')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  simulation_duration_seconds INTEGER,
  current_simulation_second INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'SURGE_STARTED', 'SURGE_ENDED',
    'TRAFFIC_INCREASED', 'TRAFFIC_DECREASED',
    'ROAD_CLOSED', 'ROAD_REOPENED',
    'ORDER_CANCELLED',
    'HIGH_DEMAND', 'LOW_DEMAND',
    'URGENT_ORDER'
  )),
  payload JSONB NOT NULL DEFAULT '{}',
  occurred_at_simulation_second INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==================================================
-- ORDERS
-- ==================================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  external_order_number INTEGER NOT NULL,

  merchant_name TEXT NOT NULL,
  pickup_lat NUMERIC NOT NULL,
  pickup_lng NUMERIC NOT NULL,
  dropoff_lat NUMERIC NOT NULL,
  dropoff_lng NUMERIC NOT NULL,

  base_payment NUMERIC NOT NULL,
  surge_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  final_payment NUMERIC NOT NULL,

  distance_km NUMERIC,
  estimated_time_minutes NUMERIC,
  traffic_level TEXT CHECK (traffic_level IN ('LOW', 'MEDIUM', 'HIGH', 'SEVERE')),
  destination_demand TEXT CHECK (destination_demand IN ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH')),
  priority TEXT,

  package_size TEXT,
  package_weight NUMERIC,
  estimated_preparation_minutes NUMERIC,
  expiration_seconds INTEGER,

  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'EXPIRED'
  )),

  created_at_simulation_second INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (simulation_id, external_order_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_simulation_id ON orders(simulation_id);

-- Añadido en FASE 13 para que SmartCourier pueda penalizar ROUTE_RISK
-- cuando OSRM falló y se usó el fallback estimado (sección 15).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS route_source TEXT CHECK (route_source IN ('ROUTED', 'ESTIMATED'));

-- ==================================================
-- AGENTS (catálogo estático: BASELINE / SMARTCOURIER)
-- ==================================================

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code IN ('BASELINE', 'SMARTCOURIER')),
  name TEXT NOT NULL,
  description TEXT
);

-- ==================================================
-- AGENT STATES (mundo independiente por agente y simulación)
-- ==================================================

CREATE TABLE IF NOT EXISTS agent_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  current_lat NUMERIC,
  current_lng NUMERIC,

  earnings NUMERIC NOT NULL DEFAULT 0,
  distance_km NUMERIC NOT NULL DEFAULT 0,
  active_minutes NUMERIC NOT NULL DEFAULT 0,
  idle_minutes NUMERIC NOT NULL DEFAULT 0,

  accepted_orders INTEGER NOT NULL DEFAULT 0,
  rejected_orders INTEGER NOT NULL DEFAULT 0,
  completed_orders INTEGER NOT NULL DEFAULT 0,
  cancelled_orders INTEGER NOT NULL DEFAULT 0,
  expired_orders INTEGER NOT NULL DEFAULT 0,
  batched_orders INTEGER NOT NULL DEFAULT 0,
  repositions INTEGER NOT NULL DEFAULT 0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (simulation_id, agent_id)
);

-- Añadido en FASE 21 (batching): solo lo usa SmartCourier — Baseline no
-- rastrea ocupación (sección 3 excluye explícitamente el batching de su
-- alcance). Permite saber si el agente sigue "ocupado" con un pedido
-- cuando llega uno nuevo, y con cuál, para evaluar si se pueden agrupar.
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS busy_until_simulation_second INTEGER;
ALTER TABLE agent_states ADD COLUMN IF NOT EXISTS active_order_id UUID REFERENCES orders(id);

-- ==================================================
-- AGENT DECISIONS (explicabilidad)
-- ==================================================

CREATE TABLE IF NOT EXISTS agent_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,

  decision TEXT NOT NULL CHECK (decision IN (
    'ACCEPT', 'REJECT', 'BATCH', 'WAIT', 'REPOSITION', 'REROUTE'
  )),
  score NUMERIC,

  reasons JSONB NOT NULL DEFAULT '[]',
  positive_factors JSONB NOT NULL DEFAULT '[]',
  negative_factors JSONB NOT NULL DEFAULT '[]',
  restrictions JSONB NOT NULL DEFAULT '[]',
  estimated_impact JSONB NOT NULL DEFAULT '{}',

  agent_position_lat NUMERIC,
  agent_position_lng NUMERIC,
  shift_state_snapshot JSONB NOT NULL DEFAULT '{}',

  decided_at_simulation_second INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_simulation_id ON agent_decisions(simulation_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_order_id ON agent_decisions(order_id);

-- Añadido en FASE 23: REPOSITION (y WAIT en estado ocioso) no tienen un
-- pedido asociado — son decisiones proactivas del agente, no reacciones a
-- una oferta.
ALTER TABLE agent_decisions ALTER COLUMN order_id DROP NOT NULL;

-- ==================================================
-- ROUTES (resultado de OSRM o su fallback)
-- ==================================================

CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,

  origin_lat NUMERIC NOT NULL,
  origin_lng NUMERIC NOT NULL,
  destination_lat NUMERIC NOT NULL,
  destination_lng NUMERIC NOT NULL,

  distance_km NUMERIC NOT NULL,
  duration_minutes NUMERIC NOT NULL,
  geometry JSONB,

  source TEXT NOT NULL CHECK (source IN ('ROUTED', 'ESTIMATED')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routes_simulation_id ON routes(simulation_id);

-- ==================================================
-- ORDER ASSIGNMENTS (aceptación y batching)
-- ==================================================

CREATE TABLE IF NOT EXISTS order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  batch_group_id UUID,

  original_route_distance_km NUMERIC,
  batched_route_distance_km NUMERIC,
  additional_distance_km NUMERIC,
  additional_time_minutes NUMERIC,
  additional_revenue NUMERIC,

  assigned_at_simulation_second INTEGER NOT NULL,
  completed_at_simulation_second INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (order_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_order_assignments_batch_group_id ON order_assignments(batch_group_id);

-- ==================================================
-- AGENT METRICS (snapshot agregado por simulación + agente)
-- ==================================================

CREATE TABLE IF NOT EXISTS agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  total_earnings NUMERIC NOT NULL DEFAULT 0,
  accepted_orders INTEGER NOT NULL DEFAULT 0,
  rejected_orders INTEGER NOT NULL DEFAULT 0,
  completed_orders INTEGER NOT NULL DEFAULT 0,
  cancelled_orders INTEGER NOT NULL DEFAULT 0,
  expired_orders INTEGER NOT NULL DEFAULT 0,

  distance_km NUMERIC NOT NULL DEFAULT 0,
  active_minutes NUMERIC NOT NULL DEFAULT 0,
  idle_minutes NUMERIC NOT NULL DEFAULT 0,
  total_minutes NUMERIC NOT NULL DEFAULT 0,

  earnings_per_minute NUMERIC,
  earnings_per_active_minute NUMERIC,
  earnings_per_km NUMERIC,
  average_order_payment NUMERIC,
  acceptance_rate NUMERIC,
  completion_rate NUMERIC,
  average_delivery_time_minutes NUMERIC,

  batched_orders INTEGER NOT NULL DEFAULT 0,
  repositions INTEGER NOT NULL DEFAULT 0,
  efficiency_score NUMERIC,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (simulation_id, agent_id)
);
