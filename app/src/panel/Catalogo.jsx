// Catálogo general: productos con precio base, costo y margen; alta, edición e importación desde Excel.
import { useState } from 'react';
import {
  App, AutoComplete, Button, Card, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Switch, Table, Tag, Typography,
} from 'antd';
import { EditOutlined, PlusOutlined, TableOutlined } from '@ant-design/icons';
import { UNIDADES, db, dinero, mensajeError, numero, textoMargen, textoPresentacion } from '../comun.js';
import { Encabezado, usePanel } from './Panel.jsx';

const { Text, Paragraph } = Typography;
const ALIAS_UNIDAD = {
  kg: 'kilo', kilos: 'kilo', kilogramo: 'kilo', kilogramos: 'kilo', l: 'litro', lt: 'litro', litros: 'litro',
  piezas: 'pieza', pza: 'pieza', pzas: 'pieza', cajas: 'caja', costales: 'costal', bultos: 'bulto', paquetes: 'paquete',
};
const OPCIONES_UNIDAD = Object.keys(UNIDADES).map((u) => ({ value: u, label: u.charAt(0).toUpperCase() + u.slice(1) }));

/** Convierte lo pegado desde Excel en filas de productos. */
export function analizarTexto(texto) {
  return texto.split(/\r?\n/).map((r) => r.split(/\t|;/).map((c) => c.trim()))
    .filter((c) => c[0] && !/^nombre$/i.test(c[0]))
    .map(([nombre, categoria, presentacion, unidad, precio, costo]) => {
      let u = (unidad || 'pieza').toLowerCase();
      u = ALIAS_UNIDAD[u] || u;
      const fila = {
        nombre: nombre.slice(0, 80), categoria: (categoria || 'General').slice(0, 40),
        presentacion: (presentacion || '').slice(0, 60), unidad: UNIDADES[u] ? u : 'pieza',
        precio_base: Math.max(0, numero(precio) ?? 0),
      };
      const c = numero(costo);
      if (c !== null && c >= 0) fila.costo = c;
      return fila;
    });
}

function ModalProducto({ producto, alCerrar }) {
  const { message } = App.useApp();
  const { productos, recargarProductos, esMargenBajo, margenDe } = usePanel();
  const [form] = Form.useForm();
  const precio = Form.useWatch('precio_base', form);
  const costo = Form.useWatch('costo', form);
  const m = margenDe(precio, costo);

  async function guardar(v) {
    const fila = {
      nombre: v.nombre.trim(), categoria: (v.categoria || '').trim() || 'General', presentacion: (v.presentacion || '').trim(),
      unidad: v.unidad, precio_base: v.precio_base ?? 0, costo: v.costo ?? null, activo: v.activo,
    };
    const { error } = producto?.id
      ? await db.from('productos').update(fila).eq('id', producto.id)
      : await db.from('productos').insert(fila);
    if (error) return message.error(mensajeError(error));
    message.success('Producto guardado');
    alCerrar();
    recargarProductos();
  }

  return (
    <Modal open title={producto?.id ? 'Editar producto' : 'Nuevo producto'} onCancel={alCerrar} onOk={() => form.submit()} okText="Guardar" cancelText="Cancelar" rootClassName="modal-producto" destroyOnClose>
      <Form form={form} layout="vertical" onFinish={guardar} requiredMark={false} initialValues={{
        nombre: producto?.nombre || '', categoria: producto?.categoria || '', presentacion: producto?.presentacion || '', unidad: producto?.unidad || 'pieza',
        precio_base: producto && Number(producto.precio_base) ? Number(producto.precio_base) : null, costo: producto?.costo ?? null, activo: producto ? producto.activo : true,
      }}>
        <Form.Item name="activo" valuePropName="checked" label="Producto activo"><Switch id="prActivo" /></Form.Item>
        <Form.Item name="nombre" label="Nombre" rules={[{ required: true, whitespace: true, message: 'Escribe el nombre' }]}><Input id="prNombre" maxLength={80} placeholder="Ej. Frijol negro" /></Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}><Form.Item name="categoria" label="Categoría">
            <AutoComplete id="prCategoria" options={[...new Set(productos.map((p) => p.categoria))].map((c) => ({ value: c }))} filterOption placeholder="Ej. Granos" maxLength={40} />
          </Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="unidad" label="Unidad de venta"><Select id="prUnidad" options={OPCIONES_UNIDAD} /></Form.Item></Col>
        </Row>
        <Form.Item name="presentacion" label="Presentación"><Input id="prPresentacion" maxLength={60} placeholder="Ej. Costal 25 kg" /></Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}><Form.Item name="precio_base" label="Precio base (con IVA)"><InputNumber id="prPrecio" min={0} step={0.5} precision={2} prefix="$" style={{ width: '100%' }} placeholder="0.00" /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="costo" label="Costo (opcional)"><InputNumber id="prCosto" min={0} step={0.5} precision={2} prefix="$" style={{ width: '100%' }} placeholder="0.00" /></Form.Item></Col>
        </Row>
        {m !== null && <Text id="prMargen">Margen: <Text strong type={esMargenBajo(m) ? 'danger' : undefined}>{textoMargen(m)}</Text></Text>}
      </Form>
    </Modal>
  );
}

function ModalImportar({ alCerrar }) {
  const { message } = App.useApp();
  const { recargarProductos } = usePanel();
  const [texto, setTexto] = useState('');
  const filas = analizarTexto(texto);

  async function importar() {
    const { error } = await db.from('productos').insert(filas.map((f) => ({ costo: null, ...f })));
    if (error) return message.error(mensajeError(error));
    message.success(`${filas.length} productos agregados`);
    alCerrar();
    recargarProductos();
  }

  return (
    <Modal open title="Pegar productos desde Excel" onCancel={alCerrar} onOk={importar} okText="Agregar productos" cancelText="Cancelar"
      okButtonProps={{ disabled: !filas.length, id: 'btnConfirmarImportar' }} rootClassName="modal-importar" width={640}>
      <Paragraph type="secondary">
        Copia en Excel o Google Sheets las columnas <strong>Nombre</strong>, <strong>Categoría</strong>, <strong>Presentación</strong>,
        {' '}<strong>Unidad</strong>, <strong>Precio base</strong> y <strong>Costo</strong> (en ese orden; las dos últimas son opcionales) y pégalas aquí.
        Unidades válidas: pieza, kilo, litro, caja, costal, bulto, paquete.
      </Paragraph>
      <Input.TextArea id="textoImportar" rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'Frijol negro\tGranos\tCostal 25 kg\tcostal\t520\t430'} />
      <Text type="secondary" id="vistaImportar" style={{ display: 'block', marginTop: 8 }}>{filas.length ? `${filas.length} productos listos para agregar.` : ''}</Text>
    </Modal>
  );
}

export default function Catalogo() {
  const { productos, esMargenBajo, margenDe } = usePanel();
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [editando, setEditando] = useState(undefined);   // undefined: cerrado; null: nuevo
  const [importando, setImportando] = useState(false);

  const categorias = [...new Set(productos.map((p) => p.categoria))];
  const lista = productos
    .filter((p) => !categoria || p.categoria === categoria)
    .filter((p) => !busqueda || `${p.nombre} ${p.categoria} ${p.presentacion}`.toLowerCase().includes(busqueda.toLowerCase()));

  const columnas = [
    {
      title: 'Producto', key: 'nombre', sorter: (a, b) => a.nombre.localeCompare(b.nombre),
      render: (_, p) => <><Text strong>{p.nombre}</Text><div><Text type="secondary" style={{ fontSize: 13 }}>{textoPresentacion(p)}</Text></div></>,
    },
    { title: 'Categoría', dataIndex: 'categoria', width: 150, render: (c) => <Tag bordered={false}>{c}</Tag> },
    {
      title: 'Precio base', dataIndex: 'precio_base', align: 'right', width: 130, sorter: (a, b) => a.precio_base - b.precio_base,
      render: (v) => (Number(v) ? <Text className="cifra">{dinero(v)}</Text> : <Text type="danger">Sin precio</Text>),
    },
    { title: 'Costo', dataIndex: 'costo', align: 'right', width: 120, responsive: ['md'], render: (v) => (v != null ? <Text className="cifra">{dinero(v)}</Text> : '—') },
    {
      title: 'Margen', key: 'margen', align: 'right', width: 100,
      render: (_, p) => {
        const m = margenDe(p.precio_base, p.costo);
        return <Text type={esMargenBajo(m) ? 'danger' : undefined} className={`cifra ${esMargenBajo(m) ? 'margen-bajo' : ''}`}>{textoMargen(m)}</Text>;
      },
    },
    { title: 'Estado', dataIndex: 'activo', width: 100, render: (a) => (a ? <Tag color="success">Activo</Tag> : <Tag>Inactivo</Tag>) },
    { title: '', key: 'a', width: 100, align: 'right', render: (_, p) => <Button size="small" icon={<EditOutlined />} data-editar-producto={p.id} onClick={() => setEditando(p)}>Editar</Button> },
  ];

  return (
    <>
      <Encabezado titulo="Catálogo general" texto="Todos tus productos. El precio base se propone al asignarlos a un cliente.">
        <Button icon={<TableOutlined />} id="btnImportar" onClick={() => setImportando(true)}>Pegar desde Excel</Button>
        <Button type="primary" icon={<PlusOutlined />} id="btnNuevoProducto" onClick={() => setEditando(null)}>Nuevo producto</Button>
      </Encabezado>
      <Card styles={{ body: { padding: 0 } }}>
        <Flex gap={8} wrap style={{ padding: 16 }}>
          <Input.Search id="buscarProducto" placeholder="Buscar producto…" allowClear value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 320 }} />
          <Select id="filtroCategoria" value={categoria} onChange={setCategoria} style={{ width: 200 }}
            options={[{ value: '', label: 'Todas las categorías' }, ...categorias.map((c) => ({ value: c, label: c }))]} />
        </Flex>
        <Table id="listaProductos" rowKey="id" columns={columnas} dataSource={lista} size="middle" scroll={{ x: 720 }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }} rowClassName={(p) => (p.activo ? '' : 'inactivo')}
          locale={{ emptyText: productos.length ? 'Ningún producto coincide.' : 'Aún no hay productos. Agrega uno o pégalos desde Excel.' }} />
      </Card>
      {editando !== undefined && <ModalProducto producto={editando} alCerrar={() => setEditando(undefined)} />}
      {importando && <ModalImportar alCerrar={() => setImportando(false)} />}
    </>
  );
}
