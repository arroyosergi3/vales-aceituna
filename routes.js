const express = require('express');
const multer = require('multer');
const vales = require('./controllers/valesController');

const router = express.Router();
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/vales/extraer', subida.single('imagen'), vales.extraer); // foto -> datos (no guarda)
router.post('/vales', vales.crear);                                    // datos revisados -> insert
router.get('/vales', vales.listar);                                    // listado + filtros + totales
router.delete('/vales/:id', vales.eliminar);
router.get('/catalogo', vales.catalogo);                               // parcelas y propietarios existentes

module.exports = router;
