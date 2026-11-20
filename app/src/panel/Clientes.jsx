// Clientes: tabla con su link, productos y sucursales; alta y edición con el asistente.
import { useEffect, useState } from 'react';
import { App, Avatar, Button, Card, Flex, Input, Space, Table, Tag, Tooltip, Typography, theme } from 'antd';
import { EditOutlined, PlusOutlined, TagsOutlined, TeamOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { abrirWhatsApp, iniciales, plural, urlCliente } from '../comun.js';
import { Encabezado, usePanel } from './Panel.jsx';
import AsistenteCliente from './AsistenteCliente.jsx';

const { Text } = Typography;

export default function Clientes() {
  const { clientes, filtroPedidos } = usePanel();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [busqueda, setBusqueda] = useState('');
  const [asistente, setAsistente] = useState(null);   // { cliente, paso }

  useEffect(() => {
    const id = filtroPedidos?.editar;
    const c = id && clientes.find((x) => x.id === id);
    if (c) setAsistente({ cliente: c, paso: filtroPedidos.paso || 1 });
  }, []);

  const lista = clientes.filter((c) => !busqueda || `${c.nombre} ${c.tipo || ''} ${c.telefono || ''}`.toLowerCase().includes(busqueda.toLowerCase()));

  const columnas = [
    {
      title: 'Cliente', key: 'nombre', sorter: (a, b) => a.nombre.localeCompare(b.nombre),
      render: (_, c) => (
        <Flex align="center" gap={12}>
          <Avatar shape="square" style={{ background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 700 }}>{iniciales(c.nombre)}</Avatar>
          <div style={{ minWidth: 0 }}>
            <Text strong className="cliente-nombre">{c.nombre}</Text>
            <div><Text type="secondary" style={{ fontSize: 13 }}>{[c.tipo, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</Text></div>
          </div>
        </Flex>
      ),
    },
    {
      title: 'Productos', key: 'productos', width: 200,
      render: (_, c) => {
        const sinPrecio = c.cliente_productos.filter((x) => !(Number(x.precio) > 0)).length;
        return (
          <Space size={4} wrap>
            <Tag bordered={false}>{plural(c.cliente_productos.length, 'producto', 'productos')}</Tag>
            {c.sucursales.length > 0 && <Tag bordered={false}>{plural(c.sucursales.length, 'sucursal', 'sucursales')}</Tag>}
            {sinPrecio > 0 && <Tag color="error">{sinPrecio} sin precio</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Link para pedir', key: 'link', width: 260, responsive: ['md'],
      render: (_, c) => (
        <Text className="link-cliente" copyable={{ text: urlCliente(c.token), tooltips: ['Copiar link', 'Copiado'], onCopy: () => message.success('Link copiado') }}
          style={{ display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} type="secondary">
          {urlCliente(c.token)}
        </Text>
      ),
    },
    { title: 'Estado', dataIndex: 'activo', width: 100, render: (a) => (a ? <Tag color="success">Activo</Tag> : <Tag>Inactivo</Tag>) },
    {
      title: '', key: 'acciones', align: 'right', width: 260,
      render: (_, c) => (
        <Space size={4} wrap>
          <Button size="small" icon={<EditOutlined />} data-editar-cliente={c.id} onClick={() => setAsistente({ cliente: c, paso: 1 })}>Editar</Button>
          <Button size="small" icon={<TagsOutlined />} data-precios={c.id} onClick={() => setAsistente({ cliente: c, paso: 2 })}>Precios</Button>
          <Tooltip title="Enviar link por WhatsApp">
            <Button size="small" icon={<WhatsAppOutlined />} data-enviar={c.id} aria-label="Enviar link"
              onClick={() => abrirWhatsApp(c.telefono, `Hola, este es tu link para hacer pedidos: ${urlCliente(c.token)}`)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Encabezado titulo="Clientes" texto="Cada cliente pide desde su propio link, con sus productos y precios.">
        <Button type="primary" icon={<PlusOutlined />} id="btnNuevoCliente" onClick={() => setAsistente({ cliente: null, paso: 1 })}>Nuevo cliente</Button>
      </Encabezado>
      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: 16 }}>
          <Input.Search id="buscarCliente" placeholder="Buscar cliente…" allowClear value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 340 }} />
        </div>
        <Table id="listaClientes" rowKey="id" columns={columnas} dataSource={lista} size="middle" scroll={{ x: 760 }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }} rowClassName={(c) => (c.activo ? 'cliente' : 'cliente inactivo')}
          locale={{ emptyText: (
            <Flex vertical align="center" gap={8} style={{ padding: 24 }}>
              <TeamOutlined style={{ fontSize: 32, color: token.colorTextQuaternary }} />
              <Text strong>{clientes.length ? 'Ningún cliente coincide' : 'Aún no hay clientes'}</Text>
              {!clientes.length && <Text type="secondary">Crea el primero: elige sus productos, ponle precios y mándale su link.</Text>}
            </Flex>
          ) }} />
      </Card>
      {asistente && <AsistenteCliente {...asistente} alCerrar={() => setAsistente(null)} />}
    </>
  );
}
