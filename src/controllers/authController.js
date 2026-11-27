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
    auth.limites.login.comprobar(clave);

    const r = await db.query('SELECT id, nombre, email, rol, activo, password_hash FROM usuarios WHERE lower(email) = lower($1)', [email]);
    const u = r.rows[0];
    const correcto = u ? await auth.verificarPassword(password, u.password_hash) : false;
    if (!correcto || !u.activo) {
      auth.limites.login.anotar(clave);
      throw error('Email o contraseña incorrectos', 401);
    }

    auth.limites.login.limpiar(clave);
    auth.ponerCookie(req, res, u.id);
    res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });
  } catch (e) {
    next(e);
  }
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const registroAbierto = () => process.env.REGISTRO_ABIERTO !== 'false';

// GET /api/auth/config (pública): qué muestra la pantalla de entrada
exports.config = (req, res) => {
  res.json({ registro: registroAbierto(), requiereCodigo: Boolean(process.env.REGISTRO_CODIGO) });
};

// POST /api/auth/registro (pública): crea una cuenta de usuario normal y entra con ella
exports.registro = async (req, res, next) => {
  try {
    if (!registroAbierto()) throw error('El registro está desactivado. Pide una cuenta al administrador', 403);
    auth.limites.registro.comprobar(req.ip);

    const b = req.body || {};
    const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!nombre || nombre.length > 120) throw error('Indica tu nombre (máximo 120 caracteres)');
    if (!EMAIL.test(email) || email.length > 200) throw error('El email no es válido');
    if (password.length < 8 || password.length > 200) throw error('La contraseña debe tener entre 8 y 200 caracteres');

    auth.limites.registro.anotar(req.ip); // cuenta cada intento, también los fallidos
    if (process.env.REGISTRO_CODIGO && !auth.igualSeguro(b.codigo, process.env.REGISTRO_CODIGO)) {
      throw error('El código de invitación no es correcto', 403);
    }

    const r = await db.query(
      'INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, email, rol',
      [nombre, email, await auth.hashPassword(password)]
    );
    auth.ponerCookie(req, res, r.rows[0].id);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e.code === '23505' ? error('Ya existe una cuenta con ese email', 409) : e);
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
