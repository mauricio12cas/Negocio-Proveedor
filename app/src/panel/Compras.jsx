// Por comprar: suma de lo pedido para un día de entrega.
import { useEffect, useState } from 'react';
import { App, Button, Card, DatePicker, Table, Typography } from 'antd';
import { FileTextOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { db, fechaLarga, hoyMX, mensajeError, sumarDias, textoPresentacion } from '../comun.js';
import { Encabezado } from './Panel.jsx';
import { abrirRemisiones } from './Pedidos.jsx';

const { Text, Title } = Typography;

export default function Compras() {
  const { message } = App.useApp();
  const [dia, setDia] = useState(sumarDias(hoyMX(), 1));
  const [filas, setFilas] = useState(null);

  useEffect(() => {
    setFilas(null);
    db.from('pedido_lineas')
      .select('producto_nombre, presentacion, unidad, cantidad, sucursal_nombre, pedidos!inner(fecha_entrega, estado, clientes(nombre))')
      .eq('pedidos.fecha_entrega', dia)
      .neq('pedidos.estado', 'cancelado')
      .then(({ data, error }) => {
        if (error) { message.error(mensajeError(error)); setFilas([]); return; }
        const totales = {};
        data.forEach((l) => {
          const clave = [l.producto_nombre, l.presentacion, l.unidad].join('|');
          const t = (totales[clave] ||= { ...l, clave, total: 0, detalle: [] });
          t.total += l.cantidad;
          t.detalle.push(`${[l.pedidos.clientes?.nombre, l.sucursal_nombre].filter(Boolean).join(' / ')}: ${l.cantidad}`);
        });
        setFilas(Object.values(totales).sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre)));
      });
  }, [dia]);

  return (
    <>
      <Encabezado titulo="Por comprar" texto="Suma de todos los pedidos de un día de entrega (sin cancelados).">
        <DatePicker id="comprasDia" value={dayjs(dia)} allowClear={false} format="ddd D MMM YYYY" onChange={(d) => d && setDia(d.format('YYYY-MM-DD'))} />
        <Button icon={<FileTextOutlined />} id="btnRemisionesCompras" onClick={() => abrirRemisiones(dia)}>Remisiones</Button>
        <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Imprimir lista</Button>
      </Encabezado>
      <Title level={4} className="solo-imprimir" style={{ display: 'none' }}>Por comprar · entregas del {fechaLarga(dia, true)}</Title>
      <Card styles={{ body: { padding: 0 } }}>
        <Table id="listaCompras" rowKey="clave" dataSource={filas || []} loading={!filas} pagination={false} size="middle" scroll={{ x: 600 }}
          locale={{ emptyText: 'No hay pedidos para ese día.' }}
          columns={[
            { title: 'Producto', dataIndex: 'producto_nombre', render: (v) => <Text strong>{v}</Text> },
            { title: 'Presentación', key: 'p', render: (_, t) => textoPresentacion(t) },
            { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <Text strong className="cifra" style={{ fontSize: 16 }}>{v}</Text> },
            { title: 'Quién lo pidió', dataIndex: 'detalle', render: (d) => <Text type="secondary" style={{ fontSize: 13 }}>{d.map((x) => <div key={x}>{x}</div>)}</Text> },
          ]} />
      </Card>
    </>
  );
}
