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

// Crea las tablas la primera vez que arranca (y migra el esquema antiguo si existe)
async function init() {
  await transaccion(async (cliente) => {
    for (const sentencia of require('./esquema')) await cliente.query(sentencia);
  });
}

module.exports = { query, transaccion, init };
