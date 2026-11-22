# Vales de aceituna

Web para registrar vales de aceituna a partir de una foto. La IA (OpenAI) lee el vale, tú revisas los datos y se guardan en la base de datos. Después puedes filtrar por parcela, propietario, fechas y cantidades.

## Tecnología

| Capa | Elección | Por qué |
|---|---|---|
| Servidor | Node.js 20+ y Express | Poco código, fácil de desplegar |
| Base de datos | SQLite (`better-sqlite3`) | Un solo archivo, sin instalar nada. Para varios usuarios a la vez se cambia a PostgreSQL tocando solo `src/db.js` y el controlador |
| IA | OpenAI con visión y salida JSON estricta | Devuelve siempre el mismo formato, sin parsear texto libre |
| Front | HTML + CSS + JavaScript sin framework | Es un formulario y una tabla; no hace falta más |

## Puesta en marcha

```bash
npm install
cp .env.example .env     # y rellena OPENAI_API_KEY
npm start                # http://localhost:3000
```

## Estructura

```
server.js                         arranque, middlewares, errores
src/routes.js                     rutas de la API
src/controllers/valesController.js  validación, inserts y consultas con filtros
src/services/extraccionIA.js      prompt + llamada a OpenAI (aquí se cambia de IA)
src/db.js                         esquema SQLite
public/                           front (index.html, app.js, styles.css)
```

## API

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/vales/extraer` | Recibe la foto (`imagen`), devuelve los datos leídos. No guarda nada |
| POST | `/api/vales` | Guarda un vale ya revisado |
| GET | `/api/vales` | Lista con filtros: `parcela`, `propietario`, `desde`, `hasta`, `kg_min`, `kg_max`, `q` |
| DELETE | `/api/vales/:id` | Borra un vale y su foto |
| GET | `/api/catalogo` | Parcelas y propietarios existentes |

## Notas

- La foto se lee y se revisa antes de guardar: una IA puede equivocarse con letra manuscrita o fotos movidas.
- Pon `APP_PASSWORD` en `.env` si publicas la web, para que nadie ajeno gaste tu saldo de OpenAI.
- Copias de seguridad: basta con copiar `data/aceitunas.db` y la carpeta `uploads/`.
