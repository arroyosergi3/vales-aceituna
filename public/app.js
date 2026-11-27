/* Controlador del front: sesión, fincas, usuarios, registro de vales (foto -> IA -> revisión -> guardar) y listado con filtros */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const fmtFecha = (iso) => iso.split('-').reverse().join('/');
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const celda = (v) => escapar(v) || '—';
const numeroOGuion = (v) => (v == null ? '—' : fmt.format(v));
const ico = (nombre) => `<svg class="icono" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;

let usuario = null; // sesión actual
let fincas = [];    // fincas que puede ver el usuario
let usuarios = [];  // solo administrador
const esAdmin = () => usuario?.rol === 'admin';

/* ---------- utilidades ---------- */
async function api(url, opciones) {
  const resp = await fetch(url, opciones);
  const datos = await resp.json().catch(() => ({}));
  if (resp.status === 401 && !url.startsWith('/api/auth/login')) {
    mostrarLogin();
    throw new Error('Tu sesión ha caducado. Entra de nuevo.');
  }
  if (!resp.ok) throw new Error(datos.error || 'Error del servidor');
  return datos;
}
const enviarJSON = (metodo, cuerpo) => ({ method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

let temporizadorAviso;
function avisar(mensaje, esError = false) {
  const el = $('#aviso');
  el.textContent = mensaje;
  el.classList.toggle('error', esError);
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (el.hidden = true), 4000);
}

document.addEventListener('click', (ev) => {
  if (ev.target.matches('[data-cerrar]')) ev.target.closest('dialog').close();
});

/* ---------- sesión ---------- */
function mostrarLogin() {
  usuario = null;
  $('#app').hidden = true;
  $('#pantallaLogin').hidden = false;
  cambiarModo(false);
}

async function entrar() {
  $('#pantallaLogin').hidden = true;
  $('#app').hidden = false;
  $('#nombreUsuario').textContent = usuario.nombre;
  $$('.solo-admin').forEach((el) => (el.hidden = !esAdmin()));
  if (esAdmin()) await cargarUsuarios(false);
  await cargarFincas();
  mostrarVista();
}

let config = { registro: false, requiereCodigo: false };

async function cargarConfig() {
  try {
    config = await api('/api/auth/config');
  } catch {
    /* si falla, se muestra solo "Entrar" */
  }
  $('.selector').hidden = !config.registro;
  $('#campoCodigo').hidden = !config.requiereCodigo;
  $('#formRegistro').elements.codigo.required = config.requiereCodigo;
}

// Alterna entre "Entrar" y "Crear cuenta"
function cambiarModo(registro) {
  $('#formLogin').hidden = registro;
  $('#formRegistro').hidden = !registro;
  $('#modoEntrar').setAttribute('aria-pressed', String(!registro));
  $('#modoRegistro').setAttribute('aria-pressed', String(registro));
  $('#errorLogin').textContent = '';
  $('#errorRegistro').textContent = '';
  (registro ? $('#formRegistro').elements.nombre : $('#formLogin').elements.email).focus();
}
$('#modoEntrar').addEventListener('click', () => cambiarModo(false));
$('#modoRegistro').addEventListener('click', () => cambiarModo(true));

$('#formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  $('#errorLogin').textContent = '';
  try {
    usuario = await api('/api/auth/login', enviarJSON('POST', { email: f.email.value, password: f.password.value }));
    f.reset();
    await entrar();
  } catch (e) {
    $('#errorLogin').textContent = e.message;
  }
});

$('#formRegistro').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  $('#errorRegistro').textContent = '';
  if (!f.reportValidity()) return;
  if (f.password.value !== f.repetir.value) {
    $('#errorRegistro').textContent = 'Las contraseñas no coinciden';
    return;
  }
  try {
    usuario = await api('/api/auth/registro', enviarJSON('POST', {
      nombre: f.nombre.value, email: f.email.value, password: f.password.value, codigo: f.codigo.value,
    }));
    f.reset();
    await entrar();
    avisar(`Cuenta creada. Bienvenido, ${usuario.nombre}`);
  } catch (e) {
    $('#errorRegistro').textContent = e.message;
  }
});

$('#btnSalir').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.hash = '';
  mostrarLogin();
});

$('#btnPassword').addEventListener('click', () => {
  $('#formPassword').reset();
  $('#errorPassword').textContent = '';
  $('#dlgPassword').showModal();
});

$('#formPassword').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (!f.reportValidity()) return;
  if (f.nueva.value !== f.repetir.value) {
    $('#errorPassword').textContent = 'Las contraseñas nuevas no coinciden';
    return;
  }
  try {
    await api('/api/auth/password', enviarJSON('POST', { actual: f.actual.value, nueva: f.nueva.value }));
    $('#dlgPassword').close();
    avisar('Contraseña cambiada');
  } catch (e) {
    $('#errorPassword').textContent = e.message;
  }
});

/* ---------- navegación por pestañas (hash) ---------- */
const VISTAS = ['registrar', 'registros', 'fincas', 'usuarios'];

function mostrarVista() {
  let vista = location.hash.slice(1);
  if (!VISTAS.includes(vista) || (vista === 'usuarios' && !esAdmin())) vista = 'registrar';
  $$('.vista').forEach((s) => (s.hidden = s.id !== `vista-${vista}`));
  $$('.pestanas a').forEach((a) => {
    if (a.dataset.vista === vista) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (vista === 'registros') cargarRegistros();
  if (vista === 'fincas') pintarFincas();
  if (vista === 'usuarios') cargarUsuarios();
}
window.addEventListener('hashchange', () => usuario && mostrarVista());

/* ---------- fincas: datos compartidos ---------- */
const nombreFinca = (f) => (f.alias ? `${f.nombre} (${f.alias})` : f.nombre);
const referenciaFinca = (f) => [f.poligono && `Pol. ${f.poligono}`, f.parcela && `Parc. ${f.parcela}`].filter(Boolean).join(' · ');
const etiquetaFinca = (f) => [nombreFinca(f), referenciaFinca(f), esAdmin() && f.usuario].filter(Boolean).join(' · ');

async function cargarFincas() {
  fincas = await api('/api/fincas');
  const opciones = fincas.map((f) => `<option value="${f.id}">${escapar(etiquetaFinca(f))}</option>`).join('');

  const selVale = $('#formVale [name=finca_id]');
  const actualVale = selVale.value;
  selVale.innerHTML = `<option value="">Elige la finca…</option>${opciones}`;
  selVale.value = actualVale;

  const selFiltro = $('#filtros [name=finca_id]');
  const actualFiltro = selFiltro.value;
  selFiltro.innerHTML = `<option value="">Todas</option>${opciones}`;
  selFiltro.value = actualFiltro;

  $('#avisoSinFincas').hidden = fincas.length > 0;
}

/* ---------- registrar vale ---------- */
const form = $('#formVale');
const inputFoto = $('#inputFoto');
const btnLeer = $('#btnLeer');
const estado = $('#estadoLectura');
let ficheroElegido = null;

function ponerEstado(texto, esError = false) {
  estado.textContent = texto;
  estado.classList.toggle('error', esError);
}

// Reduce la foto antes de subirla: va más rápido a la IA y ocupa mucho menos en la base de datos
async function reducirImagen(fichero, ladoMax = 1800) {
  try {
    const bitmap = await createImageBitmap(fichero);
    const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(bitmap.width * escala);
    lienzo.height = Math.round(bitmap.height * escala);
    lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'vale.jpg', { type: 'image/jpeg' }) : fichero;
  } catch {
    return fichero; // formato que el navegador no sabe leer: se sube tal cual
  }
}

inputFoto.addEventListener('change', async () => {
  const original = inputFoto.files[0];
  if (!original) return;
  ponerEstado('Preparando la foto…');
  ficheroElegido = await reducirImagen(original);
  const previa = $('#previaFoto');
  previa.src = URL.createObjectURL(ficheroElegido);
  previa.hidden = false;
  $('#textoFoto').hidden = true;
  $('#zonaFoto').classList.add('tiene-foto');
  btnLeer.disabled = false;
  ponerEstado('');
});

function mostrarFormulario(datos = {}, desdeIA = false) {
  form.reset();
  form.hidden = false;
  for (const campo of ['fecha', 'numero_vale', 'kg', 'rendimiento', 'variedad', 'observaciones']) {
    form.elements[campo].value = datos[campo] ?? '';
  }

  // La IA lee la parcela del vale como texto. Si coincide con una sola finca se propone;
  // si no, se deja vacío para que el usuario elija a qué finca pertenece.
  const pista = $('#pistaFinca');
  let sugerida = null;
  if (datos.parcela) {
    const buscado = sinAcentos(datos.parcela);
    const coincidencias = fincas.filter((f) => [f.nombre, f.alias, f.parcela].some((v) => v && sinAcentos(v) === buscado));
    if (coincidencias.length === 1) sugerida = coincidencias[0];
    pista.textContent = `El vale indica «${datos.parcela}». ` + (sugerida ? 'He propuesto la finca que coincide; compruébala.' : 'Elige la finca a la que pertenece.');
  } else {
    pista.textContent = '';
  }
  form.elements.finca_id.value = sugerida ? sugerida.id : '';

  // Los campos que la IA no ha podido leer se resaltan para que se rellenen a mano
  for (const campo of ['finca_id', 'fecha', 'kg']) {
    form.elements[campo].parentElement.classList.toggle('dudoso', desdeIA && !form.elements[campo].value);
  }
  $('#ayudaForm').textContent = desdeIA
    ? 'Comprueba cada dato con la foto antes de guardar. Los campos resaltados hay que revisarlos.'
    : 'Rellena los datos del vale.';
  form.elements.finca_id.focus();
}

btnLeer.addEventListener('click', async () => {
  if (!ficheroElegido) return;
  btnLeer.disabled = true;
  ponerEstado('Leyendo el vale…');
  try {
    const cuerpo = new FormData();
    cuerpo.append('imagen', ficheroElegido);
    const { datos } = await api('/api/vales/extraer', { method: 'POST', body: cuerpo });
    mostrarFormulario(datos, true);
    ponerEstado('');
  } catch (e) {
    ponerEstado(`${e.message}. Puedes reintentarlo o rellenar los datos a mano.`, true);
  } finally {
    btnLeer.disabled = false;
  }
});

$('#btnManual').addEventListener('click', () => mostrarFormulario({}, false));

function reiniciarRegistro() {
  form.reset();
  form.hidden = true;
  inputFoto.value = '';
  ficheroElegido = null;
  $('#previaFoto').hidden = true;
  $('#previaFoto').removeAttribute('src');
  $('#textoFoto').hidden = false;
  $('#zonaFoto').classList.remove('tiene-foto');
  btnLeer.disabled = true;
  ponerEstado('');
}
$('#btnDescartar').addEventListener('click', reiniciarRegistro);

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!form.reportValidity()) return;
  const cuerpo = new FormData(form);
  if (ficheroElegido) cuerpo.append('imagen', ficheroElegido);
  const finca = fincas.find((f) => String(f.id) === form.elements.finca_id.value);
  const mensaje = `Vale guardado: ${fmt.format(Number(form.elements.kg.value))} kg en ${finca ? finca.nombre : 'la finca'}`;
  try {
    await api('/api/vales', { method: 'POST', body: cuerpo });
    avisar(mensaje);
    reiniciarRegistro();
  } catch (e) {
    avisar(e.message, true);
  }
});

/* ---------- registros con filtros ---------- */
const filtros = $('#filtros');

function parametros() {
  const p = new URLSearchParams();
  for (const [k, v] of new FormData(filtros)) if (String(v).trim() !== '') p.set(k, v);
  return p;
}

async function cargarRegistros() {
  try {
    const { vales, total, porFinca, porUsuario } = await api(`/api/vales?${parametros()}`);

    $('#resumen').innerHTML =
      `<div><strong>${fmt.format(total.kg)}</strong><span>kg en total</span></div>` +
      `<div><strong>${total.vales}</strong><span>${total.vales === 1 ? 'vale' : 'vales'}</span></div>`;

    pintarBarras('#porFinca', porFinca.map((f) => ({ ...f, nombre: nombreFinca(f) })), 'finca_id');
    pintarBarras('#porUsuario', porUsuario, 'usuario_id');

    $('#filas').innerHTML = vales.map((v) => `
      <tr>
        <td>${fmtFecha(v.fecha)}</td>
        <td>${celda(v.numero_vale)}</td>
        <td>${escapar(nombreFinca({ nombre: v.finca, alias: v.alias }))}</td>
        ${esAdmin() ? `<td>${escapar(v.usuario)}</td>` : ''}
        <td>${celda(v.variedad)}</td>
        <td class="num">${fmt.format(v.kg)}</td>
        <td class="num">${numeroOGuion(v.rendimiento)}</td>
        <td><div class="acc">
          ${v.tiene_imagen ? `<a class="boton pequeno" href="/api/vales/${v.id}/imagen" target="_blank" rel="noopener">${ico('imagen')} Ver foto</a>` : ''}
          <button type="button" class="boton pequeno peligro borrar" data-id="${v.id}" data-desc="${escapar(`${fmtFecha(v.fecha)} · ${v.finca} · ${fmt.format(v.kg)} kg`)}">${ico('papelera')} Borrar</button>
        </div></td>
      </tr>`).join('');
    $('#sinResultados').hidden = vales.length > 0;
  } catch (e) {
    avisar(e.message, true);
  }
}

// Cada fila del desglose es un botón que filtra por esa finca o usuario
function pintarBarras(selector, filas, campo) {
  const max = Math.max(...filas.map((f) => f.kg), 1);
  $(selector).innerHTML = filas.map((f) => `
    <li>
      <button type="button" class="filtro-barra" data-campo="${campo}" data-valor="${f.id}" title="Filtrar por ${escapar(f.nombre)}">${ico('filtro')}<span>${escapar(f.nombre)}</span></button>
      <span class="pista-barra"><i style="width:${(f.kg / max) * 100}%"></i></span>
      <span>${fmt.format(f.kg)} kg</span>
    </li>`).join('');
}

document.addEventListener('click', (ev) => {
  const barra = ev.target.closest('.barras button');
  if (barra) {
    filtros.elements[barra.dataset.campo].value = barra.dataset.valor;
    cargarRegistros();
  }
});

$('#filas').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.borrar');
  if (!btn || !confirm(`¿Borrar el vale ${btn.dataset.desc}? No se puede deshacer.`)) return;
  try {
    await api(`/api/vales/${btn.dataset.id}`, { method: 'DELETE' });
    avisar('Vale borrado');
    await cargarFincas();
    cargarRegistros();
  } catch (e) {
    avisar(e.message, true);
  }
});

let esperaBusqueda;
filtros.addEventListener('input', (ev) => {
  clearTimeout(esperaBusqueda);
  // Los campos de texto/número esperan un momento; los desplegables y fechas filtran al instante
  esperaBusqueda = setTimeout(cargarRegistros, ev.target.matches('select, [type=date]') ? 0 : 350);
});
filtros.addEventListener('submit', (ev) => ev.preventDefault());
filtros.addEventListener('reset', () => setTimeout(cargarRegistros, 0));

/* ---------- CRUD de fincas ---------- */
async function pintarFincas() {
  try {
    await cargarFincas();
  } catch (e) {
    avisar(e.message, true);
    return;
  }
  $('#filasFincas').innerHTML = fincas.map((f) => `
    <tr>
      <td>${escapar(f.nombre)}</td>
      <td>${celda(f.alias)}</td>
      <td class="num">${numeroOGuion(f.superficie)}</td>
      <td>${celda(f.poligono)}</td>
      <td>${celda(f.parcela)}</td>
      <td class="num">${numeroOGuion(f.olivos)}</td>
      <td>${celda(f.variedad)}</td>
      ${esAdmin() ? `<td>${escapar(f.usuario)}</td>` : ''}
      <td class="num">${fmt.format(f.kg)}</td>
      <td><div class="acc">
        <button type="button" class="boton pequeno" data-accion="editar" data-id="${f.id}">${ico('lapiz')} Editar</button>
        <button type="button" class="boton pequeno peligro borrar" data-accion="borrar" data-id="${f.id}">${ico('papelera')} Borrar</button>
      </div></td>
    </tr>`).join('');
  $('#sinFincas').hidden = fincas.length > 0;
}

async function abrirFinca(finca = null) {
  const f = $('#formFinca');
  f.reset();
  $('#errorFinca').textContent = '';
  $('#tituloFinca').textContent = finca ? 'Editar finca' : 'Nueva finca';

  if (esAdmin()) {
    const lista = await cargarUsuarios(false);
    f.elements.usuario_id.innerHTML = lista.filter((u) => u.activo || (finca && u.id === finca.usuario_id))
      .map((u) => `<option value="${u.id}">${escapar(u.nombre)}</option>`).join('');
    f.elements.usuario_id.value = finca ? finca.usuario_id : usuario.id;
  }
  if (finca) {
    for (const campo of ['id', 'nombre', 'alias', 'superficie', 'olivos', 'poligono', 'parcela', 'variedad']) f.elements[campo].value = finca[campo] ?? '';
  }
  $('#dlgFinca').showModal();
  f.elements.nombre.focus();
}

$('#btnNuevaFinca').addEventListener('click', () => abrirFinca().catch((e) => avisar(e.message, true)));

$('#filasFincas').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-accion]');
  if (!btn) return;
  const finca = fincas.find((f) => String(f.id) === btn.dataset.id);
  if (!finca) return;
  if (btn.dataset.accion === 'editar') {
    abrirFinca(finca).catch((e) => avisar(e.message, true));
  } else if (confirm(`¿Borrar la finca «${finca.nombre}»? No se puede deshacer.`)) {
    try {
      await api(`/api/fincas/${finca.id}`, { method: 'DELETE' });
      avisar('Finca borrada');
      pintarFincas();
    } catch (e) {
      avisar(e.message, true);
    }
  }
});

$('#formFinca').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (!f.reportValidity()) return;
  const cuerpo = Object.fromEntries(new FormData(f));
  const id = cuerpo.id;
  delete cuerpo.id;
  try {
    await api(id ? `/api/fincas/${id}` : '/api/fincas', enviarJSON(id ? 'PUT' : 'POST', cuerpo));
    $('#dlgFinca').close();
    avisar(id ? 'Finca actualizada' : 'Finca creada');
    pintarFincas();
  } catch (e) {
    $('#errorFinca').textContent = e.message;
  }
});

/* ---------- usuarios (solo administrador) ---------- */
async function cargarUsuarios(pintar = true) {
  usuarios = await api('/api/usuarios');
  const selFiltro = $('#filtros [name=usuario_id]');
  const actual = selFiltro.value;
  selFiltro.innerHTML = '<option value="">Todos</option>' + usuarios.map((u) => `<option value="${u.id}">${escapar(u.nombre)}</option>`).join('');
  selFiltro.value = actual;

  if (pintar) {
    $('#filasUsuarios').innerHTML = usuarios.map((u) => `
      <tr>
        <td>${escapar(u.nombre)}</td>
        <td>${escapar(u.email)}</td>
        <td>${u.rol === 'admin' ? 'Administrador' : 'Usuario'}</td>
        <td><span class="etiqueta ${u.activo ? '' : 'apagada'}">${u.activo ? 'Activo' : 'Desactivado'}</span></td>
        <td class="num">${u.fincas}</td>
        <td><div class="acc"><button type="button" class="boton pequeno" data-id="${u.id}">${ico('lapiz')} Editar</button></div></td>
      </tr>`).join('');
  }
  return usuarios;
}

function abrirUsuario(u = null) {
  const f = $('#formUsuario');
  f.reset();
  $('#errorUsuario').textContent = '';
  $('#tituloUsuario').textContent = u ? 'Editar usuario' : 'Nuevo usuario';
  $('#etiquetaPassword').textContent = u ? 'Contraseña nueva (déjala vacía para no cambiarla)' : 'Contraseña (mínimo 8 caracteres)';
  f.elements.password.required = !u;
  f.elements.email.disabled = Boolean(u);
  if (u) {
    f.elements.id.value = u.id;
    f.elements.nombre.value = u.nombre;
    f.elements.email.value = u.email;
    f.elements.rol.value = u.rol;
    f.elements.activo.checked = u.activo;
  }
  $('#dlgUsuario').showModal();
  f.elements.nombre.focus();
}

$('#btnNuevoUsuario').addEventListener('click', () => abrirUsuario());
$('#filasUsuarios').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-id]');
  const u = btn && usuarios.find((x) => String(x.id) === btn.dataset.id);
  if (u) abrirUsuario(u);
});

$('#formUsuario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (!f.reportValidity()) return;
  const id = f.elements.id.value;
  const cuerpo = { nombre: f.elements.nombre.value, rol: f.elements.rol.value, activo: f.elements.activo.checked };
  if (f.elements.password.value) cuerpo.password = f.elements.password.value;
  if (!id) cuerpo.email = f.elements.email.value;
  try {
    await api(id ? `/api/usuarios/${id}` : '/api/usuarios', enviarJSON(id ? 'PUT' : 'POST', cuerpo));
    $('#dlgUsuario').close();
    avisar(id ? 'Usuario actualizado' : 'Usuario creado');
    cargarUsuarios();
  } catch (e) {
    $('#errorUsuario').textContent = e.message;
  }
});

/* ---------- arranque ---------- */
(async () => {
  await cargarConfig();
  try {
    usuario = await api('/api/auth/yo');
    await entrar();
  } catch {
    mostrarLogin();
  }
})();
