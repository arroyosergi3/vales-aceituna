const db = require('../db');
const { extraerDatosVale } = require('../services/extraccionIA');

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const fechaValida = (f) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '')) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
};
const idValido = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw error('Identificador no válido');
  return id;
};

// ---------- POST /api/vales/extraer ----------
// Recibe la foto, la manda a la IA y devuelve los datos para que el usuario los revise.
// No guarda nada en la BBDD.
exports.extraer = async (req, res, next) => {
  try {
    if (!req.file) throw error('Falta la imagen del vale');
    if (!MIMES.has(req.file.mimetype)) throw error('Formato no admitido. Usa JPG, PNG o WEBP');
    const datos = await extraerDatosVale(req.file.buffer, req.file.mimetype);
    res.json({ datos });
  } catch (e) {
    next(e);
  }
};

// ---------- POST /api/vales ----------
// multipart/form-data: campos del vale + (opcional) archivo "imagen"
// "tabla" es siempre una constante de este archivo, nunca viene del usuario
async function obtenerOCrear(cliente, tabla, nombre) {
  await cliente.query(`INSERT INTO ${tabla} (nombre) VALUES ($1) ON CONFLICT DO NOTHING`, [nombre]);
  const r = await cliente.query(`SELECT id FROM ${tabla} WHERE lower(nombre) = lower($1)`, [nombre]);
  return r.rows[0].id;
}

exports.crear = async (req, res, next) => {
  try {
    const b = req.body || {};
    const kg = Number(b.kg);
    const rendimiento = b.rendimiento === '' || b.rendimiento == null ? null : Number(b.rendimiento);

    if (!fechaValida(b.fecha)) throw error('La fecha no es válida');
    if (!Number.isFinite(kg) || kg <= 0 || kg >= 1e10) throw error('Los kg deben ser un número mayor que 0');
    if (rendimiento !== null && !(rendimiento >= 0 && rendimiento <= 100)) throw error('El rendimiento debe estar entre 0 y 100');
    if (!texto(b.parcela)) throw error('Indica la parcela');
    if (!texto(b.propietario)) throw error('Indica el propietario');
    if (req.file && !MIMES.has(req.file.mimetype)) throw error('Formato de imagen no admitido');

    const id = await db.transaccion(async (c) => {
      const propietarioId = await obtenerOCrear(c, 'propietarios', texto(b.propietario));
      const parcelaId = await obtenerOCrear(c, 'parcelas', texto(b.parcela));

      let imagenId = null;
      if (req.file) {
        const img = await c.query('INSERT INTO imagenes (mime, datos) VALUES ($1, $2) RETURNING id', [req.file.mimetype, req.file.buffer]);
        imagenId = img.rows[0].id;
      }

      const r = await c.query(
        `INSERT INTO vales (numero_vale, fecha, kg, parcela_id, propietario_id, variedad, rendimiento, observaciones, imagen_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [texto(b.numero_vale), b.fecha, kg, parcelaId, propietarioId, texto(b.variedad), rendimiento, texto(b.observaciones), imagenId]
      );
      return r.rows[0].id;
    });

    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
};

// ---------- GET /api/vales ----------
// Filtros opcionales: parcela, propietario, desde, hasta, kg_min, kg_max, q
const DESDE = `
  FROM vales v
  JOIN parcelas pa     ON pa.id = v.parcela_id
  JOIN propietarios pr ON pr.id = v.propietario_id
`;

function construirFiltros(q) {
  const where = [];
  const params = [];
  // Cada "?" de la condición se sustituye por el parámetro $n de Postgres
  const anadir = (condicion, valor) => {
    params.push(valor);
    where.push(condicion.replaceAll('?', `$${params.length}`));
  };
  const numero = (v) => (v === undefined || v === '' ? NaN : Number(v));

  if (q.parcela) anadir('pa.nombre = ?', q.parcela);
  if (q.propietario) anadir('pr.nombre = ?', q.propietario);
  if (fechaValida(q.desde)) anadir('v.fecha >= ?', q.desde);
  if (fechaValida(q.hasta)) anadir('v.fecha <= ?', q.hasta);
  if (Number.isFinite(numero(q.kg_min))) anadir('v.kg >= ?', numero(q.kg_min));
  if (Number.isFinite(numero(q.kg_max))) anadir('v.kg <= ?', numero(q.kg_max));
  if (q.q) anadir('(v.numero_vale ILIKE ? OR v.variedad ILIKE ? OR v.observaciones ILIKE ?)', `%${q.q}%`);

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

exports.listar = async (req, res, next) => {
  try {
    const { sql, params } = construirFiltros(req.query);

    const [vales, total, porParcela, porPropietario] = await Promise.all([
      db.query(
        `SELECT v.id, v.numero_vale, v.fecha, v.kg, v.variedad, v.rendimiento, v.observaciones,
                (v.imagen_id IS NOT NULL) AS tiene_imagen,
                pa.nombre AS parcela, pr.nombre AS propietario
         ${DESDE} ${sql}
         ORDER BY v.fecha DESC, v.id DESC
         LIMIT 1000`, params),
      db.query(`SELECT COUNT(*) AS vales, COALESCE(SUM(v.kg), 0) AS kg ${DESDE} ${sql}`, params),
      db.query(`SELECT pa.nombre AS nombre, SUM(v.kg) AS kg, COUNT(*) AS vales ${DESDE} ${sql} GROUP BY pa.id, pa.nombre ORDER BY kg DESC`, params),
      db.query(`SELECT pr.nombre AS nombre, SUM(v.kg) AS kg, COUNT(*) AS vales ${DESDE} ${sql} GROUP BY pr.id, pr.nombre ORDER BY kg DESC`, params),
    ]);

    res.json({ vales: vales.rows, total: total.rows[0], porParcela: porParcela.rows, porPropietario: porPropietario.rows });
  } catch (e) {
    next(e);
  }
};

// ---------- GET /api/vales/:id/imagen ----------
exports.imagen = async (req, res, next) => {
  try {
    const id = idValido(req.params.id);
    const r = await db.query('SELECT i.mime, i.datos FROM vales v JOIN imagenes i ON i.id = v.imagen_id WHERE v.id = $1', [id]);
    if (!r.rowCount) throw error('Este vale no tiene foto', 404);
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(r.rows[0].mime).send(r.rows[0].datos);
  } catch (e) {
    next(e);
  }
};

// ---------- DELETE /api/vales/:id ----------
exports.eliminar = async (req, res, next) => {
  try {
    const id = idValido(req.params.id);
    await db.transaccion(async (c) => {
      const r = await c.query('DELETE FROM vales WHERE id = $1 RETURNING imagen_id', [id]);
      if (!r.rowCount) throw error('El vale no existe', 404);
      if (r.rows[0].imagen_id) await c.query('DELETE FROM imagenes WHERE id = $1', [r.rows[0].imagen_id]);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

// ---------- GET /api/catalogo ----------
// Para los desplegables de filtros y el autocompletado del formulario
exports.catalogo = async (req, res, next) => {
  try {
    const [parcelas, propietarios] = await Promise.all([
      db.query('SELECT nombre FROM parcelas ORDER BY nombre'),
      db.query('SELECT nombre FROM propietarios ORDER BY nombre'),
    ]);
    res.json({ parcelas: parcelas.rows.map((r) => r.nombre), propietarios: propietarios.rows.map((r) => r.nombre) });
  } catch (e) {
    next(e);
  }
};
