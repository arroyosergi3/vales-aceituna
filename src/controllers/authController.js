const db = require('../db');
const auth = require('../auth');

const error = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || password.length > 200) throw error('Escribe tu email y tu contraseña');

    const clave = `${req.ip}|${email.toLowerCase()}`;
    auth.comprobarLimite(clave);

    const r = await db.query('SELECT id, nombre, email, rol, activo, password_hash FROM usuarios WHERE lower(email) = lower($1)', [email]);
    const u = r.rows[0];
    const correcto = u ? await auth.verificarPassword(password, u.password_hash) : false;
    if (!correcto || !u.activo) {
      auth.anotarFallo(clave);
      throw error('Email o contraseña incorrectos', 401);
    }

    auth.limpiarFallos(clave);
    auth.ponerCookie(req, res, u.id);
    res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });
  } catch (e) {
    next(e);
  }
};

// POST /api/auth/logout
exports.logout = (req, res) => {
  auth.quitarCookie(req, res);
  res.json({ ok: true });
};

// GET /api/auth/yo
exports.yo = (req, res) => {
  const { id, nombre, email, rol } = req.usuario;
  res.json({ id, nombre, email, rol });
};

// POST /api/auth/password
exports.cambiarPassword = async (req, res, next) => {
  try {
    const { actual, nueva } = req.body || {};
    if (typeof actual !== 'string' || typeof nueva !== 'string') throw error('Faltan datos');
    if (nueva.length < 8 || nueva.length > 200) throw error('La contraseña nueva debe tener entre 8 y 200 caracteres');

    const r = await db.query('SELECT password_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!(await auth.verificarPassword(actual, r.rows[0].password_hash))) throw error('La contraseña actual no es correcta');

    await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [await auth.hashPassword(nueva), req.usuario.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};
