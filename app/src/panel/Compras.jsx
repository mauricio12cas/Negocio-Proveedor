// Por comprar: lo pedido para un día de entrega, separado por cliente (o sumado por producto).
import { useEffect, useState } from 'react';
import { App, Button, Card, Col, DatePicker, Empty, Flex, List, Row, Segmented, Skeleton, Table, Tag, Typography } from 'antd';
import { FileTextOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { db, esGranel, fechaLarga, hoyMX, mensajeError, sumarDias, textoCantidad, textoPresentacion } from '../comun.js';
import { Encabezado, usePanel } from './Panel.jsx';
import { abrirRemisiones } from './Pedidos.jsx';

const { Text, Title } = Typography;

/** Una tarjeta por cliente (y sucursal) con lo que pidió. */
function PorCliente({ grupos, celular }) {
  if (!grupos) return <Card><Skeleton active /></Card>;
  if (!grupos.length) return <Card><Empty description="No hay pedidos para ese día." /></Card>;
  return (
    <Row gutter={[12, 12]} id="comprasPorCliente">
      {grupos.map((g) => (
        <Col key={g.clave} xs={24} lg={12} xxl={8} className="bloque-cliente">
          <Card size="small" style={{ height: '100%', breakInside: 'avoid' }}
            title={<span>{g.cliente}{g.sucursal && <Text type="secondary" style={{ fontWeight: 400 }}> · {g.sucursal}</Text>}</span>}
            extra={<Flex gap={6} align="center">{g.horario && <Text type="secondary" style={{ fontSize: 12 }}>{g.horario}</Text>}{g.folio && <Tag bordered={false}>#{g.folio}</Tag>}</Flex>}>
            <List size="small" split dataSource={g.lineas} renderItem={(l) => (
              <List.Item style={{ paddingInline: 0 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text>{l.producto_nombre}</Text>
                  <div><Text type="secondary" style={{ fontSize: 12 }}>{textoPresentacion(l)}</Text></div>
                </div>
                <Text strong className="cifra" style={{ fontSize: celular ? 18 : 16, whiteSpace: 'nowrap' }}>
                  {textoCantidad(l.cantidad, esGranel(l.unidad) ? l.unidad : null)}
                </Text>
              </List.Item>
            )} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export default function Compras() {
  const { message } = App.useApp();
  const { celular } = usePanel();
  const [dia, setDia] = useState(sumarDias(hoyMX(), 1));
  const [vista, setVista] = useState('cliente');
  const [filas, setFilas] = useState(null);
  const [grupos, setGrupos] = useState(null);

  useEffect(() => {
    setFilas(null);
    setGrupos(null);
    db.from('pedido_lineas')
      .select('producto_nombre, presentacion, unidad, cantidad, sucursal_nombre, pedidos!inner(folio, fecha_entrega, estado, clientes(nombre, horario_recepcion))')
      .eq('pedidos.fecha_entrega', dia)
      .neq('pedidos.estado', 'cancelado')
      .then(({ data, error }) => {
        if (error) { message.error(mensajeError(error)); setFilas([]); setGrupos([]); return; }
        // Sumado por producto
        const totales = {};
        data.forEach((l) => {
          const clave = [l.producto_nombre, l.presentacion, l.unidad].join('|');
          const t = (totales[clave] ||= { ...l, clave, total: 0, detalle: [] });
          t.total = Math.round((t.total + Number(l.cantidad)) * 1000) / 1000;
          t.detalle.push(`${[l.pedidos.clientes?.nombre, l.sucursal_nombre].filter(Boolean).join(' / ')}: ${textoCantidad(l.cantidad)}`);
        });
        setFilas(Object.values(totales).sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre)));
        // Separado por cliente y sucursal
        const porCliente = {};
        data.forEach((l) => {
          const cliente = l.pedidos.clientes?.nombre || '—';
          const clave = [cliente, l.sucursal_nombre || '', l.pedidos.folio ?? ''].join('|');
          (porCliente[clave] ||= {
            clave, cliente, sucursal: l.sucursal_nombre, folio: l.pedidos.folio, horario: l.pedidos.clientes?.horario_recepcion, lineas: [],
          }).lineas.push(l);
        });
        setGrupos(Object.values(porCliente)
          .map((g) => ({ ...g, lineas: g.lineas.sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre)) }))
          .sort((a, b) => a.cliente.localeCompare(b.cliente) || (a.sucursal || '').localeCompare(b.sucursal || '')));
      });
  }, [dia]);

  return (
    <>
      <Encabezado titulo="Por comprar" texto="Lo pedido para un día de entrega (sin cancelados), separado por cliente o sumado por producto.">
        <DatePicker id="comprasDia" value={dayjs(dia)} allowClear={false} inputReadOnly={celular} format={celular ? 'ddd D MMM' : 'ddd D MMM YYYY'}
          onChange={(d) => d && setDia(d.format('YYYY-MM-DD'))} style={celular ? { width: 150 } : undefined} />
        <Button icon={<FileTextOutlined />} id="btnRemisionesCompras" onClick={() => abrirRemisiones(dia)}>Remisiones</Button>
        {!celular && <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Imprimir lista</Button>}
      </Encabezado>
      <Segmented id="vistaCompras" className="sin-imprimir" value={vista} onChange={setVista} block={celular} style={{ marginBottom: 14 }}
        options={[{ value: 'cliente', label: 'Por cliente' }, { value: 'sumado', label: 'Sumado' }]} />
      <Title level={4} className="solo-imprimir" style={{ display: 'none' }}>
        Por comprar ({vista === 'cliente' ? 'por cliente' : 'sumado'}) · entregas del {fechaLarga(dia, true)}
      </Title>
      {vista === 'cliente' ? <PorCliente grupos={grupos} celular={celular} /> : celular ? (
        <Card styles={{ body: { padding: '0 14px' } }} loading={!filas}>
          <List id="listaCompras" dataSource={filas || []} locale={{ emptyText: 'No hay pedidos para ese día.' }}
            renderItem={(t) => (
              <List.Item className="compra-fila">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text strong>{t.producto_nombre}</Text>
                  <div><Text type="secondary" style={{ fontSize: 13 }}>{textoPresentacion(t)}</Text></div>
                  <div style={{ marginTop: 4 }}>{t.detalle.map((x) => <div key={x}><Text type="secondary" style={{ fontSize: 12 }}>{x}</Text></div>)}</div>
                </div>
                <Flex vertical align="flex-end"><Text strong className="cifra total-compra" style={{ fontSize: 22 }}>{textoCantidad(t.total)}</Text></Flex>
              </List.Item>
            )} />
        </Card>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          <Table id="listaCompras" rowKey="clave" dataSource={filas || []} loading={!filas} pagination={false} size="middle" scroll={{ x: 600 }}
            locale={{ emptyText: 'No hay pedidos para ese día.' }}
            columns={[
              { title: 'Producto', dataIndex: 'producto_nombre', render: (v) => <Text strong>{v}</Text> },
              { title: 'Presentación', key: 'p', render: (_, t) => textoPresentacion(t) },
              { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <Text strong className="cifra" style={{ fontSize: 16 }}>{textoCantidad(v)}</Text> },
              { title: 'Quién lo pidió', dataIndex: 'detalle', render: (d) => <Text type="secondary" style={{ fontSize: 13 }}>{d.map((x) => <div key={x}>{x}</div>)}</Text> },
            ]} />
        </Card>
      )}
    </>
  );
}
