const express = require('express');
const multer = require('multer');
const auth = require('./auth');
const sesion = require('./controllers/authController');
const usuarios = require('./controllers/usuariosController');
const fincas = require('./controllers/fincasController');
const vales = require('./controllers/valesController');

const router = express.Router();
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Públicas
router.post('/auth/login', sesion.login);
router.post('/auth/logout', sesion.logout);

// A partir de aquí hace falta haber entrado
router.use(auth.requiereSesion);

router.get('/auth/yo', sesion.yo);
router.post('/auth/password', sesion.cambiarPassword);

// Usuarios (solo administrador)
router.get('/usuarios', auth.soloAdmin, usuarios.listar);
router.post('/usuarios', auth.soloAdmin, usuarios.crear);
router.put('/usuarios/:id', auth.soloAdmin, usuarios.actualizar);

// Fincas (cada usuario las suyas; el administrador todas)
router.get('/fincas', fincas.listar);
router.post('/fincas', fincas.crear);
router.put('/fincas/:id', fincas.actualizar);
router.delete('/fincas/:id', fincas.eliminar);

// Vales
router.post('/vales/extraer', subida.single('imagen'), vales.extraer); // foto -> datos (no guarda)
router.post('/vales', subida.single('imagen'), vales.crear);           // datos revisados (+ foto) -> insert
router.get('/vales', vales.listar);                                    // listado + filtros + totales
router.get('/vales/:id/imagen', vales.imagen);                         // foto del vale
router.delete('/vales/:id', vales.eliminar);

module.exports = router;
