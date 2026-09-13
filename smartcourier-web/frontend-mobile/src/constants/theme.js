// Paleta semántica única (sección 56): agentes por color fijo, decisiones
// por color fijo, para que todas las pantallas se vean consistentes en vez
// de repetir hex sueltos. Los tonos de texto están elegidos para pasar
// contraste WCAG AA (4.5:1) sobre fondo blanco — #888/#999 (usados antes en
// 14 lugares) no lo pasaban.

export const AGENT_COLORS = {
  BASELINE: "#616161", // GRIS (sección 56)
  SMARTCOURIER: "#1976d2", // AZUL (sección 56)
};

// Nombres de Ionicons (@expo/vector-icons) — se usan con <Ionicons name={...} />,
// no como emoji, para un look consistente entre iOS/Android (sección 56).
export const AGENT_ICONS = {
  BASELINE: "list-outline",
  SMARTCOURIER: "hardware-chip-outline",
};

export const DECISION_COLORS = {
  ACCEPT: "#2e7d32", // VERDE (sección 56)
  REJECT: "#c62828", // ROJO (sección 56)
  WAIT: "#f9a825", // AMARILLO (sección 56, "evaluación")
  BATCH: "#6a1b9a",
};

export const DECISION_ICONS = {
  ACCEPT: "checkmark-circle",
  REJECT: "close-circle",
  WAIT: "time",
  BATCH: "cube",
};

export const TEXT_COLORS = {
  primary: "#212121",
  secondary: "#555555", // ~7.5:1 sobre blanco
  muted: "#757575", // ~4.6:1 sobre blanco — reemplaza los #888/#999 previos
};

// Alto mínimo recomendado para elementos táctiles (sección 57).
export const MIN_TOUCH_TARGET = 44;

// Eventos dinámicos (sección 26/45) — botones de inyectar evento y el
// registro de eventos recientes comparten estos íconos.
export const EVENT_ICONS = {
  SURGE_STARTED: "flash",
  SURGE_ENDED: "flash-off",
  TRAFFIC_INCREASED: "car",
  TRAFFIC_DECREASED: "car-outline",
  ROAD_CLOSED: "construct",
  ROAD_REOPENED: "checkmark-done",
  ORDER_CANCELLED: "close-circle-outline",
  HIGH_DEMAND: "trending-up",
  LOW_DEMAND: "trending-down",
  URGENT_ORDER: "flame",
};
