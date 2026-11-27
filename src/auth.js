// Sesiones y contraseñas sin dependencias extra: scrypt para las contraseñas
// y una cookie firmada con HMAC para la sesión.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sesion';
const DURACION_S = 30 * 24 * 60 * 60; // la sesión dura 30 días

const error = (mensaje, status) => Object.assign(new Error(mensaje), { status });

/* ---------- contraseñas ---------- */
async function hashPassword(password) {
  const sal = crypto.randomBytes(16);
  const clave = await scrypt(password, sal, 64);
  return `scrypt$${sal.toString('hex')}$${clave.toString('hex')}`;
}

async function verificarPassword(password, guardado) {
  const [tipo, salHex, claveHex] = String(guardado).split('$');
  if (tipo !== 'scrypt' || !salHex || !claveHex) return false;
  const esperada = Buffer.from(claveHex, 'hex');
  const calculada = await scrypt(password, Buffer.from(salHex, 'hex'), esperada.length);
  return crypto.timingSafeEqual(calculada, esperada);
}

/* ---------- token de sesión ---------- */
const firmar = (texto) => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(texto).digest('base64url');

function crearToken(usuarioId) {
  const caduca = Math.floor(Date.now() / 1000) + DURACION_S;
  const carga = `${usuarioId}.${caduca}`;
  return `${carga}.${firmar(carga)}`;
}

function leerToken(token) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const [id, caduca, firma] = partes;
  const esperada = Buffer.from(firmar(`${id}.${caduca}`));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  if (!(Number(caduca) > Date.now() / 1000)) return null;
  const usuarioId = Number(id);
  return Number.isInteger(usuarioId) && usuarioId > 0 ? usuarioId : null;
}

function leerCookie(req, nombre) {
  for (const trozo of (req.headers.cookie || '').split(';')) {
    const i = trozo.indexOf('=');
    if (i > 0 && trozo.slice(0, i).trim() === nombre) return trozo.slice(i + 1).trim();
  }
  return null;
}

const opcionesCookie = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
const ponerCookie = (req, res, usuarioId) => res.cookie(COOKIE, crearToken(usuarioId), { ...opcionesCookie(req), maxAge: DURACION_S * 1000 });
const quitarCookie = (req, res) => res.clearCookie(COOKIE, opcionesCookie(req));

/* ---------- middlewares ---------- */
async function requiereSesion(req, res, next) {
  try {
    const id = leerToken(leerCookie(req, COOKIE));
    if (!id) throw error('Entra con tu usuario para continuar', 401);
    const r = await db.query('SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = $1', [id]);
    const usuario = r.rows[0];
    if (!usuario || !usuario.activo) throw error('Entra con tu usuario para continuar', 401);
    req.usuario = usuario;
    next();
  } catch (e) {
    next(e);
  }
}

const soloAdmin = (req, res, next) => (req.usuario.rol === 'admin' ? next() : next(error('No tienes permiso para hacer esto', 403)));

/* ---------- límites de uso (en memoria) ---------- */
function crearLimitador(max, ventanaMs, mensaje) {
  const registros = new Map();
  return {
    comprobar(clave) {
      const r = registros.get(clave);
      if (r && r.hasta > Date.now() && r.n >= max) throw error(mensaje, 429);
    },
    anotar(clave) {
      const ahora = Date.now();
      if (registros.size > 1000) for (const [k, v] of registros) if (v.hasta <= ahora) registros.delete(k);
      const r = registros.get(clave);
      if (!r || r.hasta <= ahora) registros.set(clave, { n: 1, hasta: ahora + ventanaMs });
      else r.n += 1;
    },
    limpiar(clave) {
      registros.delete(clave);
    },
  };
}

const limites = {
  login: crearLimitador(10, 15 * 60 * 1000, 'Demasiados intentos. Espera unos minutos y vuelve a probar'),
  registro: crearLimitador(5, 60 * 60 * 1000, 'Demasiados registros desde tu conexión. Inténtalo más tarde'),
  lecturas: crearLimitador(30, 60 * 60 * 1000, 'Has leído muchos vales seguidos. Espera un rato o rellénalos a mano'),
};

// Comparación de textos secretos sin filtrar información por el tiempo que tarda
const igualSeguro = (a, b) => {
  const hash = (x) => crypto.createHash('sha256').update(String(x ?? '')).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
};

/* ---------- primer administrador ---------- */
// Si no hay ningún usuario, se crea el administrador con ADMIN_EMAIL y ADMIN_PASSWORD.
async function asegurarAdmin() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) {
    console.warn('No hay usuarios. Define ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres) para crear el administrador.');
    return;
  }
  await db.query(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, 'admin')`, [
    process.env.ADMIN_NOMBRE || 'Administrador', email, await hashPassword(password),
  ]);
  console.log(`Administrador creado: ${email}`);
}

module.exports = {
  hashPassword, verificarPassword, crearToken, leerToken, ponerCookie, quitarCookie,
  requiereSesion, soloAdmin, limites, igualSeguro, asegurarAdmin,
};
