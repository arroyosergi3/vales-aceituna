const db = require('../db');

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const esAdmin = (req) => req.usuario.rol === 'admin';

const texto = (v, max = 120) => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim();
  if (t.length > max) throw error(`Texto demasiado largo (máximo ${max} caracteres)`);
  return t;
};

const numeroOpcional = (v, nombre, { entero = false, max }) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max || (entero && !Number.isInteger(n))) {
    throw error(`${nombre} no es válido`);
  }
  return n;
};

function leerFinca(b, req) {
  const nombre = texto(b.nombre);
  if (!nombre) throw error('Indica el nombre de la finca');

  // Solo el administrador puede asignar la finca a otro usuario
  let usuarioId = req.usuario.id;
  if (esAdmin(req) && b.usuario_id) {
    usuarioId = Number(b.usuario_id);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) throw error('Usuario no válido');
  }

  return {
    usuario_id: usuarioId,
    nombre,
    alias: texto(b.alias),
    superficie: numeroOpcional(b.superficie, 'La superficie', { max: 99999999 }),
    poligono: texto(b.poligono, 30),
    parcela: texto(b.parcela, 30),
    olivos: numeroOpcional(b.olivos, 'El número de olivos', { entero: true, max: 10000000 }),
    variedad: texto(b.variedad),
  };
}

const traducir = (e) => {
  if (e.code === '23505') return error('Ya tienes una finca con ese nombre', 409);
  if (e.code === '23503') return error('El usuario indicado no existe');
  return e;
};

// Devuelve la finca si existe y el usuario puede usarla; si no, 404 (no se revela si existe)
async function fincaAccesible(req, id) {
  const r = await db.query('SELECT id, usuario_id FROM fincas WHERE id = $1', [id]);
  const finca = r.rows[0];
  if (!finca || (!esAdmin(req) && finca.usuario_id !== req.usuario.id)) throw error('La finca no existe', 404);
  return finca;
}
exports.fincaAccesible = fincaAccesible;

const idValido = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw error('Identificador no válido');
  return id;
};

// GET /api/fincas
exports.listar = async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT f.id, f.usuario_id, f.nombre, f.alias, f.superficie, f.poligono, f.parcela, f.olivos, f.variedad,
              u.nombre AS usuario,
              (SELECT COUNT(*) FROM vales v WHERE v.finca_id = f.id) AS vales,
              (SELECT COALESCE(SUM(v.kg), 0) FROM vales v WHERE v.finca_id = f.id) AS kg
       FROM fincas f JOIN usuarios u ON u.id = f.usuario_id
       ${esAdmin(req) ? '' : 'WHERE f.usuario_id = $1'}
       ORDER BY lower(u.nombre), lower(f.nombre)`,
      esAdmin(req) ? [] : [req.usuario.id]
    );
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
};

// POST /api/fincas
exports.crear = async (req, res, next) => {
  try {
    const f = leerFinca(req.body || {}, req);
    const r = await db.query(
      `INSERT INTO fincas (usuario_id, nombre, alias, superficie, poligono, parcela, olivos, variedad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [f.usuario_id, f.nombre, f.alias, f.superficie, f.poligono, f.parcela, f.olivos, f.variedad]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    next(traducir(e));
  }
};

// PUT /api/fincas/:id
exports.actualizar = async (req, res, next) => {
  try {
    const id = idValido(req.params.id);
    await fincaAccesible(req, id);
    const f = leerFinca(req.body || {}, req);
    await db.query(
      `UPDATE fincas SET usuario_id = $1, nombre = $2, alias = $3, superficie = $4, poligono = $5,
                         parcela = $6, olivos = $7, variedad = $8 WHERE id = $9`,
      [f.usuario_id, f.nombre, f.alias, f.superficie, f.poligono, f.parcela, f.olivos, f.variedad, id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(traducir(e));
  }
};

// DELETE /api/fincas/:id
exports.eliminar = async (req, res, next) => {
  try {
    const id = idValido(req.params.id);
    await fincaAccesible(req, id);
    await db.query('DELETE FROM fincas WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    next(e.code === '23503' ? error('Esta finca tiene vales. Bórralos antes de borrar la finca', 409) : e);
  }
};
