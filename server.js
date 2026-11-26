require('dotenv').config();
const path = require('path');
const express = require('express');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('Falta SESSION_SECRET (mínimo 32 caracteres). Genera una con:');
  console.error(`  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
  process.exit(1);
}

const db = require('./src/db');
const auth = require('./src/auth');
const routes = require('./src/routes');

const app = express();
app.set('trust proxy', 1); // detrás del proxy de Render: así la cookie se marca como segura

// Comprobación de salud para el hosting
app.get('/healthz', (req, res) => res.send('ok'));

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', routes);
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

// Manejo de errores: siempre JSON, con mensaje legible para el front
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 10 MB' : status === 500 ? 'Error del servidor' : err.message;
  res.status(status).json({ error: mensaje });
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(auth.asegurarAdmin)
  .then(() => app.listen(PORT, () => console.log(`Vales de aceituna en http://localhost:${PORT}`)))
  .catch((e) => {
    console.error('No se pudo arrancar:', e.message);
    process.exit(1);
  });
