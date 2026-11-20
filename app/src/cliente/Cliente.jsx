// Pantalla del cliente: elige fecha de entrega, cantidades por producto (y sucursal), revisa y envía.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, App, Badge, Button, Calendar, Card, Divider, Drawer, Empty, Flex, Input, InputNumber, Layout,
  Result, Space, Spin, Tag, Typography, theme,
} from 'antd';
import {
  CalendarOutlined, CarOutlined, CheckCircleFilled, EnvironmentOutlined, FileTextOutlined,
  HistoryOutlined, MinusOutlined, PlusOutlined, RightOutlined, WhatsAppOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  COLOR_ESTADO, ESTADOS, db, dinero, fechaCorta, fechaLarga, mensajeError, plural, sumarDias, textoPresentacion,
} from '../comun.js';
import { Logo, useIconoMarca } from '../Tema.jsx';
import Hoja from '../Hoja.jsx';

const { Text, Title } = Typography;
const DIAS_EN_TIRA = 14;
// Código del cliente: del link, o el guardado si la app instalada se abre sin él
const token = (() => {
  const delLink = new URLSearchParams(window.location.search).get('c');
  try {
    if (delLink) { localStorage.setItem('codigoCliente', delLink); return delLink; }
    const guardado = localStorage.getItem('codigoCliente');
    if (guardado) window.history.replaceState(null, '', `${window.location.pathname}?c=${encodeURIComponent(guardado)}`);
    return guardado;
  } catch { return delLink; }
})();
const tienePrecio = (p) => Number(p.precio) > 0;

export default function Cliente({ alCargarMarca }) {
  const { message } = App.useApp();
  const { token: t } = theme.useToken();

  const [estado, setEstado] = useState({ tipo: 'cargando' });
  const [datos, setDatos] = useState(null);
  useIconoMarca({ logo: datos?.negocio?.logo, nombre: datos?.negocio?.nombre, color: datos?.negocio?.color });
  const [pedidos, setPedidos] = useState([]);
  const [cantidades, setCantidades] = useState({});        // { 'iSucursal:iProducto': n }
  const [fecha, setFecha] = useState(null);
  const [notas, setNotas] = useState('');
  const [calendario, setCalendario] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(null);
  const [historial, setHistorial] = useState(false);
  const tiraRef = useRef(null);

  const sucursales = useMemo(() => (datos?.sucursales?.length ? datos.sucursales : [{ id: null, nombre: '' }]), [datos]);
  const porCategoria = useMemo(() => {
    const grupos = {};
    (datos?.productos || []).forEach((p, i) => (grupos[p.categoria] ||= []).push([p, i]));
    return Object.entries(grupos);
  }, [datos]);

  async function cargarPedidos() {
    const { data } = await db.rpc('pedidos_por_token', { p_token: token });
    setPedidos(data || []);
    return data || [];
  }

  useEffect(() => {
    (async () => {
      if (!db) return setEstado({ tipo: 'error', titulo: 'Falta configurar', texto: 'El sistema aún no está conectado a la base de datos.' });
      if (!token) return setEstado({ tipo: 'error', titulo: 'Link incompleto', texto: 'Pide a tu proveedor el link para hacer pedidos.' });
      const { data, error } = await db.rpc('cliente_por_token', { p_token: token });
      if (error) return setEstado({ tipo: 'error', titulo: 'No se pudo cargar', texto: mensajeError(error) });
      if (!data) return setEstado({ tipo: 'error', titulo: 'Link no válido', texto: 'Este link ya no funciona. Pide uno nuevo a tu proveedor.' });
      setDatos(data);
      alCargarMarca?.(data.negocio.color);
      document.title = `Pedidos · ${data.cliente.nombre}`;
      if (!data.productos.length) return setEstado({ tipo: 'error', titulo: 'Sin productos', texto: 'Tu proveedor todavía no te ha asignado productos.', vacio: true });
      await cargarPedidos();
      setEstado({ tipo: 'listo' });
    })();
  }, []);

  const pedidoDelDia = (f) => pedidos.find((p) => p.fecha_entrega === f && p.estado !== 'cancelado');
  const existente = fecha ? pedidoDelDia(fecha) : null;
  const bloqueado = !fecha || !!existente;

  const lineas = Object.entries(cantidades).filter(([, v]) => v > 0).map(([clave, cantidad]) => {
    const [si, pi] = clave.split(':').map(Number);
    const producto = datos.productos[pi];
    return { si, sucursal: sucursales[si], producto, cantidad, importe: cantidad * Number(producto.precio) };
  }).sort((a, b) => a.si - b.si);
  const total = lineas.reduce((a, l) => a + l.importe, 0);
  const barraVisible = lineas.length > 0 && !bloqueado;

  const fijar = (clave, valor) => setCantidades((c) => ({ ...c, [clave]: Math.max(0, Math.min(999, Math.round(Number(valor) || 0))) }));

  function elegirFecha(f) {
    setFecha(f);
    setCalendario(false);
  }

  useEffect(() => {
    tiraRef.current?.querySelector('[data-seleccionado="si"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [fecha]);

  async function confirmar() {
    setEnviando(true);
    const { data, error } = await db.rpc('crear_pedido', {
      p_token: token,
      p_fecha_entrega: fecha,
      p_lineas: lineas.map((l) => ({ sucursal_id: l.sucursal.id, producto_id: l.producto.id, cantidad: l.cantidad })),
      p_notas: notas.trim(),
    });
    setEnviando(false);
    if (error) return message.error(mensajeError(error));
    setExito({ folio: data.folio, fecha, lineas, notas: notas.trim(), total: Number(data.total) });
    setRevisando(false);
    setCantidades({});
    setNotas('');
    await cargarPedidos();
  }

  function avisarWhatsApp() {
    const u = exito;
    let msg = `*Pedido #${u.folio}*\n${datos.cliente.nombre}\nEntrega: ${fechaLarga(u.fecha, true)}\n`;
    sucursales.forEach((s, si) => {
      const items = u.lineas.filter((l) => l.si === si);
      if (!items.length) return;
      msg += s.nombre ? `\n*${s.nombre}*\n` : '\n';
      items.forEach((l) => {
        const p = l.producto;
        msg += `• ${p.nombre}${p.presentacion ? ` (${p.presentacion})` : ''}: *${l.cantidad}* × ${dinero(p.precio)} = ${dinero(l.importe)}\n`;
      });
    });
    msg += `\n*Total: ${dinero(u.total)}*`;
    if (u.notas) msg += `\nNotas: ${u.notas}`;
    window.open(`https://wa.me/${datos.negocio.whatsapp || ''}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  // ─────────── Cabecera ───────────
  const negocio = datos?.negocio;
  const atajos = !datos ? [] : sucursales.length > 1
    ? sucursales.map((s, si) => [`suc-${si}`, s.nombre])
    : porCategoria.map(([cat], ci) => [`cat-0-${ci}`, cat]);

  const cabecera = (
    <Layout.Header className="margen-superior" style={{
      position: 'sticky', top: 0, zIndex: 50, height: 'auto', lineHeight: 1.4, padding: 0,
      background: t.colorBgContainer, borderBottom: `1px solid ${t.colorBorderSecondary}`,
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '12px 16px' }}>
        <Flex align="center" justify="space-between" gap={12}>
          <Flex align="center" gap={10} style={{ minWidth: 0 }}>
            <Logo logo={negocio?.logo} nombre={negocio?.nombre || 'PROVEEDOR'} size={32} />
            <Text strong id="negocio" ellipsis>{negocio?.nombre || 'PROVEEDOR'}</Text>
          </Flex>
          {datos && <Button id="btnHistorial" icon={<HistoryOutlined />} onClick={() => setHistorial(true)} aria-label="Mis pedidos">
            <span className="texto-historial">Mis pedidos</span></Button>}
        </Flex>
        {datos && (
          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>Pedido para</Text>
            <Title level={3} id="clienteNombre" style={{ margin: 0 }}>{datos.cliente.nombre}</Title>
          </div>
        )}
        {estado.tipo === 'listo' && atajos.length > 1 && (
          <Flex gap={6} id="chips" style={{ overflowX: 'auto', margin: '10px -16px 0', padding: '0 16px 2px', scrollbarWidth: 'none' }}>
            {atajos.map(([id, txt]) => (
              <Button key={id} shape="round" size="small" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{txt}</Button>
            ))}
          </Flex>
        )}
      </div>
    </Layout.Header>
  );

  if (estado.tipo !== 'listo') {
    return (
      <Layout className="pantalla-completa">
        {cabecera}
        <Layout.Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {estado.tipo === 'cargando'
            ? <Spin size="large" tip="Cargando…"><div style={{ width: 120, height: 80 }} /></Spin>
            : estado.vacio
              ? <Empty description={<><Title level={4}>{estado.titulo}</Title><Text type="secondary">{estado.texto}</Text></>} />
              : <Result status="warning" title={estado.titulo} subTitle={estado.texto} />}
        </Layout.Content>
      </Layout>
    );
  }

  // ─────────── Tira de días ───────────
  const fechas = Array.from({ length: DIAS_EN_TIRA }, (_, i) => sumarDias(datos.fecha_minima, i));
  if (fecha && !fechas.includes(fecha)) fechas.push(fecha);
  const tira = (
    <div id="tiraDias" ref={tiraRef} style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 2px 10px', scrollbarWidth: 'none' }}>
      {fechas.map((f) => {
        const d = new Date(f + 'T12:00:00Z');
        const sel = f === fecha;
        const con = !!pedidoDelDia(f);
        return (
          <button
            key={f} type="button" data-fecha={f} data-seleccionado={sel ? 'si' : 'no'} data-con-pedido={con ? 'si' : 'no'}
            aria-label={fechaLarga(f)} aria-pressed={sel} onClick={() => elegirFecha(f)}
            style={{
              flex: '0 0 auto', width: 62, padding: '8px 0 9px', borderRadius: 12, cursor: 'pointer', position: 'relative',
              border: `1px solid ${sel ? t.colorPrimary : t.colorBorder}`, background: sel ? t.colorPrimary : t.colorBgContainer,
              color: sel ? '#fff' : t.colorText, boxShadow: sel ? `0 6px 16px ${t.colorPrimary}55` : t.boxShadowTertiary, fontFamily: 'inherit',
            }}
          >
            {con && <span style={{ position: 'absolute', top: 6, right: 7, width: 7, height: 7, borderRadius: '50%', background: sel ? '#fff' : t.colorSuccess }} />}
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.75, textTransform: 'capitalize' }}>{d.toLocaleDateString('es-MX', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}</div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{d.getUTCDate()}</div>
            <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'capitalize' }}>{d.toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' }).replace('.', '')}</div>
          </button>
        );
      })}
    </div>
  );

  const tituloSeccion = (n, texto, extra, nota) => (
    <Flex align="center" justify="space-between" style={{ margin: '24px 0 12px' }}>
      <Space size={10} align="center">
        <Badge count={n} color={t.colorPrimary} />
        <Text strong style={{ fontSize: 16 }}>{texto}</Text>
        {nota && <Text type="secondary">{nota}</Text>}
      </Space>
      {extra}
    </Flex>
  );

  // ─────────── Productos ───────────
  const control = (clave, p) => {
    const n = cantidades[clave] || 0;
    const des = !tienePrecio(p);
    return (
      <Space.Compact size="large">
        <Button aria-label="Menos" icon={<MinusOutlined />} disabled={des || n === 0} onClick={() => fijar(clave, n - 1)} />
        <InputNumber
          aria-label="Cantidad" inputMode="numeric" pattern="[0-9]*" controls={false} min={0} max={999} precision={0} disabled={des}
          value={n} onChange={(v) => fijar(clave, v)} onFocus={(e) => e.target.select()}
          style={{ width: 58, textAlign: 'center', fontWeight: 700 }} className="cifra"
        />
        <Button aria-label="Más" icon={<PlusOutlined />} disabled={des} onClick={() => fijar(clave, n + 1)} />
      </Space.Compact>
    );
  };

  const productos = sucursales.map((s, si) => {
    const enSucursal = lineas.filter((l) => l.si === si).length;
    return (
      <section key={si} id={`suc-${si}`} className="sucursal" style={{ scrollMarginTop: 170, marginTop: 8 }}>
        {s.nombre && (
          <Flex align="center" justify="space-between" style={{ padding: '8px 2px 10px' }}>
            <Title level={5} className="sucursal-titulo" style={{ margin: 0 }}><EnvironmentOutlined style={{ color: t.colorPrimary }} /> {s.nombre}</Title>
            <Tag id={`total-${si}`} bordered={false} color={enSucursal ? 'processing' : 'default'}>{enSucursal}</Tag>
          </Flex>
        )}
        {porCategoria.map(([cat, lista], ci) => (
          <Card key={cat} id={`cat-${si}-${ci}`} size="small" title={<Text type="secondary" style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase' }}>{cat}</Text>}
            style={{ marginBottom: 12, scrollMarginTop: 170 }} styles={{ body: { padding: 0 } }}>
            {lista.map(([p, pi], i) => {
              const clave = `${si}:${pi}`;
              const n = cantidades[clave] || 0;
              return (
                <Flex key={p.id} className="producto" data-producto={p.nombre} align="center" justify="space-between" gap={12}
                  style={{ padding: '12px 16px', borderTop: i ? `1px solid ${t.colorBorderSecondary}` : 0, background: n ? t.colorPrimaryBg : undefined }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                    <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>{textoPresentacion(p)}</Text>
                    {tienePrecio(p) ? (
                      <div className="cifra" style={{ fontWeight: 600, marginTop: 2 }}>
                        {dinero(p.precio)}
                        {n > 0 && <Text style={{ color: t.colorPrimary, fontWeight: 600, marginLeft: 6 }} className="subtotal">× {n} = {dinero(n * p.precio)}</Text>}
                      </div>
                    ) : <Text type="warning" style={{ fontSize: 13, display: 'block' }}>Precio por confirmar</Text>}
                  </div>
                  {control(clave, p)}
                </Flex>
              );
            })}
          </Card>
        ))}
      </section>
    );
  });

  const lineasAgrupadas = (ls, renglon) => sucursales.map((s, si) => {
    const grupo = ls.filter((l) => l.si === si);
    if (!grupo.length) return null;
    return (
      <div key={si}>
        {s.nombre && <Divider orientation="left" plain style={{ margin: '12px 0 4px', fontSize: 12 }}>{s.nombre}</Divider>}
        {grupo.map(renglon)}
      </div>
    );
  });

  return (
    <Layout className="pantalla-completa">
      {cabecera}
      <Layout.Content style={{ maxWidth: 680, width: '100%', margin: '0 auto', padding: '0 16px 170px' }}>
        {tituloSeccion(1, 'Fecha de entrega', <Button id="btnOtraFecha" icon={<CalendarOutlined />} onClick={() => setCalendario(true)}>Otra fecha</Button>)}
        {tira}
        <Text type="secondary" id="fechaElegida">
          {fecha ? <><CarOutlined /> Entrega: <Text strong>{fechaLarga(fecha)}</Text></> : 'Elige el día en que quieres recibir tu pedido'}
        </Text>
        {existente && (
          <Alert
            id="avisoDia" type="success" showIcon style={{ marginTop: 12 }}
            message={<>Ya tienes el pedido <strong>#{existente.folio}</strong> para este día.</>}
            action={<Button size="small" onClick={() => setHistorial(true)}>Ver mis pedidos</Button>}
          />
        )}
        <div id="formulario" data-bloqueado={bloqueado ? 'si' : 'no'} style={bloqueado ? { opacity: 0.45, pointerEvents: 'none', filter: 'grayscale(.4)' } : undefined}>
          {tituloSeccion(2, 'Productos', null, datos.productos.length)}
          {productos}
          {tituloSeccion(3, 'Notas', null, 'opcional')}
          <Input.TextArea id="notas" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} showCount
            autoSize={{ minRows: 3, maxRows: 6 }} placeholder="Indicaciones para la entrega, cambios, etc." />
        </div>
      </Layout.Content>

      {/* Barra inferior con el total */}
      <div id="barra" data-visible={barraVisible ? 'si' : 'no'} style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, padding: '0 12px calc(12px + env(safe-area-inset-bottom))',
        transform: barraVisible ? 'translateY(0)' : 'translateY(130%)', transition: 'transform .3s cubic-bezier(.2,.8,.2,1)',
        pointerEvents: barraVisible ? 'auto' : 'none',
      }}>
        <Card size="small" style={{ maxWidth: 656, margin: '0 auto', boxShadow: t.boxShadow, borderRadius: 16 }} styles={{ body: { padding: 12 } }}>
          <Flex align="center" gap={12}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text type="secondary" ellipsis style={{ fontSize: 13, display: 'block' }} id="barraDetalle">
                {fecha && `${fechaCorta(fecha)} · ${plural(lineas.length, 'producto', 'productos')}`}
              </Text>
              <Text strong className="cifra" style={{ fontSize: 19 }} id="barraTotal">{dinero(total)}</Text>
            </div>
            <Button type="primary" size="large" id="btnRevisar" onClick={() => setRevisando(true)}>Revisar pedido <RightOutlined /></Button>
          </Flex>
        </Card>
      </div>

      {/* Otra fecha */}
      <Hoja open={calendario} title="Elige otra fecha" footer={null} onCancel={() => setCalendario(false)} rootClassName="modal-calendario" destroyOnClose alto="auto">
        <Calendar
          fullscreen={false}
          defaultValue={dayjs(fecha || datos.fecha_minima)}
          validRange={[dayjs(datos.fecha_minima), dayjs(sumarDias(datos.fecha_minima, 90))]}
          disabledDate={(d) => d.format('YYYY-MM-DD') < datos.fecha_minima || d.format('YYYY-MM-DD') > sumarDias(datos.fecha_minima, 90)}
          onSelect={(d, info) => { if (!info || info.source === 'date') elegirFecha(d.format('YYYY-MM-DD')); }}
        />
      </Hoja>

      {/* Revisar */}
      <Hoja
        alto="auto" open={revisando} title="Revisa tu pedido" onCancel={() => setRevisando(false)} rootClassName="modal-revision"
        footer={[
          <Button key="c" onClick={() => setRevisando(false)} id="btnCorregir">Corregir</Button>,
          <Button key="o" type="primary" loading={enviando} onClick={confirmar} id="btnConfirmar">Confirmar pedido</Button>,
        ]}
      >
        {fecha && (
          <div id="revisionContenido">
            <Alert type="info" icon={<CarOutlined />} showIcon message={<>Entrega: <strong>{fechaLarga(fecha)}</strong></>} />
            {lineasAgrupadas(lineas, (l) => (
              <Flex key={`${l.si}:${l.producto.id}`} justify="space-between" align="center" gap={12} style={{ padding: '8px 0', borderBottom: `1px solid ${t.colorBorderSecondary}` }}>
                <div>
                  <div>{l.producto.nombre} <Text type="secondary" style={{ fontSize: 12 }}>{l.producto.presentacion}</Text></div>
                  <Text type="secondary" style={{ fontSize: 13 }}>{l.cantidad} × {dinero(l.producto.precio)}</Text>
                </div>
                <Text strong className="cifra">{dinero(l.importe)}</Text>
              </Flex>
            ))}
            {notas.trim() && <Text type="secondary" style={{ display: 'block', marginTop: 12, whiteSpace: 'pre-wrap' }}>Notas: {notas.trim()}</Text>}
            <Flex justify="space-between" align="baseline" style={{ marginTop: 14, paddingTop: 12, borderTop: `2px solid ${t.colorText}` }}>
              <Text strong style={{ fontSize: 18 }}>Total <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>IVA incluido</Text></Text>
              <Text strong className="cifra" style={{ fontSize: 21 }}>{dinero(total)}</Text>
            </Flex>
          </div>
        )}
      </Hoja>

      {/* Éxito */}
      <Hoja open={!!exito} footer={null} onCancel={() => setExito(null)} rootClassName="modal-exito" centered alto="auto">
        {exito && (
          <Result
            status="success" icon={<CheckCircleFilled />}
            title={<span id="exitoTitulo">¡Pedido #{exito.folio} enviado!</span>}
            subTitle={<span id="exitoTexto">Total {dinero(exito.total)}. Lo recibirás el {fechaLarga(exito.fecha).toLowerCase()}. Te avisaremos cuando lo confirmemos.</span>}
            extra={[
              <Button key="w" type="primary" icon={<WhatsAppOutlined />} onClick={avisarWhatsApp} style={{ background: '#1f8f4e' }} block>Avisar por WhatsApp</Button>,
              <Button key="c" onClick={() => setExito(null)} block style={{ marginTop: 8 }} id="btnCerrarExito">Cerrar</Button>,
            ]}
          />
        )}
      </Hoja>

      {/* Historial */}
      <Drawer open={historial} onClose={() => setHistorial(false)} placement="bottom" height="88%" title="Mis pedidos"
        rootClassName="historial" afterOpenChange={(abierto) => abierto && cargarPedidos()}
        styles={{ body: { maxWidth: 680, width: '100%', margin: '0 auto', background: t.colorBgLayout } }}>
        {!pedidos.length ? <Empty description="Aún no tienes pedidos recientes" /> : pedidos.map((p) => (
          <Card key={p.folio} size="small" className="tarjeta-pedido" style={{ marginBottom: 12 }}
            title={<div><div>{fechaLarga(p.fecha_entrega)}</div><Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>Pedido #{p.folio}</Text></div>}
            extra={<Tag color={COLOR_ESTADO[p.estado]}>{ESTADOS[p.estado] || p.estado}</Tag>}
            actions={[<Button key="n" type="link" icon={<FileTextOutlined />} target="_blank" rel="noopener" className="descargar-nota"
              href={`remision.html?t=${encodeURIComponent(token)}&folio=${encodeURIComponent(p.folio)}`}>Descargar nota</Button>]}>
            {Object.entries(p.lineas.reduce((g, l) => ((g[l.sucursal] ||= []).push(l), g), {})).map(([suc, ls]) => (
              <div key={suc}>
                {suc && <Text type="secondary" strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>{suc}</Text>}
                {ls.map((l, i) => (
                  <Flex key={i} justify="space-between" gap={10} style={{ padding: '2px 0' }}>
                    <span>{l.cantidad} × {l.producto} <Text type="secondary" style={{ fontSize: 12 }}>{l.presentacion}</Text></span>
                    <Text className="cifra">{l.importe != null ? dinero(l.importe) : ''}</Text>
                  </Flex>
                ))}
              </div>
            ))}
            {p.total != null && (
              <Flex justify="space-between" style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${t.colorBorderSecondary}` }}>
                <Text strong>Total</Text><Text strong className="cifra">{dinero(p.total)}</Text>
              </Flex>
            )}
            {p.notas && <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 13 }}>{p.notas}</Text>}
          </Card>
        ))}
      </Drawer>
    </Layout>
  );
}
