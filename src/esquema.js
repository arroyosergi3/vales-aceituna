// Esquema de la base de datos. Se ejecuta al arrancar y es seguro repetirlo (IF NOT EXISTS).
module.exports = [
  // Si existe el esquema antiguo (vales con parcela y propietario en texto), se aparta
  // cambiándole el nombre. No se borra nada.
  `DO $mig$
   BEGIN
     IF to_regclass('public.vales') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'vales' AND column_name = 'finca_id') THEN
       ALTER TABLE vales RENAME TO vales_antiguo;
       IF to_regclass('public.parcelas') IS NOT NULL THEN ALTER TABLE parcelas RENAME TO parcelas_antiguo; END IF;
       IF to_regclass('public.propietarios') IS NOT NULL THEN ALTER TABLE propietarios RENAME TO propietarios_antiguo; END IF;
     END IF;
   END
   $mig$`,

  `CREATE TABLE IF NOT EXISTS usuarios (
     id            SERIAL PRIMARY KEY,
     nombre        TEXT    NOT NULL,
     email         TEXT    NOT NULL,
     password_hash TEXT    NOT NULL,
     rol           TEXT    NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin', 'usuario')),
     activo        BOOLEAN NOT NULL DEFAULT true,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email ON usuarios (lower(email))`,

  `CREATE TABLE IF NOT EXISTS fincas (
     id         SERIAL PRIMARY KEY,
     usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
     nombre     TEXT    NOT NULL,
     alias      TEXT,
     superficie NUMERIC(10,2) CHECK (superficie >= 0),   -- hectáreas
     poligono   TEXT,                                    -- número de polígono catastral
     parcela    TEXT,                                    -- número de parcela catastral
     olivos     INTEGER CHECK (olivos >= 0),
     variedad   TEXT,
     creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_fincas_usuario_nombre ON fincas (usuario_id, lower(nombre))`,

  // Las fotos van en la base de datos: el disco del hosting gratuito no es permanente
  `CREATE TABLE IF NOT EXISTS imagenes (
     id        SERIAL PRIMARY KEY,
     mime      TEXT  NOT NULL,
     datos     BYTEA NOT NULL,
     creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS vales (
     id            SERIAL PRIMARY KEY,
     finca_id      INTEGER       NOT NULL REFERENCES fincas(id),
     numero_vale   TEXT,
     fecha         DATE          NOT NULL,
     kg            NUMERIC(12,2) NOT NULL CHECK (kg > 0),
     variedad      TEXT,
     rendimiento   NUMERIC(5,2),                          -- % de rendimiento graso, si el vale lo trae
     observaciones TEXT,
     imagen_id     INTEGER REFERENCES imagenes(id) ON DELETE SET NULL,
     creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ix_vales_fecha  ON vales(fecha)`,
  `CREATE INDEX IF NOT EXISTS ix_vales_finca  ON vales(finca_id)`,
  `CREATE INDEX IF NOT EXISTS ix_fincas_usuario ON fincas(usuario_id)`,
];
