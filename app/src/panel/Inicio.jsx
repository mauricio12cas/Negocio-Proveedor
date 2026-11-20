// Tablero: indicadores, gráfica de ventas, mejores clientes y productos, clientes sin pedir y alertas.
import { useEffect, useState } from 'react';
import {
  Avatar, Button, Card, Col, Empty, Flex, Grid, List, Progress, Row, Segmented, Skeleton, Statistic, Tag, Tooltip, Typography, theme,
} from 'antd';
import {
  AlertOutlined, ArrowDownOutlined, ArrowUpOutlined, CarOutlined, CheckCircleOutlined, ClockCircleOutlined, DollarOutlined,
  InboxOutlined, ReloadOutlined, ShoppingOutlined, TagOutlined, WhatsAppOutlined, WarningOutlined,
} from '@ant-design/icons';
import {
  abrirWhatsApp, db, dinero, fechaLarga, hoyMX, mensajeError, plural, sumarDias, textoMargen, urlCliente, variacion,
} from '../comun.js';
import { Encabezado, usePanel } from './Panel.jsx';
import Grafica from './Grafica.jsx';

const { Text } = Typography;

function Delta({ actual, anterior, texto = 'vs. periodo anterior' }) {
  const v = variacion(actual, anterior);
  if (v === null) return <Text type="secondary">Sin datos del periodo anterior</Text>;
  const igual = Math.abs(v) < 0.5;
  return (
    <Flex gap={6} align="center" wrap>
      <Tag bordered={false} color={igual ? 'default' : v > 0 ? 'success' : 'error'} style={{ margin: 0, fontWeight: 600 }} className="delta">
        {igual ? '' : v > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(v).toFixed(0)} %
      </Tag>
      {texto && <Text type="secondary">{texto}</Text>}
    </Flex>
  );
}

function Metrica({ id, icono, titulo, valor, detalle, alerta, onClick, cargando }) {
  const { token } = theme.useToken();
  const chica = !Grid.useBreakpoint().md;
  return (
    <Card id={id} hoverable={!!onClick} onClick={onClick} className="metrica" size={chica ? 'small' : 'default'}
      style={{ height: '100%', borderColor: alerta ? token.colorWarningBorder : undefined, cursor: onClick ? 'pointer' : undefined }}>
      <Flex align="center" gap={chica ? 8 : 10}>
        <Avatar shape="square" size={chica ? 28 : 34} icon={icono} style={{ flexShrink: 0,
          background: alerta ? token.colorWarningBg : token.colorPrimaryBg, color: alerta ? token.colorWarning : token.colorPrimary,
        }} />
        <Text type="secondary" strong className="rotulo" style={{ fontSize: chica ? 12 : 14, lineHeight: 1.25 }}>{titulo}</Text>
      </Flex>
      {cargando ? <Skeleton active paragraph={{ rows: 1 }} title={false} style={{ marginTop: 14 }} /> : (
        <>
          <Statistic value={valor} valueStyle={{ fontWeight: 700, fontSize: chica ? 20 : 26, marginTop: chica ? 6 : 10 }} className="valor" />
          <div className="detalle" style={{ marginTop: 2, fontSize: chica ? 12 : 13 }}>{detalle}</div>
        </>
      )}
    </Card>
  );
}

function TopLista({ id, filas, detalle, vacio }) {
  const { token } = theme.useToken();
  if (!filas) return <Skeleton active />;
  if (!filas.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={vacio} />;
  const max = Math.max(...filas.map((f) => Number(f.total) || 0), 1);
  return (
    <div id={id}>
      {filas.map((f) => (
        <div key={f.nombre} className="barra-fila" style={{ marginBottom: 12 }}>
          <Flex justify="space-between" gap={12}>
            <Text ellipsis>{f.nombre} <Text type="secondary" style={{ fontSize: 12 }}>{detalle(f)}</Text></Text>
            <Text strong className="cifra">{dinero(f.total)}</Text>
          </Flex>
          <Progress percent={(Number(f.total) / max) * 100} showInfo={false} size="small" status="normal" strokeColor={token.colorPrimary} style={{ margin: 0 }} />
        </div>
      ))}
    </div>
  );
}

export default function Inicio() {
  const { ajustes, clientes, irA, esMargenBajo, margenDe, setPorConfirmar, celular } = usePanel();
  const { token } = theme.useToken();
  const [dias, setDias] = useState(30);
  const [base, setBase] = useState(null);
  const [estadisticas, setEstadisticas] = useState(null);
  const [errorEstad, setErrorEstad] = useState(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    (async () => {
      const hoy = hoyMX();
      const [rPedidos, rResumen, rAsignados] = await Promise.all([
        db.from('pedidos').select('id, fecha_entrega, estado, pedido_lineas(importe)').gte('fecha_entrega', hoy).neq('estado', 'cancelado'),
        db.from('resumen_clientes').select('*').order('nombre'),
        ajustes?.margen_minimo != null
          ? db.from('cliente_productos').select('precio, clientes(nombre), productos(nombre, costo)')
          : Promise.resolve({ data: [] }),
      ]);
      if (rPedidos.error || rResumen.error) return setBase({ error: mensajeError(rPedidos.error || rResumen.error) });
      const total = (ps) => ps.reduce((a, p) => a + p.pedido_lineas.reduce((b, l) => b + Number(l.importe || 0), 0), 0);
      const porConfirmar = rPedidos.data.filter((p) => p.estado === 'recibido').length;
      const manana = rPedidos.data.filter((p) => p.fecha_entrega === sumarDias(hoy, 1));
      setPorConfirmar(porConfirmar);
      setBase({ porConfirmar, manana: manana.length, totalManana: total(manana), resumen: rResumen.data, asignados: rAsignados.data || [] });
    })();
  }, [recarga]);

  useEffect(() => {
    setEstadisticas(null);
    const hasta = hoyMX();
    db.rpc('estadisticas_ventas', { p_desde: sumarDias(hasta, -(dias - 1)), p_hasta: hasta }).then(({ data, error }) => {
      setErrorEstad(error ? mensajeError(error) : null);
      setEstadisticas(data || null);
    });
  }, [dias, recarga]);

  const t = estadisticas?.totales, ant = estadisticas?.periodo_anterior;
  const diasInactivo = Number(ajustes?.dias_inactividad) || 7;
  const limite = Date.now() - diasInactivo * 86400000;
  const inactivos = (base?.resumen || []).filter((c) => c.activo && (!c.ultimo_pedido || new Date(c.ultimo_pedido).getTime() < limite));
  const cliente = (id) => clientes.find((c) => c.id === id);

  const alertas = [];
  (base?.resumen || []).filter((c) => c.activo && c.productos_sin_precio > 0).forEach((c) => alertas.push({
    key: `sp-${c.id}`, icono: <TagOutlined />, tipo: 'error', titulo: c.nombre,
    texto: `${plural(c.productos_sin_precio, 'producto', 'productos')} sin precio: no los puede pedir`,
    accion: <Button size="small" onClick={() => irA('clientes', { editar: c.id, paso: 2 })}>Corregir</Button>,
  }));
  (base?.resumen || []).filter((c) => c.activo && c.productos === 0).forEach((c) => alertas.push({
    key: `ss-${c.id}`, icono: <ShoppingOutlined />, tipo: 'warning', titulo: c.nombre, texto: 'No tiene productos asignados',
    accion: <Button size="small" onClick={() => irA('clientes', { editar: c.id, paso: 2 })}>Asignar</Button>,
  }));
  (base?.asignados || []).forEach((a, i) => {
    const m = margenDe(a.precio, a.productos?.costo);
    if (esMargenBajo(m)) {
      alertas.push({
        key: `m-${i}`, icono: <WarningOutlined />, tipo: 'warning', titulo: `${a.productos.nombre} · ${a.clientes?.nombre}`,
        texto: <Text type="danger">Margen {textoMargen(m)} (mínimo {ajustes.margen_minimo} %)</Text>,
      });
    }
  });

  const colorAlerta = (tipo) => (tipo === 'error' ? [token.colorErrorBg, token.colorError] : [token.colorWarningBg, token.colorWarning]);

  return (
    <>
      <Encabezado titulo="Inicio" texto={`${fechaLarga(hoyMX(), true)}.`}>
        <Segmented id="rangoInicio" value={dias} onChange={setDias}
          options={[{ value: 7, label: '7 días' }, { value: 30, label: '30 días' }, { value: 90, label: '90 días' }]} />
        <Tooltip title="Actualizar"><Button icon={<ReloadOutlined />} onClick={() => setRecarga((x) => x + 1)} aria-label="Actualizar" /></Tooltip>
      </Encabezado>

      {base?.error ? <Card><Empty description={base.error} /></Card> : (
        <Row gutter={[16, 16]} id="metricas">
          <Col xs={12} xl={6}>
            <Metrica id="mPorConfirmar" icono={<InboxOutlined />} titulo="Por confirmar" cargando={!base} valor={base?.porConfirmar}
              alerta={base?.porConfirmar > 0} onClick={() => irA('pedidos', { estado: 'recibido' })}
              detalle={<Text type="secondary">{base?.porConfirmar ? 'Toca para revisarlos →' : 'Todo al día'}</Text>} />
          </Col>
          <Col xs={12} xl={6}>
            <Metrica id="mManana" icono={<CarOutlined />} titulo="Entregas de mañana" cargando={!base} valor={base?.manana}
              detalle={<Text type="secondary">{dinero(base?.totalManana)}</Text>} />
          </Col>
          <Col xs={12} xl={6}>
            <Metrica id="mVentas" icono={<DollarOutlined />} titulo="Ventas" cargando={!estadisticas} valor={dinero(t?.total)}
              detalle={<Delta actual={t?.total} anterior={ant?.total} />} />
          </Col>
          <Col xs={12} xl={6}>
            <Metrica id="mTicket" icono={<ShoppingOutlined />} titulo="Ticket promedio" cargando={!estadisticas} valor={dinero(t?.ticket_promedio)}
              detalle={<Flex gap={6} align="center" wrap><Text type="secondary">{plural(Number(t?.pedidos || 0), 'pedido', 'pedidos')} ·</Text><Delta actual={t?.ticket_promedio} anterior={ant?.ticket_promedio} texto="" /></Flex>} />
          </Col>

          <Col span={24}>
            <Card title="Ventas por día de entrega" extra={!celular && estadisticas && (
              <div style={{ textAlign: 'right' }} id="graficaTotal">
                <Text strong className="cifra" style={{ fontSize: 18 }}>{dinero(t.total)}</Text>{' '}
                <Text type="secondary">{plural(Number(t.pedidos), 'pedido', 'pedidos')}</Text>
              </div>
            )}>
              {celular && estadisticas && (
                <div id="graficaTotal" style={{ marginTop: -6 }}>
                  <Text strong className="cifra" style={{ fontSize: 20 }}>{dinero(t.total)}</Text>{' '}
                  <Text type="secondary">{plural(Number(t.pedidos), 'pedido', 'pedidos')}</Text>
                </div>
              )}
              <Text type="secondary" style={{ display: 'block', marginTop: celular ? 0 : -8, marginBottom: 12, fontSize: celular ? 12 : 14 }}>Últimos {dias} días · por fecha de entrega, sin cancelados</Text>
              {errorEstad ? <Empty description={errorEstad} /> : estadisticas ? <Grafica dias={estadisticas.por_dia} alto={celular ? 220 : 280} /> : <Skeleton active paragraph={{ rows: 6 }} />}
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title="Mejores clientes" extra={<Text type="secondary">Por importe</Text>} style={{ height: '100%' }}>
              <TopLista id="topClientes" filas={estadisticas?.top_clientes} vacio="Aún no hay ventas en este periodo"
                detalle={(f) => plural(Number(f.pedidos), 'pedido', 'pedidos')} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="Productos más vendidos" extra={<Text type="secondary">Por importe</Text>} style={{ height: '100%' }}>
              <TopLista id="topProductos" filas={estadisticas?.top_productos} vacio="Aún no hay ventas en este periodo"
                detalle={(f) => plural(Number(f.cantidad), 'vendido', 'vendidos')} />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card title="Clientes que no han pedido" extra={<Text type="secondary">{diasInactivo} días</Text>} style={{ height: '100%' }} styles={{ body: { paddingBlock: 8 } }}>
              {!base ? <Skeleton active /> : (
                <List id="listaInactivos" dataSource={inactivos}
                  locale={{ emptyText: <Flex gap={8} justify="center" style={{ padding: 16 }}><CheckCircleOutlined style={{ color: token.colorSuccess }} />Todos tus clientes activos pidieron en los últimos {diasInactivo} días.</Flex> }}
                  renderItem={(c) => (
                    <List.Item actions={[
                      <Button key="w" size="small" icon={<WhatsAppOutlined />} data-recordar={c.id}
                        onClick={() => abrirWhatsApp(c.telefono, `Hola, ¿te preparo tu pedido? Puedes hacerlo aquí: ${urlCliente(cliente(c.id)?.token || '')}`)}>Escribirle</Button>,
                    ]}>
                      <List.Item.Meta avatar={<Avatar icon={<ClockCircleOutlined />} />} title={c.nombre}
                        description={c.ultimo_pedido ? `Último pedido hace ${Math.floor((Date.now() - new Date(c.ultimo_pedido).getTime()) / 86400000)} días` : 'Nunca ha pedido'} />
                    </List.Item>
                  )} />
              )}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={<>Alertas <AlertOutlined /></>} extra={<Text type="secondary">Precios y margen</Text>} style={{ height: '100%' }} styles={{ body: { paddingBlock: 8 } }}>
              {!base ? <Skeleton active /> : (
                <List id="listaAlertas" dataSource={alertas}
                  locale={{ emptyText: <Flex gap={8} justify="center" style={{ padding: 16 }}><CheckCircleOutlined style={{ color: token.colorSuccess }} />Sin alertas.</Flex> }}
                  renderItem={(a) => (
                    <List.Item actions={a.accion ? [a.accion] : []}>
                      <List.Item.Meta
                        avatar={<Avatar shape="square" icon={a.icono} style={{ background: colorAlerta(a.tipo)[0], color: colorAlerta(a.tipo)[1] }} />}
                        title={a.titulo} description={a.texto} />
                    </List.Item>
                  )} />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </>
  );
}
