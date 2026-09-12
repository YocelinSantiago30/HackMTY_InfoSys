// Paleta semántica única (sección 56): agentes por color fijo, decisiones
// por color fijo, para que todas las pantallas se vean consistentes en vez
// de repetir hex sueltos. Los tonos de texto están elegidos para pasar
// contraste WCAG AA (4.5:1) sobre fondo blanco — #888/#999 (usados antes en
// 14 lugares) no lo pasaban.

export const AGENT_COLORS = {
  BASELINE: "#616161", // GRIS (sección 56)
  SMARTCOURIER: "#1976d2", // AZUL (sección 56)
};

export const AGENT_ICONS = {
  BASELINE: "📦",
  SMARTCOURIER: "🤖",
};

export const DECISION_COLORS = {
  ACCEPT: "#2e7d32", // VERDE (sección 56)
  REJECT: "#c62828", // ROJO (sección 56)
  WAIT: "#f9a825", // AMARILLO (sección 56, "evaluación")
  BATCH: "#6a1b9a",
};

export const DECISION_ICONS = {
  ACCEPT: "✅",
  REJECT: "❌",
  WAIT: "⏳",
  BATCH: "📦",
};

export const TEXT_COLORS = {
  primary: "#212121",
  secondary: "#555555", // ~7.5:1 sobre blanco
  muted: "#757575", // ~4.6:1 sobre blanco — reemplaza los #888/#999 previos
};

// Alto mínimo recomendado para elementos táctiles (sección 57).
export const MIN_TOUCH_TARGET = 44;
