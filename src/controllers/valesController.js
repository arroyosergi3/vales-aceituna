const db = require('../db');
const { extraerDatosVale } = require('../services/extraccionIA');
const { fincaAccesible } = require('./fincasController');
const auth = require('../auth');

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const esAdmin = (req) => req.usuario.rol === 'admin';
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
    auth.limites.lecturas.comprobar(req.usuario.id); // protege el cupo gratuito de la IA
    auth.limites.lecturas.anotar(req.usuario.id);
    const datos = await extraerDatosVale(req.file.buffer, req.file.mimetype);
    res.json({ datos });
  } catch (e) {
    next(e);
  }
};

// ---------- POST /api/vales ----------
// multipart/form-data: campos del vale (incluida finca_id) + (opcional) archivo "imagen"
exports.crear = async (req, res, next) => {
  try {
    const b = req.body || {};
    const kg = Number(b.kg);
    const rendimiento = b.rendimiento === '' || b.rendimiento == null ? null : Number(b.rendimiento);

    const fincaId = Number(b.finca_id);
    if (!Number.isInteger(fincaId) || fincaId <= 0) throw error('Elige la finca a la que pertenece el vale');
    if (!fechaValida(b.fecha)) throw error('La fecha no es válida');
    if (!Number.isFinite(kg) || kg <= 0 || kg >= 1e10) throw error('Los kg deben ser un número mayor que 0');
    if (rendimiento !== null && !(rendimiento >= 0 && rendimiento <= 100)) throw error('El rendimiento debe estar entre 0 y 100');
    if (req.file && !MIMES.has(req.file.mimetype)) throw error('Formato de imagen no admitido');

    await fincaAccesible(req, fincaId); // la finca tiene que ser del usuario (o ser admin)

    const id = await db.transaccion(async (c) => {
      let imagenId = null;
      if (req.file) {
        const img = await c.query('INSERT INTO imagenes (mime, datos) VALUES ($1, $2) RETURNING id', [req.file.mimetype, req.file.buffer]);
        imagenId = img.rows[0].id;
      }
      const r = await c.query(
        `INSERT INTO vales (finca_id, numero_vale, fecha, kg, variedad, rendimiento, observaciones, imagen_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [fincaId, texto(b.numero_vale), b.fecha, kg, texto(b.variedad), rendimiento, texto(b.observaciones), imagenId]
      );
      return r.rows[0].id;
    });

    res.status(201).json({ id });
  } catch (e) {
    next(e);
  }
};

// ---------- GET /api/vales ----------
// Filtros opcionales: finca_id, usuario_id (solo admin), desde, hasta, kg_min, kg_max, q
// Un usuario normal solo ve los vales de sus fincas.
const DESDE = `
  FROM vales v
  JOIN fincas f    ON f.id = v.finca_id
  JOIN usuarios u  ON u.id = f.usuario_id
`;

function construirFiltros(q, usuario) {
  const where = [];
  const params = [];
  // Cada "?" de la condición se sustituye por el parámetro $n de Postgres
  const anadir = (condicion, valor) => {
    params.push(valor);
    where.push(condicion.replaceAll('?', `$${params.length}`));
  };
  const numero = (v) => (v === undefined || v === '' ? NaN : Number(v));

  if (usuario.rol !== 'admin') anadir('f.usuario_id = ?', usuario.id);
  else if (Number.isInteger(numero(q.usuario_id))) anadir('f.usuario_id = ?', numero(q.usuario_id));

  if (Number.isInteger(numero(q.finca_id))) anadir('v.finca_id = ?', numero(q.finca_id));
  if (fechaValida(q.desde)) anadir('v.fecha >= ?', q.desde);
  if (fechaValida(q.hasta)) anadir('v.fecha <= ?', q.hasta);
  if (Number.isFinite(numero(q.kg_min))) anadir('v.kg >= ?', numero(q.kg_min));
  if (Number.isFinite(numero(q.kg_max))) anadir('v.kg <= ?', numero(q.kg_max));
  if (q.q) anadir('(v.numero_vale ILIKE ? OR v.variedad ILIKE ? OR v.observaciones ILIKE ?)', `%${q.q}%`);

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

exports.listar = async (req, res, next) => {
  try {
    const { sql, params } = construirFiltros(req.query, req.usuario);

    const [vales, total, porFinca, porUsuario] = await Promise.all([
      db.query(
        `SELECT v.id, v.numero_vale, v.fecha, v.kg, v.variedad, v.rendimiento, v.observaciones,
                (v.imagen_id IS NOT NULL) AS tiene_imagen,
                f.id AS finca_id, f.nombre AS finca, f.alias, f.poligono, f.parcela, u.nombre AS usuario
         ${DESDE} ${sql}
         ORDER BY v.fecha DESC, v.id DESC
         LIMIT 1000`, params),
      db.query(`SELECT COUNT(*) AS vales, COALESCE(SUM(v.kg), 0) AS kg ${DESDE} ${sql}`, params),
      db.query(`SELECT f.id, f.nombre, f.alias, SUM(v.kg) AS kg, COUNT(*) AS vales ${DESDE} ${sql} GROUP BY f.id, f.nombre, f.alias ORDER BY kg DESC`, params),
      db.query(`SELECT u.id, u.nombre, SUM(v.kg) AS kg, COUNT(*) AS vales ${DESDE} ${sql} GROUP BY u.id, u.nombre ORDER BY kg DESC`, params),
    ]);

    res.json({ vales: vales.rows, total: total.rows[0], porFinca: porFinca.rows, porUsuario: porUsuario.rows });
  } catch (e) {
    next(e);
  }
};

// ---------- GET /api/vales/:id/imagen ----------
exports.imagen = async (req, res, next) => {
  try {
    const id = idValido(req.params.id);
    const r = await db.query(
      `SELECT i.mime, i.datos
       FROM vales v JOIN fincas f ON f.id = v.finca_id JOIN imagenes i ON i.id = v.imagen_id
       WHERE v.id = $1 ${esAdmin(req) ? '' : 'AND f.usuario_id = $2'}`,
      esAdmin(req) ? [id] : [id, req.usuario.id]
    );
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
      const r = await c.query('SELECT v.imagen_id, f.usuario_id FROM vales v JOIN fincas f ON f.id = v.finca_id WHERE v.id = $1', [id]);
      const fila = r.rows[0];
      if (!fila || (!esAdmin(req) && fila.usuario_id !== req.usuario.id)) throw error('El vale no existe', 404);
      await c.query('DELETE FROM vales WHERE id = $1', [id]);
      if (fila.imagen_id) await c.query('DELETE FROM imagenes WHERE id = $1', [fila.imagen_id]);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};
