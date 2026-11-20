// Remisión imprimible (o PDF desde el navegador).
//  * Panel:   remision.html?pedido=<uuid>  o  remision.html?fecha=AAAA-MM-DD (todas las del día)
//  * Cliente: remision.html?t=<token>&folio=<n>
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Flex, Layout, Result, Spin, Table, Typography, theme } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import {
  ESTADOS, UNIDADES, ZONA_HORARIA, db, dinero, fechaLarga, folioRemision, mensajeError, numeroALetras, textoCantidad,
} from '../comun.js';
import { Logo, Tema } from '../Tema.jsx';
import './remision.css';

const { Text } = Typography;
const q = new URLSearchParams(window.location.search);

const lineaPanel = (l) => ({
  sucursal: l.sucursal_nombre, producto: l.producto_nombre, presentacion: l.presentacion, unidad: l.unidad,
  cantidad: l.cantidad, precio_unitario: l.precio_unitario, importe: l.importe,
});

async function cargar() {
  if (!db) throw new Error('El sistema aún no está conectado a la base de datos.');
  if (q.get('t') && q.get('folio')) {
    const [rCliente, rPedidos] = await Promise.all([
      db.rpc('cliente_por_token', { p_token: q.get('t') }),
      db.rpc('pedidos_por_token', { p_token: q.get('t') }),
    ]);
    if (rCliente.error || rPedidos.error) throw new Error(mensajeError(rCliente.error || rPedidos.error));
    if (!rCliente.data) return { error: ['Link no válido', 'Este link ya no funciona. Pide uno nuevo a tu proveedor.'] };
    const pedido = (rPedidos.data || []).find((p) => Number(p.folio) === Number(q.get('folio')));
    if (!pedido) return { error: ['Pedido no encontrado', 'Solo se pueden descargar las notas de los pedidos recientes.'] };
    return { negocio: rCliente.data.negocio, hojas: [{ cliente: rCliente.data.cliente, pedido }], titulo: `Remisión ${folioRemision(pedido.folio)}` };
  }
  if (!q.get('pedido') && !/^\d{4}-\d{2}-\d{2}$/.test(q.get('fecha') || '')) {
    return { error: ['Remisión no indicada', 'Abre la remisión desde un pedido del panel.'] };
  }
  const { data: sesion } = await db.auth.getSession();
  if (!sesion.session) return { error: ['Inicia sesión', 'Abre el panel de administración e inicia sesión para imprimir remisiones.'] };
  let consulta = db.from('pedidos')
    .select('id, folio, fecha_entrega, estado, notas, creado, clientes(nombre, telefono, direccion, horario_recepcion, instrucciones), pedido_lineas(sucursal_nombre, producto_nombre, presentacion, unidad, cantidad, precio_unitario, importe)')
    .order('folio');
  consulta = q.get('pedido') ? consulta.eq('id', q.get('pedido')) : consulta.eq('fecha_entrega', q.get('fecha')).neq('estado', 'cancelado');
  const [rAjustes, rPedidos] = await Promise.all([db.from('ajustes').select('*').single(), consulta]);
  if (rAjustes.error || rPedidos.error) throw new Error(mensajeError(rAjustes.error || rPedidos.error));
  const a = rAjustes.data;
  const negocio = {
    nombre: a.nombre_negocio, color: a.color_acento, logo: a.logo, razon_social: a.razon_social, rfc: a.rfc,
    direccion: a.direccion, telefono: a.telefono, leyenda_remision: a.leyenda_remision,
  };
  if (!rPedidos.data.length) {
    return { negocio, error: ['Sin pedidos', q.get('fecha') ? `No hay pedidos para entregar el ${fechaLarga(q.get('fecha')).toLowerCase()}.` : 'No se encontró el pedido.'] };
  }
  const hojas = rPedidos.data.map((p) => ({ cliente: p.clientes || {}, pedido: { ...p, lineas: p.pedido_lineas.map(lineaPanel) } }));
  return {
    negocio, hojas,
    titulo: hojas.length === 1 ? `Remisión ${folioRemision(hojas[0].pedido.folio)} · ${hojas[0].cliente.nombre || ''}` : `Remisiones del ${fechaLarga(q.get('fecha')).toLowerCase()}`,
  };
}

function Hoja({ negocio, cliente, pedido }) {
  const lineas = [...pedido.lineas].sort((a, b) => (a.sucursal || '').localeCompare(b.sucursal || '') || a.producto.localeCompare(b.producto));
  const sucursales = [...new Set(lineas.map((l) => l.sucursal || ''))];
  const conSucursal = sucursales.length > 1 || sucursales[0] !== '';
  const total = lineas.reduce((s, l) => s + Number(l.importe || 0), 0);
  const filas = [];
  sucursales.forEach((s) => {
    const ls = lineas.filter((l) => (l.sucursal || '') === s);
    if (conSucursal) filas.push({ key: `s-${s}`, tipo: 'sucursal', texto: s || 'Sin sucursal' });
    ls.forEach((l, i) => filas.push({ key: `${s}-${i}`, ...l }));
    if (sucursales.length > 1) filas.push({ key: `t-${s}`, tipo: 'subtotal', texto: `Subtotal ${s}`, importe: ls.reduce((x, l) => x + Number(l.importe || 0), 0) });
  });
  const columnas = [
    { title: 'Cant.', dataIndex: 'cantidad', align: 'center', width: 56, onCell: (r) => (r.tipo === 'sucursal' ? { colSpan: 5 } : r.tipo === 'subtotal' ? { colSpan: 4, style: { textAlign: 'right', fontWeight: 600 } } : {}),
      render: (v, r) => (r.tipo ? r.texto : <strong>{textoCantidad(v)}</strong>) },
    { title: 'Unidad', dataIndex: 'unidad', onCell: (r) => (r.tipo ? { colSpan: 0 } : {}), render: (u) => UNIDADES[u] || u },
    { title: 'Producto', dataIndex: 'producto', onCell: (r) => (r.tipo ? { colSpan: 0 } : {}),
      render: (v, r) => <><strong>{v}</strong>{r.presentacion && <span className="gris"> · {r.presentacion}</span>}</> },
    { title: 'P. unitario', dataIndex: 'precio_unitario', align: 'right', onCell: (r) => (r.tipo ? { colSpan: 0 } : {}), render: (v) => (v != null ? dinero(v) : '—') },
    { title: 'Importe', dataIndex: 'importe', align: 'right', onCell: (r) => (r.tipo === 'sucursal' ? { colSpan: 0 } : {}),
      render: (v) => (v != null ? <span className="cifra">{dinero(v)}</span> : '—') },
  ];
  const emisor = [negocio.razon_social, negocio.rfc && `RFC ${negocio.rfc}`, negocio.direccion, negocio.telefono && `Tel. ${negocio.telefono}`].filter(Boolean);
  const creado = pedido.creado ? new Date(pedido.creado).toLocaleDateString('es-MX', { timeZone: ZONA_HORARIA, day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <article className="hoja">
      <header className="hoja-cab">
        <div className="emisor">
          <Logo logo={negocio.logo} nombre={negocio.nombre} size={58} />
          <div><h1>{negocio.nombre}</h1>{emisor.map((t) => <div key={t} className="dato">{t}</div>)}</div>
        </div>
        <div className="doc">
          <div className="tipo">REMISIÓN</div>
          <div className="folio">{folioRemision(pedido.folio)}</div>
          <dl>
            <dt>Entrega</dt><dd>{fechaLarga(pedido.fecha_entrega, true)}</dd>
            {creado && <><dt>Pedido</dt><dd>{creado}</dd></>}
            <dt>Estado</dt><dd>{ESTADOS[pedido.estado] || pedido.estado}</dd>
          </dl>
        </div>
      </header>
      <section className="receptor">
        <div className="caja">
          <div className="rotulo">Cliente</div>
          <div className="nombre">{cliente.nombre}</div>
          {cliente.direccion && <div className="gris">{cliente.direccion}</div>}
          {cliente.telefono && <div className="gris">Tel. {cliente.telefono}</div>}
        </div>
        <div className="caja">
          <div className="rotulo">Entrega</div>
          <div><strong>{fechaLarga(pedido.fecha_entrega)}</strong></div>
          {cliente.horario_recepcion && <div className="gris">Horario: {cliente.horario_recepcion}</div>}
          {cliente.instrucciones && <div className="gris">{cliente.instrucciones}</div>}
        </div>
      </section>
      <Table size="small" bordered pagination={false} columns={columnas} dataSource={filas}
        rowClassName={(r) => (r.tipo === 'sucursal' ? 'fila-sucursal' : r.tipo === 'subtotal' ? 'fila-subtotal' : '')} />
      <section className="totales">
        <div className="letra"><strong>Importe con letra</strong>{numeroALetras(total)}</div>
        <div className="total-caja"><span>TOTAL</span><strong>{dinero(total)}</strong></div>
      </section>
      {pedido.notas && <div className="notas"><strong>Notas:</strong> {pedido.notas}</div>}
      <footer className="pie">
        <div className="recibi">Recibí de conformidad</div>
        <div className="firma">Nombre</div><div className="firma">Firma</div><div className="firma">Fecha y hora</div>
        {negocio.leyenda_remision && <div className="leyenda">{negocio.leyenda_remision}</div>}
      </footer>
    </article>
  );
}

function Remision({ alCargarMarca }) {
  const { token } = theme.useToken();
  const [r, setR] = useState(null);
  useEffect(() => {
    cargar().then((x) => {
      setR(x);
      if (x.negocio) alCargarMarca(x.negocio.color);
      if (x.titulo) document.title = x.titulo;
    }).catch((e) => setR({ error: ['No se pudo cargar', e.message] }));
  }, []);

  const listo = r && !r.error;
  return (
    <Layout style={{ minHeight: '100vh', '--acento': token.colorPrimary }}>
      <Layout.Header className="sin-imprimir barra-herramientas" style={{
        position: 'sticky', top: 0, zIndex: 10, height: 'auto', lineHeight: 1.4, padding: 0, borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}>
        <Flex align="center" gap={10} wrap style={{ maxWidth: 860, margin: '0 auto', padding: '10px 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong id="titulo">{r?.titulo || 'Remisión'}</Text>
            <div><Text type="secondary" style={{ fontSize: 12 }}>
              {!r ? 'Cargando…' : r.error ? r.error[0] : r.hojas.length === 1 ? 'Lista para imprimir o guardar como PDF' : `${r.hojas.length} remisiones, una por página`}
            </Text></div>
          </div>
          <Button onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}>Cerrar</Button>
          <Button type="primary" icon={<PrinterOutlined />} disabled={!listo} onClick={() => window.print()} id="btnImprimir">Imprimir / Guardar PDF</Button>
        </Flex>
      </Layout.Header>
      {!r && <Flex justify="center" style={{ padding: 80 }}><Spin size="large" /></Flex>}
      {r?.error && <Result status="warning" title={r.error[0]} subTitle={r.error[1]} />}
      {listo && (
        <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: token.colorPrimary } }}>
          <main className="hojas">{r.hojas.map((h) => <Hoja key={h.pedido.folio} negocio={r.negocio} {...h} />)}</main>
        </ConfigProvider>
      )}
    </Layout>
  );
}

function Raiz() {
  const [color, setColor] = useState(null);
  return <Tema color={color} modo="sistema"><Remision alCargarMarca={setColor} /></Tema>;
}

createRoot(document.getElementById('root')).render(<Raiz />);
