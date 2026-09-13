require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("./database");

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  console.log("Ejecutando schema.sql contra la base de datos...");
  await pool.query(schemaSql);
  console.log("Migración completada.");

  await pool.end();
}

migrate().catch((err) => {
  console.error("Error al migrar:", err);
  process.exit(1);
});
    