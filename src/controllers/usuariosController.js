const db = require('../db');
const auth = require('../auth');

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const ROLES = ['admin', 'usuario'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nombreValido = (v) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || t.length > 120) throw error('Indica el nombre (máximo 120 caracteres)');
  return t;
};
const passwordValida = (v) => {
  if (typeof v !== 'string' || v.length < 8 || v.length > 200) throw error('La contraseña debe tener entre 8 y 200 caracteres');
  return v;
};
const idValido = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw error('Identificador no válido');
  return id;
};

// GET /api/usuarios (solo admin)
exports.listar = async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT u.id, u.nombre, u.email, u.rol, u.activo, (SELECT COUNT(*) FROM fincas f WHERE f.usuario_id = u.id) AS fincas
      FROM usuarios u ORDER BY lower(u.nombre)`);
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
};

// POST /api/usuarios (solo admin)
exports.crear = async (req, res, next) => {
  try {
    const b = req.body || {};
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    if (!EMAIL.test(email) || email.length > 200) throw error('El email no es válido');
    const rol = b.rol || 'usuario';
    if (!ROLES.includes(rol)) throw error('Rol no válido');

    const r = await db.query(
      'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id',
      [nombreValido(b.nombre), email, await auth.hashPassword(passwordValida(b.password)), rol]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    next(e.code === '23505' ? error('Ya existe un usuario con ese email', 409) : e);
  }
};

// PUT /api/usuarios/:id (solo admin). Todos los campos son opcionales.
exports.actualizar = async (req, res, next) => {
  try {
    const id = idValido(req.params.id);
    const b = req.body || {};
    const cambios = [];
    const params = [];
    const poner = (columna, valor) => { params.push(valor); cambios.push(`${columna} = $${params.length}`); };

    if (b.nombre !== undefined) poner('nombre', nombreValido(b.nombre));
    if (b.rol !== undefined) {
      if (!ROLES.includes(b.rol)) throw error('Rol no válido');
      poner('rol', b.rol);
    }
    if (b.activo !== undefined) poner('activo', Boolean(b.activo));
    if (b.password) poner('password_hash', await auth.hashPassword(passwordValida(b.password)));

    if (id === req.usuario.id && (b.activo === false || (b.rol !== undefined && b.rol !== 'admin'))) {
      throw error('No puedes desactivarte ni quitarte el rol de administrador a ti mismo');
    }
    if (!cambios.length) throw error('No hay nada que cambiar');

    params.push(id);
    const r = await db.query(`UPDATE usuarios SET ${cambios.join(', ')} WHERE id = $${params.length}`, params);
    if (!r.rowCount) throw error('El usuario no existe', 404);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};
