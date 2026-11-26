# Vales de aceituna

Web para registrar vales de aceituna a partir de una foto. Cada usuario tiene sus fincas; al registrar un vale se elige a qué finca pertenece. La IA (Gemini) lee la foto, tú revisas los datos y se guardan en PostgreSQL (Neon). Después se puede filtrar por finca, usuario, fechas y cantidades.

## Cómo funciona

- **Usuarios.** Se entra con email y contraseña. Hay dos roles: *usuario* (ve y gestiona solo sus fincas y vales) y *administrador* (lo ve todo, crea usuarios y puede asignar fincas a cualquiera). No hay registro público: el administrador crea las cuentas.
- **Fincas.** CRUD completo. Datos: nombre, alias, superficie (ha), polígono, parcela, nº de olivos, variedad y usuario. Una finca con vales no se puede borrar.
- **Vales.** Foto → IA → formulario de revisión → guardar. La finca la elige siempre el usuario. Si la IA lee una parcela que coincide con una sola finca (por nombre, alias o nº de parcela), la propone.
- **Primer administrador.** Al arrancar sin usuarios, se crea con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

## Tecnología

Node.js 20+ y Express · PostgreSQL en Neon (las fotos van en la base de datos) · Gemini (`src/services/extraccionIA.js`) · front en HTML, CSS y JavaScript sin framework · hosting en Render (plan gratuito).

## Variables de entorno

Ver `.env.example`. En Render se ponen en **Environment**; nunca se suben al repositorio.

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a Neon |
| `GEMINI_API_KEY` | Lectura de vales con IA |
| `SESSION_SECRET` | Firma de las sesiones (mínimo 32 caracteres) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primer administrador (solo si no hay usuarios) |
| `GEMINI_MODEL` | Opcional. Por defecto `gemini-2.5-flash` |

## Puesta en marcha en local

```bash
npm install
cp .env.example .env     # rellena las variables
npm start                # http://localhost:3000
```

Las tablas se crean solas al arrancar. Si existe el esquema antiguo (vales con parcela y propietario en texto), se aparta renombrándolo a `vales_antiguo`, `parcelas_antiguo` y `propietarios_antiguo`; no se borra nada.

## Tablas

`usuarios`, `fincas`, `vales` e `imagenes` (fotos). Un vale pertenece a una finca y la finca a un usuario.

## API

Todas las rutas, salvo el login, exigen sesión.

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` | Entrar y salir |
| GET | `/api/auth/yo` | Usuario de la sesión |
| POST | `/api/auth/password` | Cambiar la propia contraseña |
| GET, POST, PUT | `/api/usuarios` | Gestión de usuarios (solo administrador) |
| GET, POST, PUT, DELETE | `/api/fincas` | CRUD de fincas |
| POST | `/api/vales/extraer` | Foto → datos leídos (no guarda) |
| POST | `/api/vales` | Guarda un vale revisado (con `finca_id` y foto opcional) |
| GET | `/api/vales` | Lista con filtros: `finca_id`, `usuario_id` (admin), `desde`, `hasta`, `kg_min`, `kg_max`, `q` |
| GET | `/api/vales/:id/imagen` | Foto del vale |
| DELETE | `/api/vales/:id` | Borra un vale y su foto |

## Seguridad

- Contraseñas con scrypt y sesión en cookie firmada (HttpOnly, SameSite=Lax y Secure en producción). Máximo 10 intentos fallidos de login cada 15 minutos.
- Cada consulta se limita a las fincas del usuario; un usuario no puede ver ni tocar datos de otro.
- Revisa siempre los datos antes de guardar: una IA puede equivocarse con letra manuscrita o fotos movidas.
