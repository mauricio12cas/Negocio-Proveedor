// Utilidades compartidas por la pantalla del cliente y el panel de administración.

const ZONA_HORARIA = 'America/Mexico_City';

const UNIDADES = {
  pieza: 'pieza', kilo: 'kg', litro: 'litro', caja: 'caja',
  costal: 'costal', bulto: 'bulto', paquete: 'paquete',
};

const ESTADOS = {
  recibido:   'Recibido',
  confirmado: 'Confirmado',
  en_ruta:    'En ruta',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
};

/** Escapa texto para insertarlo en HTML. Úsalo con TODO dato que venga de la base. */
function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Fecha de hoy (AAAA-MM-DD) en la Ciudad de México, sin importar la zona del dispositivo. */
function hoyMX() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date());
}

function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fechaLarga(iso, conAnio = false) {
  const opciones = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
  if (conAnio) opciones.year = 'numeric';
  const texto = new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', opciones);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function fechaCorta(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

const FORMATO_DINERO = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** $1,234.50 */
function dinero(n) {
  return FORMATO_DINERO.format(Number(n) || 0);
}

/** Margen sobre el precio de venta, en %. null si falta el costo o el precio. */
function margen(precio, costo) {
  precio = Number(precio);
  if (costo === null || costo === undefined || costo === '' || !precio) return null;
  return ((precio - Number(costo)) / precio) * 100;
}

function textoPresentacion(p) {
  return [p.presentacion, p.unidad ? `(${UNIDADES[p.unidad] || p.unidad})` : ''].filter(Boolean).join(' ');
}

/** Crea el cliente de Supabase o devuelve null si config.js no está llenado. */
function conectarSupabase() {
  const c = window.CONFIG || {};
  if (!c.SUPABASE_URL || c.SUPABASE_URL.includes('TU-PROYECTO') || !c.SUPABASE_ANON_KEY || c.SUPABASE_ANON_KEY === 'TU_ANON_KEY') {
    return null;
  }
  return window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
}

function mostrarToast(mensaje, tipo = '') {
  const el = document.getElementById('toast');
  el.innerHTML = `${icono(tipo === 'error' ? 'alerta' : 'check-circulo')}<span>${esc(mensaje)}</span>`;
  el.setAttribute('role', 'status');
  el.className = `toast visible ${tipo}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 3500);
}

/** Mensaje legible a partir de un error de Supabase. */
function mensajeError(error, porDefecto = 'Ocurrió un error. Intenta de nuevo.') {
  if (!error) return porDefecto;
  if (error.message && !/^(TypeError|Failed to fetch)/.test(error.message)) return error.message;
  return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
}

/** <svg> de un ícono del sprite iconos.svg. */
function icono(nombre, clase = '') {
  return `<svg class="ico ${clase}" aria-hidden="true"><use href="iconos.svg#${nombre}"/></svg>`;
}

/** Estado vacío con ícono, título, texto y (opcional) un botón. */
function estadoVacio(nombreIcono, titulo, texto = '', accion = '') {
  return `<div class="vacio"><div class="vacio-icono">${icono(nombreIcono, 'grande')}</div>
    <h3>${esc(titulo)}</h3>${texto ? `<p>${esc(texto)}</p>` : ''}${accion}</div>`;
}

/** Barras grises animadas mientras carga. */
function esqueleto(filas = 3, alto = 18) {
  return `<div class="esqueletos" aria-label="Cargando">${Array.from({ length: filas },
    (_, i) => `<div class="esqueleto" style="height:${alto}px;width:${[100, 86, 94, 72][i % 4]}%"></div>`).join('')}</div>`;
}

const COLOR_PREDETERMINADO = '#0f766e';

/** Negro o blanco, el que contraste más con el color dado. */
function textoSobre(hex) {
  const canal = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#0f172a' : '#ffffff';
}

function iniciales(nombre) {
  const palabras = String(nombre || 'P').trim().split(/\s+/).filter(Boolean);
  return (palabras.length > 1 ? palabras[0][0] + palabras[1][0] : palabras[0].slice(0, 2)).toUpperCase();
}

/** Aplica el color y el logo del negocio a toda la página. */
function aplicarMarca({ color, logo, nombre } = {}) {
  const c = /^#[0-9a-f]{6}$/i.test(color || '') ? color : COLOR_PREDETERMINADO;
  document.documentElement.style.setProperty('--acento', c);
  document.documentElement.style.setProperty('--acento-texto', textoSobre(c));
  const conLogo = typeof logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(logo);
  document.querySelectorAll('[data-marca-logo]').forEach((el) => {
    el.innerHTML = conLogo ? `<img src="${esc(logo)}" alt="">` : `<span class="monograma">${esc(iniciales(nombre))}</span>`;
  });
  document.querySelectorAll('[data-marca-nombre]').forEach((el) => (el.textContent = nombre || 'PROVEEDOR'));
}

/** Tema claro/oscuro/sistema guardado en este navegador. */
function temaGuardado() {
  try { return localStorage.getItem('tema') || 'sistema'; } catch { return 'sistema'; }
}
function aplicarTema(modo) {
  if (modo === 'claro' || modo === 'oscuro') document.documentElement.dataset.tema = modo;
  else delete document.documentElement.dataset.tema;
  try { localStorage.setItem('tema', modo); } catch { /* sin almacenamiento */ }
}
function temaEfectivo() {
  const t = document.documentElement.dataset.tema;
  if (t) return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

/** Variación porcentual; null si no hay base para comparar. */
function variacion(actual, anterior) {
  actual = Number(actual) || 0;
  anterior = Number(anterior) || 0;
  if (!anterior) return null;
  return ((actual - anterior) / anterior) * 100;
}

/** «MIL DOSCIENTOS OCHENTA Y UN PESOS 00/100 M.N.» */
function numeroALetras(monto) {
  const UNI = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
    'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
    'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  const menorMil = (n) => {
    if (n === 100) return 'CIEN';
    const r = n % 100;
    const decenas = r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNI[r % 10]}` : '');
    return [CEN[Math.floor(n / 100)], decenas].filter(Boolean).join(' ');
  };
  const enteros = (n) => {
    if (n === 0) return 'CERO';
    const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000;
    return [
      millones ? (millones === 1 ? 'UN MILLÓN' : `${enteros(millones)} MILLONES`) : '',
      miles ? (miles === 1 ? 'MIL' : `${menorMil(miles)} MIL`) : '',
      resto ? menorMil(resto) : '',
    ].filter(Boolean).join(' ');
  };
  const centavosTotales = Math.round(Math.abs(Number(monto) || 0) * 100);
  const pesos = Math.floor(centavosTotales / 100);
  const centavos = String(centavosTotales % 100).padStart(2, '0');
  const de = pesos >= 1e6 && pesos % 1e6 === 0 ? ' DE' : '';
  return `${enteros(pesos)}${de} ${pesos === 1 ? 'PESO' : 'PESOS'} ${centavos}/100 M.N.`;
}

/** R-000123 */
const folioRemision = (folio) => `R-${String(folio).padStart(6, '0')}`;
