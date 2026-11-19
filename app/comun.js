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
  el.textContent = mensaje;
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
