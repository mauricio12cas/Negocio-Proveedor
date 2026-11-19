// Prueba las pantallas en Chromium.
//  * Pantalla del cliente: contra la base de prueba (PGlite) con las funciones SQL reales.
//    Las llamadas que el navegador hace a Supabase se responden ejecutando la función como «anon».
//  * Panel de administración: con respuestas simuladas de Supabase.
// Uso: node pantallas.test.mjs   (SCREENSHOTS=1 guarda capturas en ./capturas)
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { crearBD } from './bd-prueba.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const APP = new URL('../app/', import.meta.url);
const UMD = new URL('./node_modules/@supabase/supabase-js/dist/umd/', import.meta.url);
const CHART = new URL('./node_modules/chart.js/dist/chart.umd.js', import.meta.url);
const CAPTURAS = process.env.SCREENSHOTS ? new URL('./capturas/', import.meta.url) : null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });
const captura = (page, nombre, opciones = {}) =>
  CAPTURAS ? page.screenshot({ path: new URL(`${nombre}.png`, CAPTURAS).pathname, ...opciones }) : null;

const TIPOS = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml' };
const json = (route, cuerpo, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });

const hoyMX = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumarDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Sirve los archivos de app/ en http://app.test y supabase-js desde node_modules. */
async function servirApp(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/*', (route) => {
    const archivo = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ contentType: TIPOS.js, body: readFileSync(new URL(archivo, UMD)) });
  });
  await page.route('https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.js', (route) =>
    route.fulfill({ contentType: TIPOS.js, body: readFileSync(CHART) }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route('http://app.test/**', (route) => {
    const ruta = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (ruta === 'config.js') {
      return route.fulfill({ contentType: TIPOS.js, body: "window.CONFIG={SUPABASE_URL:'http://supabase.test',SUPABASE_ANON_KEY:'clave-de-prueba'};" });
    }
    route.fulfill({ contentType: TIPOS[ruta.split('.').pop()] || 'text/plain', body: readFileSync(new URL(ruta, APP)) });
  });
}

let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await fn();
    console.log('  ok   ', nombre);
  } catch (e) {
    fallas++;
    console.log('  FALLA', nombre, '\n        ', e.message.split('\n').slice(0, 6).join('\n         '));
  }
}

const navegador = await chromium.launch();

// ─────────────────────────────────────────────────────────────
// Pantalla del cliente contra PGlite
// ─────────────────────────────────────────────────────────────
console.log('Pantalla del cliente');
const db = await crearBD();
await db.exec(`
  insert into productos (id, nombre, categoria, presentacion, unidad) values
    ('10000000-0000-0000-0000-000000000001', 'Frijol negro', 'Granos', 'Costal 25 kg', 'costal'),
    ('10000000-0000-0000-0000-000000000002', 'Aceite vegetal', 'Aceites', 'Caja 12 L', 'caja'),
    ('10000000-0000-0000-0000-000000000003', '<img src=x onerror="window.__xss=1">', 'Limpieza', 'Galón', 'pieza'),
    ('10000000-0000-0000-0000-000000000004', 'Sal de mar', 'Especias', 'Bolsa 1 kg', 'pieza');
  insert into clientes (id, nombre, token) values
    ('20000000-0000-0000-0000-000000000001', 'Café Centro', 'tokencentro'),
    ('20000000-0000-0000-0000-000000000002', 'Cocina Norte', 'tokennorte');
  insert into sucursales (cliente_id, nombre, orden) values
    ('20000000-0000-0000-0000-000000000002', 'Roma', 0),
    ('20000000-0000-0000-0000-000000000002', 'Condesa', 1);
  insert into cliente_productos (cliente_id, producto_id, precio)
    select c.id, p.id, case p.nombre when 'Frijol negro' then 450.50 when 'Aceite vegetal' then 380
                                     when 'Sal de mar' then 0 else 10 end
    from clientes c cross join productos p;
`);
const fechaMin = (await db.query('select fecha_minima_entrega()::text as f')).rows[0].f;

async function rpcContraPGlite(route) {
  const fn = new URL(route.request().url()).pathname.split('/').pop();
  if (!['cliente_por_token', 'pedidos_por_token', 'crear_pedido'].includes(fn)) return json(route, { message: 'no permitido' }, 404);
  const args = route.request().postDataJSON() || {};
  const nombres = Object.keys(args);
  const valores = nombres.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
  const sql = `select ${fn}(${nombres.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  try {
    await db.exec('set role anon');
    const { rows } = await db.query(sql, valores);
    json(route, rows[0].r);
  } catch (e) {
    json(route, { code: 'P0001', message: e.message, details: null, hint: null }, 400);
  } finally {
    await db.exec('reset role');
  }
}

async function abrirCliente(token, opciones = {}) {
  const page = await navegador.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: CAPTURAS ? 2 : 1, ...opciones });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => { errores.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  await servirApp(page);
  await page.route('http://supabase.test/rest/v1/rpc/*', rpcContraPGlite);
  await page.goto(`http://app.test/index.html${token ? `?c=${token}` : ''}`);
  return { page, errores };
}

const contarPedidos = async () => (await db.query('select count(*)::int as n from pedidos')).rows[0].n;

await prueba('un link inválido muestra un mensaje claro', async () => {
  const { page, errores } = await abrirCliente('no-existe');
  await page.getByText('Link no válido').waitFor();
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('sin link muestra que está incompleto', async () => {
  const { page } = await abrirCliente('');
  await page.getByText('Link incompleto').waitFor();
  await page.close();
});

await prueba('flujo completo: tira de días, precios, revisar, confirmar e historial', async () => {
  const { page, errores } = await abrirCliente('tokencentro');
  await page.getByText('Café Centro').waitFor();
  assert.equal(await page.textContent('#negocio'), 'PROVEEDOR');

  // El nombre malicioso se muestra como texto y no se ejecuta
  await page.getByText('<img src=x onerror="window.__xss=1">').waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);

  // La tira empieza en la fecha mínima, con 14 días, y no incluye hoy
  const fechas = await page.$$eval('#tiraDias button', (bs) => bs.map((b) => b.dataset.fecha));
  assert.equal(fechas.length, 14);
  assert.equal(fechas[0], fechaMin);
  assert.ok(!fechas.includes(hoyMX()));

  // Precios visibles; producto sin precio bloqueado
  const frijol = page.locator('.producto', { hasText: 'Frijol negro' });
  assert.match(await frijol.textContent(), /\$450\.50/);
  const sal = page.locator('.producto', { hasText: 'Sal de mar' });
  assert.match(await sal.textContent(), /Precio por confirmar/);
  assert.ok(await sal.getByLabel('Más').isDisabled());

  assert.ok(await page.locator('#formulario.bloqueado').count());
  await page.click(`#tiraDias button[data-fecha="${fechaMin}"]`);
  await page.locator('#formulario:not(.bloqueado)').waitFor();

  // Frijol: + + (2). Aceite: teclado → 12
  await frijol.getByLabel('Más').click();
  await frijol.getByLabel('Más').click();
  assert.match(await frijol.textContent(), /× 2 = \$901\.00/);
  await page.locator('.producto', { hasText: 'Aceite vegetal' }).getByLabel('Escribir cantidad').click();
  await page.click('.tecla[data-k="1"]');
  await page.click('.tecla[data-k="2"]');
  await page.click('.tecla[data-k="ok"]');
  await page.locator('#barra.visible').waitFor();
  assert.equal(await page.textContent('#barraTotal'), '$5,461.00');
  assert.match(await page.textContent('#barraDetalle'), /2 productos/);
  await page.fill('#notas', 'Tocar el timbre');
  await captura(page, 'cliente-pedido');

  // Revisar → Corregir no envía nada
  await page.click('#btnRevisar');
  await page.locator('#modalRevision.visible').waitFor();
  const revision = await page.textContent('#revisionContenido');
  assert.match(revision, /12 × \$380\.00/);
  assert.match(revision, /\$4,560\.00/);
  assert.match(revision, /Total.*\$5,461\.00/s);
  assert.match(revision, /Tocar el timbre/);
  await captura(page, 'cliente-revision');
  await page.click('#modalRevision [data-cerrar="modalRevision"]');
  assert.equal(await contarPedidos(), 0);

  // Revisar → Confirmar
  await page.click('#btnRevisar');
  await page.click('#btnConfirmar');
  await page.locator('#modalExito.visible').waitFor();
  assert.match(await page.textContent('#exitoTitulo'), /Pedido #\d+ enviado/);
  assert.match(await page.textContent('#exitoTexto'), /Total \$5,461\.00/);
  await captura(page, 'cliente-exito');

  const { rows } = await db.query(`
    select l.producto_nombre, l.cantidad, l.precio_unitario::float as precio, l.importe::float as importe, p.notas, p.fecha_entrega::text as f
    from pedido_lineas l join pedidos p on p.id = l.pedido_id order by l.producto_nombre`);
  assert.deepEqual(rows.map((r) => [r.producto_nombre, r.cantidad, r.precio, r.importe]),
    [['Aceite vegetal', 12, 380, 4560], ['Frijol negro', 2, 450.5, 901]]);
  assert.equal(rows[0].notas, 'Tocar el timbre');
  assert.equal(rows[0].f, fechaMin);

  // El día queda marcado y bloqueado
  await page.click('#modalExito [data-cerrar="modalExito"]');
  assert.ok(await page.locator(`#tiraDias button.con-pedido[data-fecha="${fechaMin}"]`).count());
  await page.locator('.aviso').getByText('Ya tienes el pedido').waitFor();
  assert.equal(await page.locator('#barra.visible').count(), 0);

  // Historial con total
  await page.click('#btnHistorial');
  await page.locator('.tarjeta').first().waitFor();
  const tarjeta = await page.textContent('.tarjeta');
  assert.match(tarjeta, /Recibido/);
  assert.match(tarjeta, /Total\s*\$5,461\.00/);
  await captura(page, 'cliente-historial');
  const folio = (await db.query(`select folio::int as f from pedidos order by folio limit 1`)).rows[0].f;
  assert.equal(await page.getAttribute('.tarjeta-acciones a', 'href'), `remision.html?t=tokencentro&folio=${folio}`);
  assert.deepEqual(errores, []);

  // La nota del cliente se arma con sus propios datos
  await page.goto(`http://app.test/remision.html?t=tokencentro&folio=${folio}`);
  await page.locator('.hoja').waitFor();
  const hoja = await page.textContent('.hoja');
  assert.match(hoja, new RegExp(`R-${String(folio).padStart(6, '0')}`));
  assert.match(hoja, /Café Centro/);
  assert.match(hoja, /TOTAL\s*\$5,461\.00/);
  assert.match(hoja, /CINCO MIL CUATROCIENTOS SESENTA Y UN PESOS 00\/100 M\.N\./);
  assert.match(hoja, /Tocar el timbre/);
  await page.goto(`http://app.test/remision.html?t=tokencentro&folio=99999`);
  await page.getByText('Pedido no encontrado').first().waitFor();
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('la pantalla del cliente usa el color y el logo del negocio', async () => {
  await db.exec(`update ajustes set color_acento = '#be123c', logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' where id = 1`);
  const { page, errores } = await abrirCliente('tokencentro', { colorScheme: 'dark' });
  await page.getByText('Café Centro').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--acento')), '#be123c');
  assert.ok(await page.locator('.cabecera [data-marca-logo] img').count());
  assert.equal(await page.locator('#chips button').count(), 4);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desplazamiento horizontal');
  await page.click(`#tiraDias button[data-fecha="${sumarDias(fechaMin, 3)}"]`);
  await page.locator('.producto', { hasText: 'Frijol negro' }).getByLabel('Más').click();
  await page.locator('#barra.visible').waitFor();
  await page.waitForTimeout(350);
  await captura(page, 'cliente-oscuro-marca');
  assert.deepEqual(errores, []);
  await db.exec(`update ajustes set color_acento = '#0f766e', logo = null where id = 1`);
  await page.close();
});

await prueba('«Otra fecha» abre el calendario y agrega el día a la tira', async () => {
  const { page, errores } = await abrirCliente('tokencentro');
  await page.getByText('Café Centro').waitFor();
  await page.click('#btnOtraFecha');
  await page.locator('#modalCalendario.visible').waitFor();
  const lejana = sumarDias(fechaMin, 20);
  if (lejana.slice(0, 7) !== fechaMin.slice(0, 7)) await page.click('#mesSiguiente');
  await page.click(`.cal-dia[data-fecha="${lejana}"]`);
  assert.equal(await page.locator('#modalCalendario.visible').count(), 0);
  assert.ok(await page.locator(`#tiraDias button.seleccionado[data-fecha="${lejana}"]`).count());
  await page.locator('#formulario:not(.bloqueado)').waitFor();
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('un cliente con sucursales pide por sucursal', async () => {
  const { page, errores } = await abrirCliente('tokennorte');
  await page.locator('.sucursal-cab h3', { hasText: 'Roma' }).waitFor();
  assert.equal(await page.locator('.sucursal').count(), 2);
  await page.click(`#tiraDias button[data-fecha="${fechaMin}"]`);
  const condesa = page.locator('.sucursal').nth(1);
  await condesa.locator('.producto', { hasText: 'Frijol negro' }).getByLabel('Más').click();
  assert.equal(await page.textContent('#total-1'), '1');
  await page.click('#btnRevisar');
  assert.match(await page.textContent('#revisionContenido'), /Condesa/);
  await page.click('#btnConfirmar');
  await page.locator('#modalExito.visible').waitFor();
  const { rows } = await db.query(`
    select l.sucursal_nombre, l.producto_nombre, l.cantidad from pedido_lineas l
    join pedidos p on p.id = l.pedido_id join clientes c on c.id = p.cliente_id where c.token = 'tokennorte'`);
  assert.deepEqual(rows, [{ sucursal_nombre: 'Condesa', producto_nombre: 'Frijol negro', cantidad: 1 }]);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('los errores del servidor se muestran al cliente', async () => {
  const { page } = await abrirCliente('tokencentro');
  await page.getByText('Café Centro').waitFor();
  await page.click(`#tiraDias button[data-fecha="${sumarDias(fechaMin, 1)}"]`);
  await page.locator('.producto', { hasText: 'Frijol negro' }).getByLabel('Más').click();
  await page.click('#btnRevisar');
  // Mientras tanto, el proveedor desactiva al cliente
  await db.exec(`update clientes set activo = false where token = 'tokencentro'`);
  await page.click('#btnConfirmar');
  await page.locator('.toast.visible.error', { hasText: 'Link inválido o cliente inactivo' }).waitFor();
  await db.exec(`update clientes set activo = true where token = 'tokencentro'`);
  await page.close();
});

// ─────────────────────────────────────────────────────────────
// Panel de administración con respuestas simuladas
// ─────────────────────────────────────────────────────────────
console.log('Panel de administración');

const MANANA = sumarDias(hoyMX(), 1);
const fixturas = () => ({
  ajustes: { id: 1, nombre_negocio: 'PROVEEDOR', whatsapp: null, hora_corte: '20:00:00', zona_horaria: 'America/Mexico_City', margen_minimo: 15, dias_inactividad: 7,
    color_acento: '#0f766e', logo: null, razon_social: 'Proveedora del Centro SA de CV', rfc: 'PCE010101AB1', direccion: 'Calle 1 #2, CDMX', telefono: '55 1111 2222',
    leyenda_remision: 'Precios con IVA incluido. Este documento no es un comprobante fiscal.' },
  productos: [
    { id: 'p1', nombre: 'Frijol negro', categoria: 'Granos', presentacion: 'Costal 25 kg', unidad: 'costal', activo: true, precio_base: 500, costo: 400 },
    { id: 'p2', nombre: 'Aceite vegetal', categoria: 'Aceites', presentacion: 'Caja 12 L', unidad: 'caja', activo: true, precio_base: 380, costo: 360 },
    { id: 'p3', nombre: 'Sal de mar', categoria: 'Especias', presentacion: 'Bolsa 1 kg', unidad: 'pieza', activo: true, precio_base: 0, costo: null },
  ],
  clientes: [
    { id: 'c1', nombre: 'Café <b>Centro</b>', tipo: 'Cafetería', telefono: '5512345678', token: 'abc123', activo: true,
      sucursales: [], cliente_productos: [{ producto_id: 'p1', precio: 450 }] },
    { id: 'c2', nombre: 'Cocina Norte', tipo: 'Restaurante', telefono: null, token: 'def456', activo: true,
      sucursales: [], cliente_productos: [{ producto_id: 'p1', precio: 480 }, { producto_id: 'p2', precio: 400 }] },
  ],
  resumen_clientes: [
    { id: 'c1', nombre: 'Café <b>Centro</b>', telefono: '5512345678', activo: true, ultima_entrega: null, ultimo_pedido: null, productos: 1, productos_sin_precio: 0 },
    { id: 'c2', nombre: 'Cocina Norte', telefono: null, activo: true, ultima_entrega: MANANA, ultimo_pedido: new Date().toISOString(), productos: 2, productos_sin_precio: 1 },
  ],
  cliente_productos: [
    { precio: 450, clientes: { nombre: 'Café Centro' }, productos: { nombre: 'Frijol negro', costo: 400 } },
    { precio: 400, clientes: { nombre: 'Cocina Norte' }, productos: { nombre: 'Aceite vegetal', costo: 360 } },
  ],
  pedidos: [
    { id: 'pe1', folio: 7, fecha_entrega: MANANA, estado: 'recibido', notas: '<script>window.__xss=1</script>', creado: '2026-11-19T18:00:00Z',
      clientes: { nombre: 'Cocina Norte', telefono: '5598765432', direccion: 'Av. Siempre Viva 123', horario_recepcion: '7 a 10', instrucciones: null },
      pedido_lineas: [
        { sucursal_nombre: '', producto_nombre: 'Frijol negro', presentacion: 'Costal 25 kg', unidad: 'costal', cantidad: 2, precio_unitario: 480, importe: 960 },
        { sucursal_nombre: '', producto_nombre: 'Aceite vegetal', presentacion: 'Caja 12 L', unidad: 'caja', cantidad: 1, precio_unitario: 400, importe: 400 },
      ] },
  ],
  pedido_lineas: [
    { producto_nombre: 'Frijol negro', presentacion: 'Costal 25 kg', unidad: 'costal', cantidad: 2, sucursal_nombre: '', pedidos: { clientes: { nombre: 'Café Centro' } } },
    { producto_nombre: 'Frijol negro', presentacion: 'Costal 25 kg', unidad: 'costal', cantidad: 3, sucursal_nombre: 'Roma', pedidos: { clientes: { nombre: 'Cocina Norte' } } },
    { producto_nombre: 'Aceite vegetal', presentacion: 'Caja 12 L', unidad: 'caja', cantidad: 1, sucursal_nombre: '', pedidos: { clientes: { nombre: 'Café Centro' } } },
  ],
});

async function abrirAdmin({ esAdmin = true, viewport = { width: 1280, height: 860 }, colorScheme = 'light' } = {}) {
  const page = await navegador.newPage({ viewport, deviceScaleFactor: CAPTURAS ? 2 : 1, colorScheme });
  const errores = [];
  const cambios = [];
  const llamadasEstadisticas = [];
  const FIX = fixturas();
  page.on('pageerror', (e) => errores.push(e.message));
  await servirApp(page);
  await page.route('http://supabase.test/auth/v1/**', (route) => {
    const url = route.request().url();
    if (url.includes('/token')) {
      const ahora = Math.floor(Date.now() / 1000);
      return json(route, {
        access_token: 'x.y.z', token_type: 'bearer', expires_in: 3600, expires_at: ahora + 3600, refresh_token: 'r',
        user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'yo@ejemplo.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('http://supabase.test/rest/v1/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const tabla = url.pathname.split('/').pop();
    if (url.pathname.includes('/rpc/es_admin')) return json(route, esAdmin);
    if (url.pathname.includes('/rpc/estadisticas_ventas')) {
      const { p_desde, p_hasta } = req.postDataJSON();
      llamadasEstadisticas.push([p_desde, p_hasta]);
      const por_dia = [];
      for (let f = p_desde; f <= p_hasta; f = sumarDias(f, 1)) por_dia.push({ fecha: f, total: f === p_hasta ? 1360 : f === sumarDias(p_hasta, -2) ? 640 : 0, pedidos: f === p_hasta || f === sumarDias(p_hasta, -2) ? 1 : 0 });
      return json(route, {
        desde: p_desde, hasta: p_hasta, por_dia,
        totales: { total: 2000, pedidos: 2, ticket_promedio: 1000 },
        periodo_anterior: { total: 1600, pedidos: 2, ticket_promedio: 800 },
        top_clientes: [{ nombre: 'Cocina Norte', total: 1360, pedidos: 1 }, { nombre: 'Café <b>Centro</b>', total: 640, pedidos: 1 }],
        top_productos: [{ nombre: 'Frijol negro', total: 1600, cantidad: 4 }, { nombre: 'Aceite vegetal', total: 400, cantidad: 1 }],
      });
    }
    if (req.method() !== 'GET') {
      const cuerpo = req.postDataJSON();
      cambios.push({ metodo: req.method(), tabla, query: url.search, cuerpo, prefer: req.headers()['prefer'] || '' });
      // Simula lo mínimo para crear un cliente y asignarle productos
      if (req.method() === 'POST' && tabla === 'clientes') {
        const nuevo = { id: 'c-nuevo', token: 'tok-nuevo', sucursales: [], cliente_productos: [], ...cuerpo };
        FIX.clientes.push(nuevo);
        return json(route, { id: nuevo.id }, 201);
      }
      if (req.method() === 'POST' && tabla === 'cliente_productos') {
        for (const fila of cuerpo) {
          const c = FIX.clientes.find((x) => x.id === fila.cliente_id);
          if (c) c.cliente_productos = [...c.cliente_productos.filter((x) => x.producto_id !== fila.producto_id), { producto_id: fila.producto_id, precio: fila.precio }];
        }
      }
      return route.fulfill({ status: 204, body: '' });
    }
    const datos = FIX[tabla];
    if (datos === undefined) return json(route, { message: `tabla desconocida ${tabla}` }, 404);
    return json(route, datos);
  });
  await page.goto('http://app.test/admin.html');
  return { page, errores, cambios, llamadasEstadisticas, FIX };
}

async function iniciarSesion(page) {
  await page.fill('#correo', 'yo@ejemplo.com');
  await page.fill('#contrasena', 'secreto');
  await page.click('#btnEntrar');
  await page.locator('#metricas .metrica').first().waitFor();
}

await prueba('un usuario sin permiso no entra al panel', async () => {
  const { page } = await abrirAdmin({ esAdmin: false });
  await page.fill('#correo', 'yo@ejemplo.com');
  await page.fill('#contrasena', 'secreto');
  await page.click('#btnEntrar');
  await page.getByText('no tiene permiso de administrador').waitFor();
  assert.match(await page.textContent('#accesoNota'), /insert into administradores \(user_id\) values \('u1'\)/);
  assert.equal(await page.isVisible('#pantallaPanel'), false);
  await page.close();
});

await prueba('inicio: métricas, gráficas, clientes sin pedir y alertas', async () => {
  const { page, errores, llamadasEstadisticas } = await abrirAdmin();
  await iniciarSesion(page);
  await page.locator('#mVentas .valor', { hasText: '$' }).waitFor();
  const metricas = await page.textContent('#metricas');
  assert.match(metricas, /Por confirmar\s*1/);
  assert.match(metricas, /Entregas de mañana\s*1\s*\$1,360\.00/);
  assert.match(metricas, /Ventas\s*\$2,000\.00\s*▲ 25 %/);
  assert.match(metricas, /Ticket promedio\s*\$1,000\.00\s*2 pedidos/);
  assert.equal(await page.textContent('#insigniaPedidos'), '1');

  // Gráfica de 30 días hasta hoy y tops con barras
  assert.deepEqual(llamadasEstadisticas[0], [sumarDias(hoyMX(), -29), hoyMX()]);
  await page.waitForFunction(() => window.Chart && Chart.getChart('graficaVentas'));
  assert.equal(await page.evaluate(() => Chart.getChart('graficaVentas').data.datasets[0].data.length), 30);
  assert.match(await page.textContent('#graficaTotal'), /\$2,000\.00\s*2 pedidos/);
  assert.match(await page.textContent('#topClientes'), /Cocina Norte.*\$1,360\.00.*Café <b>Centro<\/b>/s);
  assert.equal(await page.locator('#topProductos .barra-fila').count(), 2);

  const inactivos = await page.textContent('#listaInactivos');
  assert.match(inactivos, /Café <b>Centro<\/b>/);
  assert.match(inactivos, /Nunca ha pedido/);
  assert.doesNotMatch(inactivos, /Cocina Norte/);
  const alertas = await page.textContent('#listaAlertas');
  assert.match(alertas, /Cocina Norte.*1 producto sin precio/s);
  assert.match(alertas, /Aceite vegetal · Cocina Norte.*Margen 10\.0 %/s);
  assert.match(alertas, /Frijol negro · Café Centro.*Margen 11\.1 %/s);
  await page.waitForTimeout(450);   // termina la animación de la gráfica
  await captura(page, 'admin-inicio', { fullPage: true });

  // Cambiar a 7 días vuelve a pedir las estadísticas
  await page.click('#rangoInicio button[data-dias="7"]');
  await page.waitForFunction(() => Chart.getChart('graficaVentas')?.data.datasets[0].data.length === 7);
  assert.deepEqual(llamadasEstadisticas.at(-1), [sumarDias(hoyMX(), -6), hoyMX()]);

  // Modo oscuro: se guarda y la gráfica se redibuja
  await page.click('#selectorTema button[data-tema="oscuro"]');
  assert.equal(await page.getAttribute('html', 'data-tema'), 'oscuro');
  assert.equal(await page.evaluate(() => localStorage.getItem('tema')), 'oscuro');
  await page.waitForTimeout(450);
  await captura(page, 'admin-inicio-oscuro', { fullPage: true });
  await page.click('#selectorTema button[data-tema="sistema"]');
  assert.equal(await page.getAttribute('html', 'data-tema'), null);

  // «Por confirmar» lleva a Pedidos filtrado
  await page.click('#mPorConfirmar');
  await page.locator('.pedido').first().waitFor();
  assert.equal(await page.inputValue('#filtroEstado'), 'recibido');
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('inicio en celular: menú inferior y sin desbordes', async () => {
  const { page, errores } = await abrirAdmin({ viewport: { width: 390, height: 844 } });
  await iniciarSesion(page);
  await page.locator('#mVentas .valor', { hasText: '$' }).waitFor();
  const menu = await page.locator('#menu').boundingBox();
  assert.ok(menu.y + menu.height >= 840, 'el menú queda abajo');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desplazamiento horizontal');
  await page.waitForTimeout(450);
  await captura(page, 'admin-inicio-celular');
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('pedidos: precios, total, escape y cambio de estado', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.click('#menu button[data-vista="pedidos"]');
  await page.locator('.pedido').first().waitFor();
  const pedido = await page.textContent('.pedido');
  assert.match(pedido, /#7/);
  assert.match(pedido, /Av\. Siempre Viva 123/);
  assert.match(pedido, /\$960\.00/);
  assert.match(pedido, /Total\s*\$1,360\.00/);
  assert.equal(await page.textContent('.pedido-notas'), '<script>window.__xss=1</script>');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.getAttribute('[data-remision="pe1"]', 'href'), 'remision.html?pedido=pe1');
  await captura(page, 'admin-pedidos');

  await page.selectOption('select[data-pedido="pe1"]', 'confirmado');
  await page.locator('.toast.visible', { hasText: 'Confirmado' }).waitFor();
  const cambio = cambios.find((c) => c.tabla === 'pedidos');
  assert.deepEqual(cambio.cuerpo, { estado: 'confirmado' });
  assert.match(cambio.query, /id=eq\.pe1/);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('por comprar: suma las cantidades de todos los clientes', async () => {
  const { page, errores } = await abrirAdmin();
  await iniciarSesion(page);
  await page.click('#menu button[data-vista="compras"]');
  await page.locator('#listaCompras tbody tr').first().waitFor();
  const filas = await page.$$eval('#listaCompras tbody tr', (trs) => trs.map((tr) => [...tr.children].slice(0, 3).map((td) => td.textContent.trim())));
  assert.deepEqual(filas, [['Aceite vegetal', 'Caja 12 L (caja)', '1'], ['Frijol negro', 'Costal 25 kg (costal)', '5']]);
  assert.match(await page.textContent('#listaCompras'), /Cocina Norte \/ Roma: 3/);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('asistente: editar productos y precios (copiar, ajustar %, validar)', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.click('#menu button[data-vista="clientes"]');
  await page.locator('.cliente').first().waitFor();
  assert.equal(await page.textContent('.cliente h3'), 'Café <b>Centro</b>');
  assert.equal(await page.textContent('.link-caja code'), 'http://app.test/index.html?c=abc123');

  await page.click('[data-precios="c1"]');
  await page.locator('#modalCliente.visible .paso.actual[data-paso="2"]').waitFor();
  const fila = (id) => page.locator(`#ppTabla tr[data-producto="${id}"]`);
  assert.ok(await fila('p1').locator('input[type=checkbox]').isChecked());
  assert.equal(await fila('p1').locator('input[type=number]').inputValue(), '450');
  assert.match(await fila('p1').textContent(), /11\.1 %/);

  // Marcar Aceite: se propone el precio base
  await fila('p2').locator('input[type=checkbox]').check();
  assert.equal(await fila('p2').locator('input[type=number]').inputValue(), '380');
  assert.ok(await fila('p2').locator('.margen.margen-bajo').count());   // 5.3 % < 15 %

  // Ajustar +10 %
  await page.fill('#ppPorcentaje', '10');
  await page.click('#ppAjustar');
  assert.equal(await fila('p1').locator('input[type=number]').inputValue(), '495');
  assert.equal(await fila('p2').locator('input[type=number]').inputValue(), '418');

  // Marcar Sal (sin precio base) impide guardar
  await fila('p3').locator('input[type=checkbox]').check();
  await page.click('#btnGuardarCliente');
  await page.getByText('Falta el precio de 1 producto marcado').waitFor();
  await fila('p3').locator('input[type=checkbox]').uncheck();

  // Copiar de Cocina Norte reemplaza la selección
  page.once('dialog', (d) => d.accept());
  await page.selectOption('#ppCopiar', 'c2');
  assert.equal(await fila('p1').locator('input[type=number]').inputValue(), '480');
  assert.equal(await fila('p2').locator('input[type=number]').inputValue(), '400');
  await captura(page, 'admin-asistente-precios');

  await page.click('#btnGuardarCliente');
  await page.locator('.toast.visible', { hasText: 'Cliente guardado' }).waitFor();
  const upsert = cambios.find((c) => c.tabla === 'cliente_productos' && c.metodo === 'POST');
  assert.deepEqual(upsert.cuerpo, [
    { cliente_id: 'c1', producto_id: 'p1', precio: 480 },
    { cliente_id: 'c1', producto_id: 'p2', precio: 400 },
  ]);
  assert.match(upsert.prefer, /resolution=merge-duplicates/);
  assert.match(upsert.query, /on_conflict=cliente_id%2Cproducto_id|on_conflict=cliente_id,producto_id/);
  assert.equal(cambios.filter((c) => c.tabla === 'cliente_productos' && c.metodo === 'DELETE').length, 0);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('asistente: alta de cliente nuevo paso a paso hasta su link', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.click('#menu button[data-vista="clientes"]');
  await page.click('#btnNuevoCliente');
  await page.locator('#modalCliente.visible .paso.actual[data-paso="1"]').waitFor();
  assert.ok(await page.locator('#pasosCliente button[data-ir="3"]').isDisabled());

  await page.click('#btnSiguiente');
  await page.getByText('Escribe el nombre del cliente.').waitFor();
  await page.fill('#clNombre', 'Taquería Sur');
  await page.fill('#clTelefono', '5598765432');
  await page.click('#btnSiguiente');
  await page.locator('.paso.actual[data-paso="2"]').waitFor();
  await page.locator('#ppTabla tr[data-producto="p1"] input[type=checkbox]').check();
  await page.click('#btnSiguiente');
  await page.locator('.paso.actual[data-paso="3"]').waitFor();
  await page.click('#btnAgregarSucursal');
  await page.fill('#clSucursales .fila input', 'Matriz');
  await page.click('#btnGuardarCliente');

  await page.locator('.paso.actual[data-paso="4"]').waitFor();
  assert.equal(await page.textContent('#listoLink'), 'http://app.test/index.html?c=tok-nuevo');
  assert.match(await page.textContent('#listoTexto'), /1 producto con precio/);
  await captura(page, 'admin-asistente-listo');

  const alta = cambios.find((c) => c.tabla === 'clientes' && c.metodo === 'POST');
  assert.equal(alta.cuerpo.nombre, 'Taquería Sur');
  const suc = cambios.find((c) => c.tabla === 'sucursales' && c.metodo === 'POST');
  assert.deepEqual(suc.cuerpo, [{ cliente_id: 'c-nuevo', nombre: 'Matriz', orden: 0 }]);
  const precios = cambios.find((c) => c.tabla === 'cliente_productos' && c.metodo === 'POST');
  assert.deepEqual(precios.cuerpo, [{ cliente_id: 'c-nuevo', producto_id: 'p1', precio: 500 }]);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('catálogo: margen y pegar desde Excel con precio y costo', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.click('#menu button[data-vista="catalogo"]');
  await page.locator('#listaProductos tbody tr').first().waitFor();
  const aceite = await page.locator('#listaProductos tr', { hasText: 'Aceite vegetal' }).textContent();
  assert.match(aceite, /\$380\.00/);
  assert.match(aceite, /5\.3 %/);
  assert.ok(await page.locator('#listaProductos tr', { hasText: 'Aceite vegetal' }).locator('.margen-bajo').count());
  await captura(page, 'admin-catalogo');

  await page.click('#btnImportar');
  await page.fill('#textoImportar', 'Nombre\tCategoría\tPresentación\tUnidad\tPrecio\tCosto\nArroz\tGranos\tBulto 50 kg\tbultos\t$1,250.50\t1000\nCloro\tLimpieza\tGalón\tlitros\nSal\t\t\t');
  assert.match(await page.textContent('#vistaImportar'), /3 productos/);
  await page.click('#btnConfirmarImportar');
  await page.locator('.toast.visible', { hasText: '3 productos agregados' }).waitFor();
  const ins = cambios.find((c) => c.tabla === 'productos' && c.metodo === 'POST');
  assert.deepEqual(ins.cuerpo, [
    { costo: 1000, nombre: 'Arroz', categoria: 'Granos', presentacion: 'Bulto 50 kg', unidad: 'bulto', precio_base: 1250.5 },
    { costo: null, nombre: 'Cloro', categoria: 'Limpieza', presentacion: 'Galón', unidad: 'litro', precio_base: 0 },
    { costo: null, nombre: 'Sal', categoria: 'General', presentacion: '', unidad: 'pieza', precio_base: 0 },
  ]);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('ajustes: logo, color y datos de remisión', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.click('#menu button[data-vista="ajustes"]');
  assert.equal(await page.inputValue('#ajRfc'), 'PCE010101AB1');

  // Elegir un color cambia el acento en vivo
  await page.click('#colores button[data-color="#1d4ed8"]');
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--acento')), '#1d4ed8');

  // Subir un logo lo reduce a 256 px
  const png = Buffer.from(await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#c00'; g.fillRect(0, 0, 600, 300);
    return c.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.setInputFiles('#ajLogoArchivo', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await page.locator('#ajLogoVista img').waitFor();
  const medida = await page.evaluate(() => new Promise((ok) => {
    const i = new Image(); i.onload = () => ok([i.width, i.height]); i.src = document.querySelector('#ajLogoVista img').src;
  }));
  assert.deepEqual(medida, [256, 128]);
  assert.ok(await page.locator('.lateral [data-marca-logo] img').count(), 'el logo se ve en el menú');
  await captura(page, 'admin-ajustes', { fullPage: true });

  await page.fill('#ajRfc', 'abc010101xy9');
  await page.click('#btnGuardarAjustes');
  await page.locator('.toast.visible', { hasText: 'Ajustes guardados' }).waitFor();
  const patch = cambios.find((c) => c.tabla === 'ajustes');
  assert.equal(patch.cuerpo.color_acento, '#1d4ed8');
  assert.match(patch.cuerpo.logo, /^data:image\/png;base64,/);
  assert.equal(patch.cuerpo.rfc, 'ABC010101XY9');
  assert.equal(patch.cuerpo.razon_social, 'Proveedora del Centro SA de CV');
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('remisión desde el panel: datos, líneas, total en letra e impresión', async () => {
  const { page, errores } = await abrirAdmin();
  await iniciarSesion(page);
  await page.goto('http://app.test/remision.html?pedido=pe1');
  await page.locator('.hoja').waitFor();
  const hoja = await page.textContent('.hoja');
  assert.match(hoja, /REMISIÓN\s*R-000007/);
  assert.match(hoja, /Proveedora del Centro SA de CV/);
  assert.match(hoja, /RFC PCE010101AB1/);
  assert.match(hoja, /Cocina Norte/);
  assert.match(hoja, /Av\. Siempre Viva 123/);
  assert.match(hoja, /Horario: 7 a 10/);
  assert.match(hoja, /2\s*costal\s*Frijol negro.*\$480\.00\s*\$960\.00/s);
  assert.match(hoja, /TOTAL\s*\$1,360\.00/);
  assert.match(hoja, /MIL TRESCIENTOS SESENTA PESOS 00\/100 M\.N\./);
  assert.match(hoja, /Recibí de conformidad/);
  assert.match(hoja, /no es un comprobante fiscal/);
  assert.equal(await page.textContent('.hoja .notas'), 'Notas: <script>window.__xss=1</script>');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.ok(await page.isEnabled('#btnImprimir'));
  await captura(page, 'remision', { fullPage: true });
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.isVisible('.barra-herramientas'), false);
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('remisión sin sesión pide iniciar sesión', async () => {
  const page = await navegador.newPage();
  await servirApp(page);
  await page.route('http://supabase.test/**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('http://app.test/remision.html?fecha=2026-11-20');
  await page.getByText('Inicia sesión', { exact: true }).first().waitFor();
  await page.close();
});

await prueba('número con letra', async () => {
  const page = await navegador.newPage();
  await servirApp(page);
  await page.goto('http://app.test/remision.html');
  const r = await page.evaluate(() => [0, 1, 21, 100, 101, 1281, 21000, 1000000, 2500000.5, 45.07].map(numeroALetras));
  assert.deepEqual(r, [
    'CERO PESOS 00/100 M.N.', 'UN PESO 00/100 M.N.', 'VEINTIÚN PESOS 00/100 M.N.', 'CIEN PESOS 00/100 M.N.',
    'CIENTO UN PESOS 00/100 M.N.', 'MIL DOSCIENTOS OCHENTA Y UN PESOS 00/100 M.N.', 'VEINTIÚN MIL PESOS 00/100 M.N.',
    'UN MILLÓN DE PESOS 00/100 M.N.', 'DOS MILLONES QUINIENTOS MIL PESOS 50/100 M.N.', 'CUARENTA Y CINCO PESOS 07/100 M.N.',
  ]);
  await page.close();
});

await navegador.close();
if (fallas) {
  console.log(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas de pantallas pasaron');
