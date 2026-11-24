const { Pool, types } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL en el archivo .env (cadena de conexión de Neon)');
}

// Que Postgres devuelva números y fechas como el front los espera
types.setTypeParser(20, (v) => parseInt(v, 10));   // COUNT(*)  -> número
types.setTypeParser(1700, (v) => parseFloat(v));   // NUMERIC   -> número
types.setTypeParser(1082, (v) => v);               // DATE      -> 'YYYY-MM-DD'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000, // Neon duerme la base si no se usa; al despertar tarda un momento
});
pool.on('error', (e) => console.error('Conexión inactiva cerrada por Neon:', e.message));

const query = (texto, params) => pool.query(texto, params);

async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

// Crea las tablas la primera vez que arranca
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS propietarios (
      id     SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_propietarios_nombre ON propietarios (lower(nombre));

    CREATE TABLE IF NOT EXISTS parcelas (
      id     SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_parcelas_nombre ON parcelas (lower(nombre));

    -- Las fotos van en la base de datos: el disco del hosting gratuito no es permanente
    CREATE TABLE IF NOT EXISTS imagenes (
      id        SERIAL PRIMARY KEY,
      mime      TEXT  NOT NULL,
      datos     BYTEA NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS vales (
      id             SERIAL PRIMARY KEY,
      numero_vale    TEXT,
      fecha          DATE          NOT NULL,
      kg             NUMERIC(12,2) NOT NULL CHECK (kg > 0),
      parcela_id     INTEGER       NOT NULL REFERENCES parcelas(id),
      propietario_id INTEGER       NOT NULL REFERENCES propietarios(id),
      variedad       TEXT,
      rendimiento    NUMERIC(5,2),                 -- % de rendimiento graso, si el vale lo trae
      observaciones  TEXT,
      imagen_id      INTEGER REFERENCES imagenes(id) ON DELETE SET NULL,
      creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_vales_fecha       ON vales(fecha);
    CREATE INDEX IF NOT EXISTS idx_vales_parcela     ON vales(parcela_id);
    CREATE INDEX IF NOT EXISTS idx_vales_propietario ON vales(propietario_id);
  `);
}

module.exports = { query, transaccion, init };
