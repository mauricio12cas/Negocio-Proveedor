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
const CAPTURAS = process.env.SCREENSHOTS ? new URL('./capturas/', import.meta.url) : null;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

const TIPOS = { html: 'text/html', js: 'application/javascript', css: 'text/css' };
const json = (route, cuerpo, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) });

/** Sirve los archivos de app/ en http://app.test y supabase-js desde node_modules. */
async function servirApp(page) {
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/*', (route) => {
    const archivo = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ contentType: TIPOS.js, body: readFileSync(new URL(archivo, UMD)) });
  });
  await page.route('http://app.test/**', (route) => {
    let ruta = new URL(route.request().url()).pathname.slice(1) || 'index.html';
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
    ('10000000-0000-0000-0000-000000000003', '<img src=x onerror="window.__xss=1">', 'Limpieza', 'Galón', 'pieza');
  insert into clientes (id, nombre, token) values
    ('20000000-0000-0000-0000-000000000001', 'Café Centro', 'tokencentro'),
    ('20000000-0000-0000-0000-000000000002', 'Cocina Norte', 'tokennorte');
  insert into sucursales (cliente_id, nombre, orden) values
    ('20000000-0000-0000-0000-000000000002', 'Roma', 0),
    ('20000000-0000-0000-0000-000000000002', 'Condesa', 1);
  insert into cliente_productos
    select c.id, p.id from clientes c cross join productos p;
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
  const page = await navegador.newPage(opciones);
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', (d) => { errores.push(`diálogo inesperado: ${d.message()}`); d.dismiss(); });
  await servirApp(page);
  await page.route('http://supabase.test/rest/v1/rpc/*', rpcContraPGlite);
  await page.goto(`http://app.test/index.html${token ? `?c=${token}` : ''}`);
  return { page, errores };
}

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

await prueba('flujo completo: elegir fecha, cantidades, enviar e historial', async () => {
  const { page, errores } = await abrirCliente('tokencentro', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.getByText('Café Centro').waitFor();
  assert.equal(await page.textContent('#negocio'), 'PROVEEDOR');

  // El nombre malicioso se muestra como texto y no se ejecuta
  await page.getByText('<img src=x onerror="window.__xss=1">').waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);

  // Antes de elegir fecha, los productos están bloqueados
  assert.ok(await page.locator('#formulario.bloqueado').count());
  // Hoy no se puede elegir
  const hoy = (await db.query(`select (now() at time zone 'America/Mexico_City')::date::text as h`)).rows[0].h;
  if (hoy.slice(0, 7) === fechaMin.slice(0, 7)) assert.ok(await page.locator(`.cal-dia[data-fecha="${hoy}"]`).isDisabled());

  await page.click(`.cal-dia[data-fecha="${fechaMin}"]`);
  await page.locator('#formulario:not(.bloqueado)').waitFor();

  // Frijol: + + (2). Aceite: teclado → 12
  const filas = page.locator('.producto');
  const frijol = filas.filter({ hasText: 'Frijol negro' });
  await frijol.getByLabel('Más').click();
  await frijol.getByLabel('Más').click();
  await filas.filter({ hasText: 'Aceite vegetal' }).getByLabel('Escribir cantidad').click();
  await page.click('.tecla[data-k="1"]');
  await page.click('.tecla[data-k="2"]');
  await page.click('.tecla[data-k="ok"]');
  await page.locator('#barra.visible').waitFor();
  assert.equal(await page.textContent('#barraCuenta'), '2 productos');
  await page.fill('#notas', 'Tocar el timbre');
  if (CAPTURAS) await page.screenshot({ path: new URL('cliente-pedido.png', CAPTURAS).pathname, fullPage: false });

  await page.click('#btnEnviar');
  await page.locator('#modalExito.visible').waitFor();
  assert.match(await page.textContent('#exitoTitulo'), /Pedido #\d+ enviado/);
  if (CAPTURAS) await page.screenshot({ path: new URL('cliente-exito.png', CAPTURAS).pathname });

  const { rows } = await db.query(`
    select l.producto_nombre, l.cantidad, p.notas, p.fecha_entrega::text as f
    from pedido_lineas l join pedidos p on p.id = l.pedido_id order by l.producto_nombre`);
  assert.deepEqual(rows.map((r) => [r.producto_nombre, r.cantidad]), [['Aceite vegetal', 12], ['Frijol negro', 2]]);
  assert.equal(rows[0].notas, 'Tocar el timbre');
  assert.equal(rows[0].f, fechaMin);

  // El día queda marcado y bloqueado
  await page.click('#btnCerrarExito');
  assert.ok(await page.locator(`.cal-dia.con-pedido[data-fecha="${fechaMin}"]`).count());
  await page.locator('.aviso').getByText('Ya tienes el pedido').waitFor();
  assert.equal(await page.locator('#barra.visible').count(), 0);

  // Historial
  await page.click('#btnHistorial');
  await page.locator('.tarjeta').first().waitFor();
  assert.match(await page.textContent('.tarjeta'), /Recibido/);
  assert.match(await page.textContent('.tarjeta'), /Aceite vegetal/);
  if (CAPTURAS) await page.screenshot({ path: new URL('cliente-historial.png', CAPTURAS).pathname });
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('un cliente con sucursales pide por sucursal', async () => {
  const { page, errores } = await abrirCliente('tokennorte');
  await page.locator('.sucursal-cab h3', { hasText: 'Roma' }).waitFor();
  assert.equal(await page.locator('.sucursal').count(), 2);
  await page.click(`.cal-dia[data-fecha="${fechaMin}"]`);
  const condesa = page.locator('.sucursal').nth(1);
  await condesa.locator('.producto', { hasText: 'Frijol negro' }).getByLabel('Más').click();
  assert.equal(await page.textContent('#total-1'), '1');
  await page.click('#btnEnviar');
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
  const otraFecha = (await db.query(`select (fecha_minima_entrega() + 1)::text as f`)).rows[0].f;
  if (otraFecha.slice(0, 7) !== fechaMin.slice(0, 7)) await page.click('#mesSiguiente');
  await page.click(`.cal-dia[data-fecha="${otraFecha}"]`);
  await page.locator('.producto', { hasText: 'Frijol negro' }).getByLabel('Más').click();
  // Mientras tanto, el proveedor desactiva al cliente
  await db.exec(`update clientes set activo = false where token = 'tokencentro'`);
  await page.click('#btnEnviar');
  await page.locator('.toast.visible.error', { hasText: 'Link inválido o cliente inactivo' }).waitFor();
  await db.exec(`update clientes set activo = true where token = 'tokencentro'`);
  await page.close();
});

// ─────────────────────────────────────────────────────────────
// Panel de administración con respuestas simuladas
// ─────────────────────────────────────────────────────────────
console.log('Panel de administración');

const FIX = {
  ajustes: { id: 1, nombre_negocio: 'PROVEEDOR', whatsapp: null, hora_corte: '20:00:00', zona_horaria: 'America/Mexico_City' },
  productos: [
    { id: 'p1', nombre: 'Frijol negro', categoria: 'Granos', presentacion: 'Costal 25 kg', unidad: 'costal', activo: true },
    { id: 'p2', nombre: 'Aceite vegetal', categoria: 'Aceites', presentacion: 'Caja 12 L', unidad: 'caja', activo: true },
  ],
  clientes: [
    { id: 'c1', nombre: 'Café <b>Centro</b>', tipo: 'Cafetería', telefono: '5512345678', token: 'abc123', activo: true,
      sucursales: [], cliente_productos: [{ producto_id: 'p1' }] },
  ],
  pedidos: [
    { id: 'pe1', folio: 7, fecha_entrega: '2026-11-20', estado: 'recibido', notas: '<script>window.__xss=1</script>', creado: '2026-11-19T18:00:00Z',
      clientes: { nombre: 'Café Centro', direccion: 'Av. Siempre Viva 123', horario_recepcion: '7 a 10', instrucciones: null },
      pedido_lineas: [
        { sucursal_nombre: '', producto_nombre: 'Frijol negro', presentacion: 'Costal 25 kg', unidad: 'costal', cantidad: 2 },
      ] },
  ],
  pedido_lineas: [
    { producto_nombre: 'Frijol negro', presentacion: 'Costal 25 kg', unidad: 'costal', cantidad: 2, sucursal_nombre: '', pedidos: { clientes: { nombre: 'Café Centro' } } },
    { producto_nombre: 'Frijol negro', presentacion: 'Costal 25 kg', unidad: 'costal', cantidad: 3, sucursal_nombre: 'Roma', pedidos: { clientes: { nombre: 'Cocina Norte' } } },
    { producto_nombre: 'Aceite vegetal', presentacion: 'Caja 12 L', unidad: 'caja', cantidad: 1, sucursal_nombre: '', pedidos: { clientes: { nombre: 'Café Centro' } } },
  ],
};

async function abrirAdmin({ esAdmin = true } = {}) {
  const page = await navegador.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const errores = [];
  const cambios = [];
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
    if (req.method() !== 'GET') {
      cambios.push({ metodo: req.method(), tabla, query: url.search, cuerpo: req.postDataJSON() });
      return route.fulfill({ status: 204, body: '' });
    }
    const datos = FIX[tabla];
    if (datos === undefined) return json(route, { message: `tabla desconocida ${tabla}` }, 404);
    const unObjeto = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    return json(route, unObjeto && !Array.isArray(datos) ? datos : datos);
  });
  await page.goto('http://app.test/admin.html');
  return { page, errores, cambios };
}

async function iniciarSesion(page) {
  await page.fill('#correo', 'yo@ejemplo.com');
  await page.fill('#contrasena', 'secreto');
  await page.click('#btnEntrar');
}

await prueba('un usuario sin permiso no entra al panel', async () => {
  const { page } = await abrirAdmin({ esAdmin: false });
  await iniciarSesion(page);
  await page.getByText('no tiene permiso de administrador').waitFor();
  assert.match(await page.textContent('#accesoNota'), /insert into administradores \(user_id\) values \('u1'\)/);
  assert.equal(await page.isVisible('#pantallaPanel'), false);
  await page.close();
});

await prueba('pedidos: se muestran, se escapan y se cambia el estado', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.locator('.pedido').first().waitFor();
  assert.match(await page.textContent('.pedido'), /#7/);
  assert.match(await page.textContent('.pedido'), /Av\. Siempre Viva 123/);
  assert.equal(await page.textContent('.pedido-notas'), '<script>window.__xss=1</script>');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  if (CAPTURAS) await page.screenshot({ path: new URL('admin-pedidos.png', CAPTURAS).pathname });

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
  await page.locator('.pedido').first().waitFor();
  await page.click('#menu button[data-vista="compras"]');
  await page.locator('#listaCompras tbody tr').first().waitFor();
  const filas = await page.$$eval('#listaCompras tbody tr', (trs) => trs.map((tr) => [...tr.children].slice(0, 3).map((td) => td.textContent.trim())));
  assert.deepEqual(filas, [['Aceite vegetal', 'Caja 12 L (caja)', '1'], ['Frijol negro', 'Costal 25 kg (costal)', '5']]);
  assert.match(await page.textContent('#listaCompras'), /Cocina Norte \/ Roma: 3/);
  if (CAPTURAS) await page.screenshot({ path: new URL('admin-compras.png', CAPTURAS).pathname });
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('clientes: link con token y edición con productos asignados', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.locator('.pedido').first().waitFor();
  await page.click('#menu button[data-vista="clientes"]');
  await page.locator('.cliente').first().waitFor();
  assert.equal(await page.textContent('.cliente h3'), 'Café <b>Centro</b>');
  assert.equal(await page.textContent('.link-caja code'), 'http://app.test/index.html?c=abc123');

  await page.click('[data-editar-cliente="c1"]');
  await page.locator('#modalCliente.visible').waitFor();
  assert.equal(await page.isChecked('#clProductos input[value="p1"]'), true);
  assert.equal(await page.isChecked('#clProductos input[value="p2"]'), false);
  await page.check('#clProductos input[value="p2"]');
  await page.click('#btnAgregarSucursal');
  await page.fill('#clSucursales .fila input', 'Polanco');
  if (CAPTURAS) await page.screenshot({ path: new URL('admin-cliente.png', CAPTURAS).pathname });
  await page.click('#btnGuardarCliente');
  await page.locator('.toast.visible', { hasText: 'Cliente guardado' }).waitFor();

  const insercionProductos = cambios.find((c) => c.tabla === 'cliente_productos' && c.metodo === 'POST');
  assert.deepEqual(insercionProductos.cuerpo, [{ cliente_id: 'c1', producto_id: 'p1' }, { cliente_id: 'c1', producto_id: 'p2' }]);
  const nuevaSucursal = cambios.find((c) => c.tabla === 'sucursales' && c.metodo === 'POST');
  assert.deepEqual(nuevaSucursal.cuerpo, [{ cliente_id: 'c1', nombre: 'Polanco', orden: 0 }]);
  assert.deepEqual(errores, []);
  await page.close();
});

await prueba('catálogo: pegar desde Excel normaliza unidades', async () => {
  const { page, errores, cambios } = await abrirAdmin();
  await iniciarSesion(page);
  await page.locator('.pedido').first().waitFor();
  await page.click('#menu button[data-vista="catalogo"]');
  await page.click('#btnImportar');
  await page.fill('#textoImportar', 'Nombre\tCategoría\tPresentación\tUnidad\nArroz\tGranos\tBulto 50 kg\tbultos\nCloro\tLimpieza\tGalón\tlitros\nSal\t\t\t');
  assert.match(await page.textContent('#vistaImportar'), /3 productos/);
  await page.click('#btnConfirmarImportar');
  await page.locator('.toast.visible', { hasText: '3 productos agregados' }).waitFor();
  const ins = cambios.find((c) => c.tabla === 'productos' && c.metodo === 'POST');
  assert.deepEqual(ins.cuerpo, [
    { nombre: 'Arroz', categoria: 'Granos', presentacion: 'Bulto 50 kg', unidad: 'bulto' },
    { nombre: 'Cloro', categoria: 'Limpieza', presentacion: 'Galón', unidad: 'litro' },
    { nombre: 'Sal', categoria: 'General', presentacion: '', unidad: 'pieza' },
  ]);
  assert.deepEqual(errores, []);
  await page.close();
});

await navegador.close();
if (fallas) {
  console.log(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas de pantallas pasaron');
