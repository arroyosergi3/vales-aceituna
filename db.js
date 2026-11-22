const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(dir, 'aceitunas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS propietarios (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS parcelas (
    id     INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS vales (
    id             INTEGER PRIMARY KEY,
    numero_vale    TEXT,
    fecha          TEXT    NOT NULL,              -- YYYY-MM-DD
    kg             REAL    NOT NULL CHECK (kg > 0),
    parcela_id     INTEGER NOT NULL REFERENCES parcelas(id),
    propietario_id INTEGER NOT NULL REFERENCES propietarios(id),
    variedad       TEXT,
    rendimiento    REAL,                          -- % de rendimiento graso, si el vale lo trae
    observaciones  TEXT,
    imagen         TEXT,                          -- nombre del archivo en /uploads
    creado_en      TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_vales_fecha       ON vales(fecha);
  CREATE INDEX IF NOT EXISTS idx_vales_parcela     ON vales(parcela_id);
  CREATE INDEX IF NOT EXISTS idx_vales_propietario ON vales(propietario_id);
`);

module.exports = db;
