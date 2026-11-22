const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { extraerDatosVale } = require('../services/extraccionIA');

const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const EXTENSIONES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const NOMBRE_ARCHIVO = /^[\w-]+\.(jpg|png|webp)$/;

const peticionIncorrecta = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ---------- POST /api/vales/extraer ----------
// Recibe la foto, la manda a la IA y devuelve los datos para que el usuario los revise.
// Todavía no inserta nada en la BBDD.
exports.extraer = async (req, res, next) => {
  try {
    if (!req.file) throw peticionIncorrecta('Falta la imagen del vale');
    const ext = EXTENSIONES[req.file.mimetype];
    if (!ext) throw peticionIncorrecta('Formato no admitido. Usa JPG, PNG o WEBP');

    const datos = await extraerDatosVale(req.file.buffer, req.file.mimetype);

    const imagen = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOADS, imagen), req.file.buffer);

    res.json({ datos, imagen });
  } catch (e) {
    next(e);
  }
};

// ---------- POST /api/vales ----------
const insertPropietario = db.prepare('INSERT INTO propietarios (nombre) VALUES (?) ON CONFLICT(nombre) DO NOTHING');
const selectPropietario = db.prepare('SELECT id FROM propietarios WHERE nombre = ?');
const insertParcela = db.prepare('INSERT INTO parcelas (nombre) VALUES (?) ON CONFLICT(nombre) DO NOTHING');
const selectParcela = db.prepare('SELECT id FROM parcelas WHERE nombre = ?');
const insertVale = db.prepare(`
  INSERT INTO vales (numero_vale, fecha, kg, parcela_id, propietario_id, variedad, rendimiento, observaciones, imagen)
  VALUES (@numero_vale, @fecha, @kg, @parcela_id, @propietario_id, @variedad, @rendimiento, @observaciones, @imagen)
`);

const guardarVale = db.transaction((v) => {
  insertPropietario.run(v.propietario);
  insertParcela.run(v.parcela);
  const propietario_id = selectPropietario.get(v.propietario).id;
  const parcela_id = selectParcela.get(v.parcela).id;
  return insertVale.run({ ...v, parcela_id, propietario_id }).lastInsertRowid;
});

exports.crear = (req, res, next) => {
  try {
    const b = req.body || {};
    const kg = Number(b.kg);
    const rendimiento = b.rendimiento === '' || b.rendimiento == null ? null : Number(b.rendimiento);
    const imagen = texto(b.imagen);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') || Number.isNaN(Date.parse(b.fecha))) throw peticionIncorrecta('La fecha no es válida');
    if (!Number.isFinite(kg) || kg <= 0) throw peticionIncorrecta('Los kg deben ser un número mayor que 0');
    if (rendimiento !== null && !Number.isFinite(rendimiento)) throw peticionIncorrecta('El rendimiento no es un número');
    if (!texto(b.parcela)) throw peticionIncorrecta('Indica la parcela');
    if (!texto(b.propietario)) throw peticionIncorrecta('Indica el propietario');
    if (imagen && (!NOMBRE_ARCHIVO.test(imagen) || !fs.existsSync(path.join(UPLOADS, imagen)))) throw peticionIncorrecta('La imagen del vale no existe');

    const id = guardarVale({
      numero_vale: texto(b.numero_vale),
      fecha: b.fecha,
      kg,
      parcela: texto(b.parcela),
      propietario: texto(b.propietario),
      variedad: texto(b.variedad),
      rendimiento,
      observaciones: texto(b.observaciones),
      imagen,
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
  JOIN parcelas pa      ON pa.id = v.parcela_id
  JOIN propietarios pr  ON pr.id = v.propietario_id
`;

function construirFiltros(q) {
  const where = [];
  const params = [];
  const numero = (v) => (v === undefined || v === '' ? null : Number(v));

  if (q.parcela) { where.push('pa.nombre = ?'); params.push(q.parcela); }
  if (q.propietario) { where.push('pr.nombre = ?'); params.push(q.propietario); }
  if (q.desde) { where.push('v.fecha >= ?'); params.push(q.desde); }
  if (q.hasta) { where.push('v.fecha <= ?'); params.push(q.hasta); }
  if (Number.isFinite(numero(q.kg_min))) { where.push('v.kg >= ?'); params.push(numero(q.kg_min)); }
  if (Number.isFinite(numero(q.kg_max))) { where.push('v.kg <= ?'); params.push(numero(q.kg_max)); }
  if (q.q) {
    where.push('(v.numero_vale LIKE ? OR v.variedad LIKE ? OR v.observaciones LIKE ?)');
    const patron = `%${q.q}%`;
    params.push(patron, patron, patron);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

exports.listar = (req, res, next) => {
  try {
    const { sql, params } = construirFiltros(req.query);

    const vales = db.prepare(`
      SELECT v.id, v.numero_vale, v.fecha, v.kg, v.variedad, v.rendimiento, v.observaciones, v.imagen,
             pa.nombre AS parcela, pr.nombre AS propietario
      ${DESDE} ${sql}
      ORDER BY v.fecha DESC, v.id DESC
      LIMIT 1000
    `).all(...params);

    const total = db.prepare(`SELECT COUNT(*) AS vales, COALESCE(SUM(v.kg), 0) AS kg ${DESDE} ${sql}`).get(...params);

    const porParcela = db.prepare(`
      SELECT pa.nombre AS nombre, SUM(v.kg) AS kg, COUNT(*) AS vales
      ${DESDE} ${sql} GROUP BY pa.id ORDER BY kg DESC
    `).all(...params);

    const porPropietario = db.prepare(`
      SELECT pr.nombre AS nombre, SUM(v.kg) AS kg, COUNT(*) AS vales
      ${DESDE} ${sql} GROUP BY pr.id ORDER BY kg DESC
    `).all(...params);

    res.json({ vales, total, porParcela, porPropietario });
  } catch (e) {
    next(e);
  }
};

// ---------- DELETE /api/vales/:id ----------
exports.eliminar = (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const fila = db.prepare('SELECT imagen FROM vales WHERE id = ?').get(id);
    if (!fila) return res.status(404).json({ error: 'El vale no existe' });

    db.prepare('DELETE FROM vales WHERE id = ?').run(id);
    if (fila.imagen) fs.rm(path.join(UPLOADS, fila.imagen), { force: true }, () => {});
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

// ---------- GET /api/catalogo ----------
// Para los desplegables de filtros y el autocompletado del formulario
exports.catalogo = (req, res, next) => {
  try {
    res.json({
      parcelas: db.prepare('SELECT nombre FROM parcelas ORDER BY nombre').all().map((r) => r.nombre),
      propietarios: db.prepare('SELECT nombre FROM propietarios ORDER BY nombre').all().map((r) => r.nombre),
    });
  } catch (e) {
    next(e);
  }
};
