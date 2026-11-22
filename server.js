require('dotenv').config();
const path = require('path');
const express = require('express');
const routes = require('./src/routes');

const app = express();

// Protección básica opcional: evita que cualquiera con la URL gaste tu saldo de IA
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const cabecera = req.headers.authorization || '';
    const [tipo, valor] = cabecera.split(' ');
    if (tipo === 'Basic' && valor) {
      const pass = Buffer.from(valor, 'base64').toString().split(':').slice(1).join(':');
      if (pass === process.env.APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Vales de aceituna"');
    res.status(401).send('Acceso restringido');
  });
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', routes);

// Manejo de errores: siempre JSON, con mensaje legible para el front
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 10 MB' : err.message || 'Error del servidor';
  res.status(status).json({ error: mensaje });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vales de aceituna en http://localhost:${PORT}`));
