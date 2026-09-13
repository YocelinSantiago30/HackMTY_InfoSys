require("dotenv").config();

const pool = require("./database");

const AGENTS = [
  {
    code: "BASELINE",
    name: "Baseline",
    description:
      "Agente de referencia: acepta pedidos usando reglas simples de pago mínimo por minuto y por kilómetro.",
  },
  {
    code: "SMARTCOURIER",
    name: "SmartCourier AI",
    description:
      "Agente principal: evalúa múltiples variables, restricciones duras y un score compuesto antes de decidir.",
  },
];

async function seed() {
  console.log("Insertando agentes base (BASELINE, SMARTCOURIER)...");

  for (const agent of AGENTS) {
    await pool.query(
      `INSERT INTO agents (code, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description`,
      [agent.code, agent.name, agent.description]
    );
  }

  console.log("Seed completado.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Error al hacer seed:", err);
  process.exit(1);
});
