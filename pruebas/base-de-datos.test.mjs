// Prueba la migración de Supabase en un Postgres local (PGlite), simulando lo
// mínimo de Supabase: el esquema auth, auth.uid() y los roles anon/authenticated.
// Uso: node base-de-datos.test.mjs
import { crearBD } from './bd-prueba.mjs';
import assert from 'node:assert/strict';

const db = await crearBD();

let fallas = 0;
async function prueba(nombre, fn) {
  try {
    await db.exec('reset role; reset request.jwt.claim.sub;');
    await fn();
    console.log('  ok   ', nombre);
  } catch (e) {
    fallas++;
    console.log('  FALLA', nombre, '\n        ', e.message);
  }
}
const como = async (rol, sub = '') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role ${rol};`);
};
const uno = async (sql, params) => (await db.query(sql, params)).rows[0];
async function falla(sql, params, mensaje) {
  await assert.rejects(db.query(sql, params), (e) => {
    assert.match(e.message, mensaje);
    return true;
  });
}

// Datos de ejemplo (como superusuario)
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const OTRO = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
  insert into auth.users values ('${ADMIN}'), ('${OTRO}');
  insert into administradores values ('${ADMIN}');
  insert into productos (id, nombre, categoria, presentacion, unidad) values
    ('10000000-0000-0000-0000-000000000001', 'Frijol negro', 'Granos', 'Costal 25 kg', 'costal'),
    ('10000000-0000-0000-0000-000000000002', 'Aceite vegetal', 'Aceites', 'Caja 12 L', 'caja'),
    ('10000000-0000-0000-0000-000000000003', 'Cloro', 'Limpieza', 'Galón 3.7 L', 'pieza');
  insert into clientes (id, nombre, token) values
    ('20000000-0000-0000-0000-000000000001', 'Café Centro', 'tokencentro'),
    ('20000000-0000-0000-0000-000000000002', 'Cocina Norte', 'tokennorte');
  insert into sucursales (id, cliente_id, nombre) values
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Roma'),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Condesa');
  update productos set precio_base = 500, costo = 400 where nombre = 'Frijol negro';
  insert into cliente_productos (cliente_id, producto_id, precio) values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 450.50),
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 380),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 55);
`);
const P1 = '10000000-0000-0000-0000-000000000001';
const P2 = '10000000-0000-0000-0000-000000000002';
const P3 = '10000000-0000-0000-0000-000000000003';
const SUC_ROMA = '30000000-0000-0000-0000-000000000001';
const fechaMin = (await uno('select fecha_minima_entrega()::text as f')).f;
const sumarDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lineas = (arr) => JSON.stringify(arr);

console.log('Base de datos');

await prueba('el público no puede leer ni escribir las tablas', async () => {
  await como('anon');
  for (const t of ['clientes', 'pedidos', 'productos', 'ajustes', 'pedido_lineas']) {
    await falla(`select * from ${t}`, [], /permission denied/);
  }
  await falla(`insert into productos (nombre) values ('x')`, [], /permission denied/);
});

await prueba('un usuario con sesión que no es admin no ve nada', async () => {
  await como('authenticated', OTRO);
  assert.equal((await db.query('select * from clientes')).rows.length, 0);
  await falla(`insert into productos (nombre) values ('x')`, [], /row-level security/);
});

await prueba('el admin ve y edita todo', async () => {
  await como('authenticated', ADMIN);
  assert.equal((await db.query('select * from clientes')).rows.length, 2);
  await db.query(`update ajustes set whatsapp = '5215512345678' where id = 1`);
  assert.equal((await uno('select whatsapp from ajustes')).whatsapp, '5215512345678');
});

await prueba('cliente_por_token devuelve solo sus productos y sucursales', async () => {
  await como('anon');
  const r = (await uno(`select cliente_por_token('tokennorte') as r`)).r;
  assert.equal(r.cliente.nombre, 'Cocina Norte');
  assert.deepEqual(r.productos.map((p) => p.nombre), ['Cloro']);
  assert.deepEqual(r.sucursales.map((s) => s.nombre).sort(), ['Condesa', 'Roma']);
  assert.equal(r.negocio.nombre, 'PROVEEDOR');
  assert.equal(r.fecha_minima, fechaMin);
});

await prueba('un token inválido no devuelve nada', async () => {
  await como('anon');
  assert.equal((await uno(`select cliente_por_token('nope') as r`)).r, null);
});

await prueba('la fecha mínima es mañana sin hora de corte', async () => {
  const hoy = (await uno(`select (now() at time zone 'America/Mexico_City')::date::text as h`)).h;
  assert.equal(fechaMin, sumarDias(hoy, 1));
});

await prueba('crear un pedido válido', async () => {
  await como('anon');
  const r = (await uno(`select crear_pedido('tokencentro', $1, $2, 'Tocar el timbre') as r`,
    [fechaMin, lineas([{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }])])).r;
  assert.ok(r.folio > 0);
  await como('authenticated', ADMIN);
  const l = await db.query(`select producto_nombre, cantidad from pedido_lineas order by producto_nombre`);
  assert.deepEqual(l.rows.map((x) => [x.producto_nombre, Number(x.cantidad)]), [['Aceite vegetal', 1], ['Frijol negro', 2]]);
});

await prueba('no permite dos pedidos el mismo día', async () => {
  await como('anon');
  await falla(`select crear_pedido('tokencentro', $1, $2)`,
    [fechaMin, lineas([{ producto_id: P1, cantidad: 1 }])], /Ya tienes un pedido para ese día/);
});

await prueba('no permite pedir para hoy ni fechas pasadas', async () => {
  await como('anon');
  await falla(`select crear_pedido('tokencentro', $1, $2)`,
    [sumarDias(fechaMin, -1), lineas([{ producto_id: P1, cantidad: 1 }])], /ya no está disponible/);
});

await prueba('no permite productos que no tiene asignados', async () => {
  await como('anon');
  await falla(`select crear_pedido('tokencentro', $1, $2)`,
    [sumarDias(fechaMin, 1), lineas([{ producto_id: P3, cantidad: 1 }])], /ya no está disponible/);
});

await prueba('rechaza cantidades inválidas y pedidos vacíos', async () => {
  await como('anon');
  const f = sumarDias(fechaMin, 2);
  await falla(`select crear_pedido('tokencentro', $1, $2)`, [f, lineas([{ producto_id: P1, cantidad: 0 }])], /Cantidad inválida/);
  await falla(`select crear_pedido('tokencentro', $1, $2)`, [f, lineas([{ producto_id: P1, cantidad: 1000 }])], /Cantidad inválida/);
  await falla(`select crear_pedido('tokencentro', $1, $2)`, [f, '[]'], /no tiene productos/);
});

await prueba('un pedido fallido no deja rastros', async () => {
  await como('authenticated', ADMIN);
  const n = (await uno(`select count(*)::int as n from pedidos`)).n;
  assert.equal(n, 1);
});

await prueba('clientes con sucursales deben indicar la sucursal', async () => {
  await como('anon');
  const f = sumarDias(fechaMin, 1);
  await falla(`select crear_pedido('tokennorte', $1, $2)`, [f, lineas([{ producto_id: P3, cantidad: 1 }])], /sucursal/);
  await falla(`select crear_pedido('tokennorte', $1, $2)`,
    [f, lineas([{ producto_id: P3, cantidad: 1, sucursal_id: '30000000-0000-0000-0000-0000000000ff' }])], /Sucursal inválida/);
  const r = (await uno(`select crear_pedido('tokennorte', $1, $2) as r`,
    [f, lineas([{ producto_id: P3, cantidad: 4, sucursal_id: SUC_ROMA }])])).r;
  assert.ok(r.folio);
});

await prueba('pedidos_por_token solo devuelve los pedidos de ese cliente', async () => {
  await como('anon');
  const r = (await uno(`select pedidos_por_token('tokennorte') as r`)).r;
  assert.equal(r.length, 1);
  assert.equal(r[0].estado, 'recibido');
  assert.deepEqual(r[0].lineas, [{ sucursal: 'Roma', producto: 'Cloro', presentacion: 'Galón 3.7 L', unidad: 'pieza', cantidad: 4, precio_unitario: 55, importe: 220 }]);
  assert.equal(r[0].total, 220);
});

await prueba('un cliente desactivado ya no puede pedir', async () => {
  await como('authenticated', ADMIN);
  await db.query(`update clientes set activo = false where token = 'tokencentro'`);
  await como('anon');
  assert.equal((await uno(`select cliente_por_token('tokencentro') as r`)).r, null);
  await falla(`select crear_pedido('tokencentro', $1, $2)`,
    [sumarDias(fechaMin, 3), lineas([{ producto_id: P1, cantidad: 1 }])], /Link inválido/);
});

await prueba('un pedido cancelado libera el día', async () => {
  await como('authenticated', ADMIN);
  await db.query(`update clientes set activo = true where token = 'tokencentro'`);
  await db.query(`update pedidos set estado = 'cancelado' where fecha_entrega = $1`, [fechaMin]);
  await como('anon');
  const r = (await uno(`select crear_pedido('tokencentro', $1, $2) as r`,
    [fechaMin, lineas([{ producto_id: P1, cantidad: 3 }])])).r;
  assert.ok(r.folio);
});

await prueba('la hora de corte recorre la fecha mínima un día', async () => {
  await db.exec(`update ajustes set hora_corte = '00:00'`);
  assert.equal((await uno('select fecha_minima_entrega()::text as f')).f, sumarDias(fechaMin, 1));
  await db.exec(`update ajustes set hora_corte = null`);
});

await prueba('el cliente ve su precio pero nunca el costo ni el precio base', async () => {
  await como('anon');
  const r = (await uno(`select cliente_por_token('tokencentro') as r`)).r;
  const frijol = r.productos.find((p) => p.nombre === 'Frijol negro');
  assert.equal(frijol.precio, 450.5);
  assert.equal('costo' in frijol, false);
  assert.equal('precio_base' in frijol, false);
  assert.doesNotMatch(JSON.stringify(r), /costo|precio_base/);
});

await prueba('el pedido congela el precio y calcula el total', async () => {
  await como('anon');
  const f = sumarDias(fechaMin, 5);
  const r = (await uno(`select crear_pedido('tokencentro', $1, $2) as r`,
    [f, lineas([{ producto_id: P1, cantidad: 2 }, { producto_id: P2, cantidad: 1 }])])).r;
  assert.equal(Number(r.total), 1281);
  await como('authenticated', ADMIN);
  await db.query(`update cliente_productos set precio = 999 where producto_id = $1`, [P1]);
  const l = await uno(`select l.precio_unitario::float as pu, l.importe::float as imp from pedido_lineas l
    join pedidos p on p.id = l.pedido_id where p.fecha_entrega = $1 and l.producto_id = $2`, [f, P1]);
  assert.deepEqual(l, { pu: 450.5, imp: 901 });
  await db.query(`update cliente_productos set precio = 450.50 where producto_id = $1`, [P1]);
});

await prueba('no permite pedir productos sin precio', async () => {
  await como('authenticated', ADMIN);
  await db.query(`update cliente_productos set precio = 0 where producto_id = $1`, [P2]);
  await como('anon');
  await falla(`select crear_pedido('tokencentro', $1, $2)`,
    [sumarDias(fechaMin, 6), lineas([{ producto_id: P2, cantidad: 1 }])], /sin precio/);
  await como('authenticated', ADMIN);
  await db.query(`update cliente_productos set precio = 380 where producto_id = $1`, [P2]);
});

await prueba('resumen_clientes: solo el admin lo ve, con conteos correctos', async () => {
  await como('anon');
  await falla('select * from resumen_clientes', [], /permission denied/);
  await como('authenticated', OTRO);
  assert.equal((await db.query('select * from resumen_clientes')).rows.length, 0);
  await como('authenticated', ADMIN);
  await db.query(`update cliente_productos set precio = 0 where producto_id = $1`, [P2]);
  const r = await uno(`select productos, productos_sin_precio, ultima_entrega is not null as con_pedido
    from resumen_clientes where nombre = 'Café Centro'`);
  assert.deepEqual(r, { productos: 2, productos_sin_precio: 1, con_pedido: true });
  await db.query(`update cliente_productos set precio = 380 where producto_id = $1`, [P2]);
});

await prueba('el público no puede usar funciones internas', async () => {
  await como('anon');
  await falla(`select es_admin()`, [], /permission denied/);
});

await prueba('granel: decimales en productos por kilo, enteros en los demás', async () => {
  await como('authenticated', ADMIN);
  await db.query(`insert into productos (id, nombre, categoria, presentacion, unidad) values
    ('10000000-0000-0000-0000-0000000000a1', 'Arroz a granel', 'Granos', 'Por kilo', 'kilo')`);
  await db.query(`insert into cliente_productos (cliente_id, producto_id, precio) values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 33.33)`);
  const ARROZ = '10000000-0000-0000-0000-0000000000a1';
  const f = sumarDias(fechaMin, 20);
  await como('anon');
  // 2.5 kg × $33.33 = $83.325 → $83.33; 1 caja de aceite $380
  const r = (await uno(`select crear_pedido('tokencentro', $1, $2) as r`,
    [f, lineas([{ producto_id: ARROZ, cantidad: 2.5 }, { producto_id: P2, cantidad: 1 }])])).r;
  assert.equal(Number(r.total), 463.33);
  await como('authenticated', ADMIN);
  const l = await uno(`select l.cantidad::float as c, l.importe::float as imp from pedido_lineas l
    join pedidos p on p.id = l.pedido_id where p.fecha_entrega = $1 and l.producto_id = $2`, [f, ARROZ]);
  assert.deepEqual(l, { c: 2.5, imp: 83.33 });
  const suma = await uno(`select sum(l.importe)::float as s from pedido_lineas l join pedidos p on p.id = l.pedido_id where p.fecha_entrega = $1`, [f]);
  assert.equal(suma.s, 463.33);

  // El administrador ajusta al peso real y el importe se recalcula solo
  await db.query(`update pedido_lineas set cantidad = 2.37 where producto_id = $1`, [ARROZ]);
  assert.equal((await uno(`select importe::float as imp from pedido_lineas where producto_id = $1`, [ARROZ])).imp, 78.99);

  await como('anon');
  const g = sumarDias(fechaMin, 21);
  await falla(`select crear_pedido('tokencentro', $1, $2)`, [g, lineas([{ producto_id: P2, cantidad: 1.5 }])], /solo se vende por pieza completa/);
  for (const mala of [0, -1, 1.2345, 'mucho', 1000]) {
    await falla(`select crear_pedido('tokencentro', $1, $2)`, [g, lineas([{ producto_id: ARROZ, cantidad: mala }])], /Cantidad inválida/);
  }
  await como('authenticated', ADMIN);
  assert.equal((await uno(`select count(*)::int as n from pedidos where fecha_entrega = $1`, [g])).n, 0);
});

await prueba('el cliente recibe la marca y los datos del negocio, sin costos', async () => {
  await como('authenticated', ADMIN);
  await db.query(`update ajustes set color_acento = '#1d4ed8', logo = 'data:image/png;base64,AAAA', rfc = 'XAXX010101000' where id = 1`);
  await como('anon');
  const r = (await uno(`select cliente_por_token('tokencentro') as r`)).r;
  assert.equal(r.negocio.color, '#1d4ed8');
  assert.equal(r.negocio.logo, 'data:image/png;base64,AAAA');
  assert.equal(r.negocio.rfc, 'XAXX010101000');
  assert.match(r.negocio.leyenda_remision, /IVA incluido/);
  assert.doesNotMatch(JSON.stringify(r), /costo|precio_base|token/);
  await como('authenticated', ADMIN);
  await db.query(`update ajustes set color_acento = '#0f766e', logo = null, rfc = null where id = 1`);
});

await prueba('ajustes rechaza un color o un logo inválidos', async () => {
  await como('authenticated', ADMIN);
  await falla(`update ajustes set color_acento = 'rojo' where id = 1`, [], /check constraint/);
  await falla(`update ajustes set logo = 'https://otro.sitio/logo.png' where id = 1`, [], /check constraint/);
  await falla(`update ajustes set logo = 'data:text/html;base64,PHNjcmlwdD4=' where id = 1`, [], /check constraint/);
});

await prueba('estadisticas_ventas: solo para el administrador', async () => {
  await como('anon');
  await falla(`select estadisticas_ventas(current_date, current_date)`, [], /permission denied/);
  await como('authenticated', OTRO);
  await falla(`select estadisticas_ventas(current_date, current_date)`, [], /Solo el administrador/);
});

await prueba('estadisticas_ventas: totales, días vacíos, periodo anterior y tops', async () => {
  await como('authenticated', ADMIN);
  await db.exec(`delete from pedido_lineas; delete from pedidos;`);
  const desde = sumarDias(fechaMin, 10);
  const hasta = sumarDias(desde, 6);           // 7 días
  const pedir = async (token, f, ls) => {
    await como('anon');
    await db.query(`select crear_pedido($1, $2, $3)`, [token, f, lineas(ls)]);
  };
  await pedir('tokencentro', desde, [{ producto_id: P1, cantidad: 2 }]);                        // 901
  await pedir('tokencentro', sumarDias(desde, 2), [{ producto_id: P2, cantidad: 1 }]);          // 380
  await pedir('tokennorte', sumarDias(desde, 2), [{ producto_id: P3, sucursal_id: SUC_ROMA, cantidad: 4 }]); // 220
  await pedir('tokencentro', sumarDias(desde, -3), [{ producto_id: P2, cantidad: 2 }]);         // 760, periodo anterior
  await pedir('tokencentro', sumarDias(desde, 4), [{ producto_id: P1, cantidad: 10 }]);         // cancelado
  await como('authenticated', ADMIN);
  await db.query(`update pedidos set estado = 'cancelado' where fecha_entrega = $1`, [sumarDias(desde, 4)]);

  const r = (await uno(`select estadisticas_ventas($1, $2) as r`, [desde, hasta])).r;
  assert.equal(r.por_dia.length, 7);
  assert.deepEqual(r.por_dia.map((d) => Number(d.total)), [901, 0, 600, 0, 0, 0, 0]);
  assert.deepEqual(r.por_dia.map((d) => d.pedidos), [1, 0, 2, 0, 0, 0, 0]);
  assert.equal(r.por_dia[0].fecha, desde);
  assert.deepEqual([Number(r.totales.total), r.totales.pedidos, Number(r.totales.ticket_promedio)], [1501, 3, 500.33]);
  assert.deepEqual([Number(r.periodo_anterior.total), r.periodo_anterior.pedidos], [760, 1]);
  assert.deepEqual(r.top_clientes.map((c) => [c.nombre, Number(c.total), c.pedidos]), [['Café Centro', 1281, 2], ['Cocina Norte', 220, 1]]);
  assert.deepEqual(r.top_productos.map((p) => [p.nombre, Number(p.total), p.cantidad]),
    [['Frijol negro', 901, 2], ['Aceite vegetal', 380, 1], ['Cloro', 220, 4]]);
  await falla(`select estadisticas_ventas($1, $2)`, [hasta, desde], /Periodo inválido/);
});

if (fallas) {
  console.log(`\n${fallas} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas de base de datos pasaron');
