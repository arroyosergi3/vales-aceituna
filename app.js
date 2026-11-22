/* Controlador del front: navegación, registro de vales (foto -> IA -> revisión -> guardar) y listado con filtros */

const $ = (sel, el = document) => el.querySelector(sel);
const fmtKg = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const fmtFecha = (iso) => iso.split('-').reverse().join('/');
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opciones) {
  const resp = await fetch(url, opciones);
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(datos.error || 'Error del servidor');
  return datos;
}

let temporizadorAviso;
function avisar(mensaje, esError = false) {
  const el = $('#aviso');
  el.textContent = mensaje;
  el.classList.toggle('error', esError);
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (el.hidden = true), 4000);
}

/* ---------- navegación por pestañas (hash) ---------- */
function mostrarVista() {
  const vista = location.hash === '#registros' ? 'registros' : 'registrar';
  document.querySelectorAll('.vista').forEach((s) => (s.hidden = s.id !== `vista-${vista}`));
  document.querySelectorAll('.pestanas a').forEach((a) => {
    if (a.dataset.vista === vista) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (vista === 'registros') cargarRegistros();
}
window.addEventListener('hashchange', mostrarVista);

/* ---------- catálogo (parcelas y propietarios ya existentes) ---------- */
async function cargarCatalogo() {
  const { parcelas, propietarios } = await api('/api/catalogo');
  const opciones = (lista) => lista.map((n) => `<option value="${escapar(n)}">`).join('');
  $('#listaParcelas').innerHTML = opciones(parcelas);
  $('#listaPropietarios').innerHTML = opciones(propietarios);

  const rellenar = (select, lista, todos) => {
    const actual = select.value;
    select.innerHTML = `<option value="">${todos}</option>` + lista.map((n) => `<option>${escapar(n)}</option>`).join('');
    select.value = lista.includes(actual) ? actual : '';
  };
  rellenar($('#filtros [name=parcela]'), parcelas, 'Todas');
  rellenar($('#filtros [name=propietario]'), propietarios, 'Todos');
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

inputFoto.addEventListener('change', () => {
  ficheroElegido = inputFoto.files[0] || null;
  if (!ficheroElegido) return;
  const previa = $('#previaFoto');
  previa.src = URL.createObjectURL(ficheroElegido);
  previa.hidden = false;
  $('#textoFoto').hidden = true;
  $('#zonaFoto').classList.add('tiene-foto');
  btnLeer.disabled = false;
  ponerEstado('');
});

function mostrarFormulario(datos = {}, imagen = '', desdeIA = false) {
  form.reset();
  form.hidden = false;
  form.elements.imagen.value = imagen;
  for (const campo of ['fecha', 'numero_vale', 'propietario', 'parcela', 'kg', 'rendimiento', 'variedad', 'observaciones']) {
    form.elements[campo].value = datos[campo] ?? '';
    // Los campos que la IA no ha podido leer se resaltan para que se rellenen a mano
    form.elements[campo].parentElement.classList.toggle('dudoso', desdeIA && ['fecha', 'propietario', 'parcela', 'kg'].includes(campo) && datos[campo] == null);
  }
  $('#ayudaForm').textContent = desdeIA
    ? 'Comprueba cada dato con la foto antes de guardar. Los campos resaltados no se han podido leer.'
    : 'Rellena los datos del vale.';
  form.elements.fecha.focus();
}

btnLeer.addEventListener('click', async () => {
  if (!ficheroElegido) return;
  btnLeer.disabled = true;
  ponerEstado('Leyendo el vale…');
  try {
    const cuerpo = new FormData();
    cuerpo.append('imagen', ficheroElegido);
    const { datos, imagen } = await api('/api/vales/extraer', { method: 'POST', body: cuerpo });
    mostrarFormulario(datos, imagen, true);
    ponerEstado('');
  } catch (e) {
    ponerEstado(`${e.message}. Puedes reintentarlo o rellenar los datos a mano.`, true);
  } finally {
    btnLeer.disabled = false;
  }
});

$('#btnManual').addEventListener('click', () => mostrarFormulario({}, '', false));

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
  const cuerpo = Object.fromEntries(new FormData(form));
  try {
    await api('/api/vales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    avisar(`Vale guardado: ${fmtKg.format(cuerpo.kg)} kg de ${cuerpo.parcela}`);
    reiniciarRegistro();
    cargarCatalogo();
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
    const { vales, total, porParcela, porPropietario } = await api(`/api/vales?${parametros()}`);

    $('#resumen').innerHTML =
      `<div><strong>${fmtKg.format(total.kg)}</strong><span>kg en total</span></div>` +
      `<div><strong>${total.vales}</strong><span>${total.vales === 1 ? 'vale' : 'vales'}</span></div>`;

    pintarBarras('#porParcela', porParcela, 'parcela');
    pintarBarras('#porPropietario', porPropietario, 'propietario');

    $('#filas').innerHTML = vales.map((v) => `
      <tr>
        <td>${fmtFecha(v.fecha)}</td>
        <td>${escapar(v.numero_vale) || '—'}</td>
        <td>${escapar(v.parcela)}</td>
        <td>${escapar(v.propietario)}</td>
        <td>${escapar(v.variedad) || '—'}</td>
        <td class="num">${fmtKg.format(v.kg)}</td>
        <td class="num">${v.rendimiento != null ? fmtKg.format(v.rendimiento) : '—'}</td>
        <td><div class="acc">
          ${v.imagen ? `<a href="/uploads/${encodeURIComponent(v.imagen)}" target="_blank" rel="noopener">Ver foto</a>` : ''}
          <button type="button" class="borrar" data-id="${v.id}" data-desc="${escapar(`${fmtFecha(v.fecha)} · ${v.parcela} · ${fmtKg.format(v.kg)} kg`)}">Borrar</button>
        </div></td>
      </tr>`).join('');
    $('#sinResultados').hidden = vales.length > 0;
  } catch (e) {
    avisar(e.message, true);
  }
}

// Cada fila del desglose es un botón que filtra por esa parcela o propietario
function pintarBarras(selector, filas, campo) {
  const max = Math.max(...filas.map((f) => f.kg), 1);
  $(selector).innerHTML = filas.map((f) => `
    <li>
      <button type="button" data-campo="${campo}" data-valor="${escapar(f.nombre)}" title="Filtrar por ${escapar(f.nombre)}">${escapar(f.nombre)}</button>
      <span class="pista"><i style="width:${(f.kg / max) * 100}%"></i></span>
      <span>${fmtKg.format(f.kg)} kg</span>
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
    await cargarCatalogo();
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

/* ---------- arranque ---------- */
cargarCatalogo().catch((e) => avisar(e.message, true));
mostrarVista();
