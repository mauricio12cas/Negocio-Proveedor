// Utilidades compartidas por la pantalla del cliente, el panel y la remisión.
import { createClient } from '@supabase/supabase-js';

export const ZONA_HORARIA = 'America/Mexico_City';
export const COLOR_PREDETERMINADO = '#0f766e';

export const UNIDADES = {
  pieza: 'pieza', kilo: 'kg', litro: 'litro', caja: 'caja',
  costal: 'costal', bulto: 'bulto', paquete: 'paquete',
};

export const ESTADOS = {
  recibido: 'Recibido',
  confirmado: 'Confirmado',
  en_ruta: 'En ruta',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

/** Color de <Tag> de antd para cada estado. */
export const COLOR_ESTADO = {
  recibido: 'gold', confirmado: 'blue', en_ruta: 'purple', entregado: 'green', cancelado: 'red',
};

/** Cliente de Supabase con los datos de config.js, o null si falta configurarlo. */
export const db = (() => {
  if (typeof window === 'undefined') return null;
  const c = window.CONFIG || {};
  if (!c.SUPABASE_URL || c.SUPABASE_URL.includes('TU-PROYECTO') || !c.SUPABASE_ANON_KEY || c.SUPABASE_ANON_KEY === 'TU_ANON_KEY') return null;
  return createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
})();

/** Fecha de hoy (AAAA-MM-DD) en la Ciudad de México, sin importar la zona del dispositivo. */
export function hoyMX() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date());
}

export function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fechaLarga(iso, conAnio = false) {
  const opciones = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
  if (conAnio) opciones.year = 'numeric';
  const texto = new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', opciones);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function fechaCorta(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  }).replace(/\./g, '');
}

export function fechaHora(ts) {
  return new Date(ts).toLocaleString('es-MX', { timeZone: ZONA_HORARIA, dateStyle: 'short', timeStyle: 'short' });
}

const FORMATO_DINERO = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
/** $1,234.50 */
export const dinero = (n) => FORMATO_DINERO.format(Number(n) || 0);
const FORMATO_COMPACTO = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', notation: 'compact', maximumFractionDigits: 1 });
export const dineroCompacto = (n) => FORMATO_COMPACTO.format(Number(n) || 0);

/** Convierte texto como «$1,250.50» en número; null si no es número. */
export function numero(v) {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Margen sobre el precio de venta, en %. null si falta el costo o el precio. */
export function margen(precio, costo) {
  precio = Number(precio);
  if (costo === null || costo === undefined || costo === '' || !precio) return null;
  return ((precio - Number(costo)) / precio) * 100;
}
export const textoMargen = (m) => (m === null ? '—' : `${m.toFixed(1)} %`);

/** Productos que se venden a granel (cantidades con decimales). */
export const esGranel = (unidad) => unidad === 'kilo' || unidad === 'litro';

const FORMATO_CANTIDAD = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });
const PLURAL_UNIDAD = { pieza: 'piezas', caja: 'cajas', costal: 'costales', bulto: 'bultos', paquete: 'paquetes', litro: 'litros' };
/** «2.5 kg», «3 cajas», «1 costal»; sin unidad si no se indica. */
export function textoCantidad(cantidad, unidad) {
  const n = Number(cantidad) || 0;
  const texto = FORMATO_CANTIDAD.format(n);
  if (!unidad) return texto;
  if (unidad === 'kilo') return `${texto} kg`;
  return `${texto} ${n === 1 ? (UNIDADES[unidad] || unidad) : (PLURAL_UNIDAD[unidad] || UNIDADES[unidad] || unidad)}`;
}

/** Redondea según el producto: 3 decimales a granel, entero en lo demás (0 a 999). */
export function ajustarCantidad(valor, unidad) {
  const n = Math.max(0, Math.min(999, Number(valor) || 0));
  return esGranel(unidad) ? Math.round(n * 1000) / 1000 : Math.round(n);
}

export function textoPresentacion(p) {
  return [p.presentacion, p.unidad ? `(${UNIDADES[p.unidad] || p.unidad})` : ''].filter(Boolean).join(' ');
}

export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Mensaje legible a partir de un error de Supabase. */
export function mensajeError(error, porDefecto = 'Ocurrió un error. Intenta de nuevo.') {
  if (!error) return porDefecto;
  if (error.message && !/^(TypeError|Failed to fetch)/.test(error.message)) return error.message;
  return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
}

export function iniciales(nombre) {
  const palabras = String(nombre || 'P').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return 'P';
  return (palabras.length > 1 ? palabras[0][0] + palabras[1][0] : palabras[0].slice(0, 2)).toUpperCase();
}

/** Variación porcentual; null si no hay base para comparar. */
export function variacion(actual, anterior) {
  actual = Number(actual) || 0;
  anterior = Number(anterior) || 0;
  if (!anterior) return null;
  return ((actual - anterior) / anterior) * 100;
}

export const urlCliente = (token) => new URL(`index.html?c=${token}`, window.location.href).href;

export function abrirWhatsApp(telefono, texto) {
  const tel = (telefono || '').replace(/\D/g, '');
  window.open(`https://wa.me/${tel.length === 10 ? '521' + tel : tel}?text=${encodeURIComponent(texto)}`, '_blank');
}

export const esLogoValido = (logo) => typeof logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(logo);

/** «MIL DOSCIENTOS OCHENTA Y UN PESOS 00/100 M.N.» */
export function numeroALetras(monto) {
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
export const folioRemision = (folio) => `R-${String(folio).padStart(6, '0')}`;

/** Tema guardado en este navegador: 'claro' | 'oscuro' | 'sistema'. */
export function temaGuardado() {
  try { return localStorage.getItem('tema') || 'sistema'; } catch { return 'sistema'; }
}
export function guardarTema(modo) {
  try { localStorage.setItem('tema', modo); } catch { /* sin almacenamiento */ }
}
