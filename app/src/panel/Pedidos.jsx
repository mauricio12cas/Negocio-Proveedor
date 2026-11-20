// Pedidos: tabla con filtros, cambio de estado, detalle por pedido y remisiones.
import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, DatePicker, Divider, Empty, Flex, InputNumber, Row, Select, Skeleton, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { DownOutlined, UpOutlined, ColumnHeightOutlined } from '@ant-design/icons';
import { EnvironmentOutlined, FileTextOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  COLOR_ESTADO, ESTADOS, db, dinero, esGranel, fechaCorta, fechaHora, fechaLarga, hoyMX, mensajeError, sumarDias, textoCantidad,
  textoPresentacion,
} from '../comun.js';
import { Encabezado, usePanel } from './Panel.jsx';

const { Text } = Typography;
const totalDe = (p) => p.pedido_lineas.reduce((a, l) => a + Number(l.importe || 0), 0);
export const abrirRemisiones = (fecha) => window.open(`remision.html?fecha=${encodeURIComponent(fecha)}`, '_blank');

function Detalle({ p, alGuardar }) {
  const { message } = App.useApp();
  const [pesos, setPesos] = useState(null);   // { idLinea: cantidad } mientras se ajusta
  const [guardando, setGuardando] = useState(false);
  const porSuc = {};
  [...p.pedido_lineas].sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre)).forEach((l) => (porSuc[l.sucursal_nombre] ||= []).push(l));
  const c = p.clientes || {};
  const entrega = [c.direccion, c.horario_recepcion, c.instrucciones].filter(Boolean).join(' · ');
  const conGranel = p.estado !== 'cancelado' && p.pedido_lineas.some((l) => esGranel(l.unidad) && l.id);

  async function guardarPesos() {
    const cambios = p.pedido_lineas.filter((l) => pesos[l.id] != null && Number(pesos[l.id]) !== Number(l.cantidad));
    if (cambios.some((l) => !(Number(pesos[l.id]) > 0))) return message.error('El peso debe ser mayor a 0.');
    setGuardando(true);
    for (const l of cambios) {
      const { error } = await db.from('pedido_lineas').update({ cantidad: Math.round(Number(pesos[l.id]) * 1000) / 1000 }).eq('id', l.id);
      if (error) { setGuardando(false); return message.error(mensajeError(error)); }
    }
    setGuardando(false);
    setPesos(null);
    message.success(cambios.length ? 'Pesos actualizados' : 'Sin cambios');
    if (cambios.length) alGuardar?.();
  }

  return (
    <div className="pedido-detalle" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
      {entrega && <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}><EnvironmentOutlined /> {entrega}</Text>}
      {Object.entries(porSuc).map(([suc, ls]) => (
        <div key={suc}>
          {suc && <Divider orientation="left" plain style={{ margin: '8px 0', fontSize: 12 }}>{suc}</Divider>}
          {ls.map((l, i) => {
            const editable = pesos && esGranel(l.unidad) && l.id;
            return (
              <Flex key={l.id || i} justify="space-between" align="center" gap={12} className="linea" style={{ padding: '4px 0' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  {editable ? (
                    <InputNumber size="small" min={0.001} max={999} step={0.1} inputMode="decimal" className="peso-real" data-linea={l.id}
                      value={pesos[l.id] ?? Number(l.cantidad)} onChange={(v) => setPesos((x) => ({ ...x, [l.id]: v }))}
                      suffix={l.unidad === 'kilo' ? 'kg' : 'L'} style={{ width: 96, marginRight: 8 }} />
                  ) : (
                    <Tag bordered={false} style={{ fontWeight: 700, minWidth: 30, textAlign: 'center' }}>{textoCantidad(l.cantidad, esGranel(l.unidad) ? l.unidad : null)}</Tag>
                  )}
                  {l.producto_nombre} <Text type="secondary">{textoPresentacion(l)}{l.precio_unitario != null ? ` · ${dinero(l.precio_unitario)}` : ''}</Text>
                </span>
                <Text className="cifra" style={{ whiteSpace: 'nowrap' }}>{l.importe != null ? dinero(l.importe) : ''}</Text>
              </Flex>
            );
          })}
        </div>
      ))}
      {conGranel && (
        <Flex gap={8} style={{ marginTop: 8 }}>
          {pesos ? (
            <Space>
              <Button size="small" type="primary" loading={guardando} onClick={guardarPesos} className="guardar-pesos">Guardar pesos</Button>
              <Button size="small" onClick={() => setPesos(null)}>Cancelar</Button>
            </Space>
          ) : (
            <Button size="small" icon={<ColumnHeightOutlined />} onClick={() => setPesos({})} className="ajustar-pesos">Ajustar pesos</Button>
          )}
        </Flex>
      )}
      {p.notas && <Alert type="warning" className="pedido-notas" message={p.notas} style={{ marginTop: 10, whiteSpace: 'pre-wrap' }} />}
      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>Recibido {fechaHora(p.creado)}</Text>
    </div>
  );
}

export default function Pedidos() {
  const { message, modal } = App.useApp();
  const { clientes, filtroPedidos, contarPorConfirmar, celular } = usePanel();
  const [abiertos, setAbiertos] = useState({});   // celular: pedidos desplegados
  const [periodo, setPeriodo] = useState('proximos');
  const [dia, setDia] = useState(sumarDias(hoyMX(), 1));
  const [cliente, setCliente] = useState('');
  const [estado, setEstado] = useState(filtroPedidos?.estado || '');
  const [datos, setDatos] = useState(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    setDatos(null);
    let q = db.from('pedidos')
      .select('id, folio, fecha_entrega, estado, notas, creado, clientes(nombre, direccion, horario_recepcion, instrucciones), pedido_lineas(id, sucursal_nombre, producto_nombre, presentacion, unidad, cantidad, precio_unitario, importe)')
      .limit(300);
    if (periodo === 'proximos') q = q.gte('fecha_entrega', hoyMX()).order('fecha_entrega').order('folio');
    else if (periodo === 'dia') q = q.eq('fecha_entrega', dia).order('folio');
    else q = q.order('fecha_entrega', { ascending: false }).order('folio', { ascending: false });
    if (cliente) q = q.eq('cliente_id', cliente);
    if (estado) q = q.eq('estado', estado);
    q.then(({ data, error }) => {
      if (error) { message.error(mensajeError(error)); setDatos([]); return; }
      setDatos(data);
    });
  }, [periodo, dia, cliente, estado, recarga]);

  function cambiarEstado(p, nuevo) {
    const aplicar = async () => {
      const { error } = await db.from('pedidos').update({ estado: nuevo }).eq('id', p.id);
      if (error) message.error(mensajeError(error));
      else message.success(`Pedido #${p.folio}: ${ESTADOS[nuevo]}`);
      setRecarga((x) => x + 1);
      contarPorConfirmar();
    };
    if (nuevo === 'cancelado') {
      modal.confirm({ title: `¿Cancelar el pedido #${p.folio}?`, content: 'El cliente podrá volver a pedir para ese día.', okText: 'Cancelar pedido', okButtonProps: { danger: true }, cancelText: 'No', onOk: aplicar });
    } else aplicar();
  }

  const diaRemisiones = periodo === 'dia' ? dia : sumarDias(hoyMX(), 1);
  const columnas = [
    { title: 'Folio', dataIndex: 'folio', width: 80, render: (f) => <Text strong className="cifra">#{f}</Text> },
    { title: 'Cliente', key: 'cliente', render: (_, p) => <Text strong className="pedido-cliente">{p.clientes?.nombre || '—'}</Text> },
    { title: 'Entrega', dataIndex: 'fecha_entrega', width: 140, render: (f) => <Tooltip title={fechaLarga(f, true)}>{fechaCorta(f)}</Tooltip> },
    { title: 'Productos', key: 'n', width: 100, align: 'center', responsive: ['md'], render: (_, p) => p.pedido_lineas.length },
    {
      title: 'Estado', dataIndex: 'estado', width: 170,
      render: (e, p) => (
        <Select value={e} variant="borderless" style={{ width: 150 }} data-pedido={p.id} onClick={(ev) => ev.stopPropagation()}
          onChange={(v) => cambiarEstado(p, v)} popupMatchSelectWidth={false}
          options={Object.entries(ESTADOS).map(([v, t]) => ({ value: v, label: <Tag color={COLOR_ESTADO[v]} style={{ margin: 0 }}>{t}</Tag> }))} />
      ),
    },
    { title: 'Total', key: 'total', align: 'right', width: 130, render: (_, p) => <Text strong className="cifra">{dinero(totalDe(p))}</Text> },
    {
      title: '', key: 'acciones', width: 120, align: 'right',
      render: (_, p) => (
        <Button size="small" icon={<FileTextOutlined />} href={`remision.html?pedido=${encodeURIComponent(p.id)}`} target="_blank"
          rel="noopener" data-remision={p.id} onClick={(e) => e.stopPropagation()}>Remisión</Button>
      ),
    },
  ];

  return (
    <>
      <Encabezado titulo="Pedidos" texto="Confirma los pedidos, actualiza su estado e imprime remisiones.">
        <Tooltip title={`Imprime las remisiones del ${fechaLarga(diaRemisiones).toLowerCase()}`}>
          <Button icon={<PrinterOutlined />} id="btnRemisionesDia" onClick={() => abrirRemisiones(diaRemisiones)}>
            {celular ? 'Remisiones' : diaRemisiones === sumarDias(hoyMX(), 1) ? 'Remisiones de mañana' : `Remisiones del ${fechaCorta(diaRemisiones)}`}
          </Button>
        </Tooltip>
        <Tooltip title="Actualizar"><Button icon={<ReloadOutlined />} aria-label="Actualizar" onClick={() => setRecarga((x) => x + 1)} /></Tooltip>
      </Encabezado>
      {celular ? (
        <>
          <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
            <Col span={periodo === 'dia' ? 12 : 24}>
              <Select id="filtroPeriodo" value={periodo} onChange={setPeriodo} style={{ width: '100%' }} options={[
                { value: 'proximos', label: 'Próximas entregas' }, { value: 'dia', label: 'Un día…' }, { value: 'todos', label: 'Todos (últimos 300)' },
              ]} />
            </Col>
            {periodo === 'dia' && (
              <Col span={12}><DatePicker id="filtroDia" value={dayjs(dia)} allowClear={false} format="ddd D MMM" inputReadOnly style={{ width: '100%' }}
                onChange={(d) => d && setDia(d.format('YYYY-MM-DD'))} /></Col>
            )}
            <Col span={12}>
              <Select id="filtroCliente" value={cliente} onChange={setCliente} style={{ width: '100%' }} showSearch optionFilterProp="label"
                options={[{ value: '', label: 'Todos los clientes' }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]} />
            </Col>
            <Col span={12}>
              <Select id="filtroEstado" value={estado} onChange={setEstado} style={{ width: '100%' }}
                options={[{ value: '', label: 'Todos los estados' }, ...Object.entries(ESTADOS).map(([v, t]) => ({ value: v, label: t }))]} />
            </Col>
          </Row>
          {!datos ? <Card><Skeleton active /></Card> : !datos.length ? (
            <Card><Empty description="No hay pedidos con estos filtros. Cuando tus clientes pidan desde su link, aparecerán aquí." /></Card>
          ) : datos.map((p) => {
            const abierto = abiertos[p.id] ?? datos.length <= 6;
            return (
              <Card key={p.id} size="small" className={`pedido tarjeta-pedido estado-${p.estado}`} style={{ marginBottom: 10 }} styles={{ body: { padding: 0 } }}>
                <div role="button" tabIndex={0} onClick={() => setAbiertos((a) => ({ ...a, [p.id]: !abierto }))} style={{ padding: '12px 14px', cursor: 'pointer' }}>
                  <Flex justify="space-between" align="flex-start" gap={10}>
                    <div style={{ minWidth: 0 }}>
                      <Text type="secondary" className="cifra" style={{ fontSize: 12 }}>#{p.folio} · {fechaCorta(p.fecha_entrega)}</Text>
                      <div><Text strong className="pedido-cliente" style={{ fontSize: 16 }}>{p.clientes?.nombre || '—'}</Text></div>
                    </div>
                    <Tag color={COLOR_ESTADO[p.estado]} style={{ margin: 0 }}>{ESTADOS[p.estado]}</Tag>
                  </Flex>
                  <Flex justify="space-between" align="center" style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 13 }}>{p.pedido_lineas.length} {p.pedido_lineas.length === 1 ? 'producto' : 'productos'} {abierto ? <UpOutlined /> : <DownOutlined />}</Text>
                    <Text strong className="cifra" style={{ fontSize: 17 }}>{dinero(totalDe(p))}</Text>
                  </Flex>
                </div>
                {abierto && <div style={{ padding: '0 14px 10px' }}><Detalle p={p} alGuardar={() => setRecarga((x) => x + 1)} /></div>}
                <Flex gap={8} style={{ padding: 10, borderTop: '1px solid rgba(128,128,128,.15)' }}>
                  <Select value={p.estado} style={{ flex: 1 }} data-pedido={p.id} onChange={(v) => cambiarEstado(p, v)} aria-label="Estado del pedido"
                    options={Object.entries(ESTADOS).map(([v, t]) => ({ value: v, label: <Tag color={COLOR_ESTADO[v]} style={{ margin: 0 }}>{t}</Tag> }))} />
                  <Button icon={<FileTextOutlined />} href={`remision.html?pedido=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener" data-remision={p.id}>Remisión</Button>
                </Flex>
              </Card>
            );
          })}
        </>
      ) : (
      <Card styles={{ body: { padding: 0 } }}>
        <Flex gap={8} wrap style={{ padding: 16 }}>
          <Select id="filtroPeriodo" value={periodo} onChange={setPeriodo} style={{ width: 190 }} options={[
            { value: 'proximos', label: 'Próximas entregas' }, { value: 'dia', label: 'Un día…' }, { value: 'todos', label: 'Todos (últimos 300)' },
          ]} />
          {periodo === 'dia' && <DatePicker id="filtroDia" value={dayjs(dia)} allowClear={false} format="ddd D MMM YYYY" onChange={(d) => d && setDia(d.format('YYYY-MM-DD'))} />}
          <Select id="filtroCliente" value={cliente} onChange={setCliente} style={{ width: 220 }} showSearch optionFilterProp="label"
            options={[{ value: '', label: 'Todos los clientes' }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]} />
          <Select id="filtroEstado" value={estado} onChange={setEstado} style={{ width: 180 }}
            options={[{ value: '', label: 'Todos los estados' }, ...Object.entries(ESTADOS).map(([v, t]) => ({ value: v, label: t }))]} />
        </Flex>
        <Table
          key={datos ? `t-${recarga}-${datos.length}` : 'cargando'}
          rowKey="id" columns={columnas} dataSource={datos || []} loading={!datos} size="middle" scroll={{ x: 760 }}
          pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
          rowClassName={(p) => `pedido estado-${p.estado}`}
          expandable={{ expandedRowRender: (p) => <Detalle p={p} alGuardar={() => setRecarga((x) => x + 1)} />, defaultExpandAllRows: (datos || []).length <= 12, expandRowByClick: true }}
          locale={{ emptyText: 'No hay pedidos con estos filtros. Cuando tus clientes pidan desde su link, aparecerán aquí.' }}
        />
      </Card>
      )}
    </>
  );
}
