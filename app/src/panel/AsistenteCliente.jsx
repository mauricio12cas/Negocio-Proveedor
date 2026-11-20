// Asistente de 4 pasos para crear o editar un cliente: datos, productos y precios, sucursales y link.
import { useMemo, useState } from 'react';
import {
  Alert, App, Button, Checkbox, Col, Collapse, Flex, Form, Input, InputNumber, Result, Row, Select, Space, Steps, Switch, Table, Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, WhatsAppOutlined } from '@ant-design/icons';
import { abrirWhatsApp, db, dinero, numero, textoMargen, textoPresentacion, urlCliente } from '../comun.js';
import { usePanel } from './Panel.jsx';
import Hoja from '../Hoja.jsx';

const { Text, Paragraph } = Typography;
const TIPOS = ['Restaurante', 'Cafetería', 'Dark kitchen', 'Food truck', 'Público en general', 'Otro'];

export default function AsistenteCliente({ cliente, paso: pasoInicial = 1, alCerrar }) {
  const { message, modal } = App.useApp();
  const { productos, clientes, recargarClientes, esMargenBajo, margenDe, celular } = usePanel();

  const [editando, setEditando] = useState(cliente);
  const [paso, setPaso] = useState(pasoInicial);
  const [datos, setDatos] = useState({
    nombre: cliente?.nombre || '', tipo: cliente?.tipo || null, telefono: cliente?.telefono || '', direccion: cliente?.direccion || '',
    horario_recepcion: cliente?.horario_recepcion || '', instrucciones: cliente?.instrucciones || '', activo: cliente ? cliente.activo : true,
  });
  const [seleccion, setSeleccion] = useState(() => new Map((cliente?.cliente_productos || []).map((x) => [x.producto_id, String(Number(x.precio) || '')])));
  const [sucursales, setSucursales] = useState(() => [...(cliente?.sucursales || [])].sort((a, b) => a.orden - b.orden).map((s) => ({ ...s, clave: s.id })));
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('');
  const [porcentaje, setPorcentaje] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const nuevo = !editando;
  const campo = (k) => (e) => setDatos((d) => ({ ...d, [k]: e?.target ? e.target.value : e }));
  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria))], [productos]);
  const visibles = productos
    .filter((p) => p.activo || seleccion.has(p.id))
    .filter((p) => !categoria || p.categoria === categoria)
    .filter((p) => !busqueda || `${p.nombre} ${p.presentacion} ${p.categoria}`.toLowerCase().includes(busqueda.toLowerCase()));
  const disponibles = productos.filter((p) => p.activo || seleccion.has(p.id)).length;

  function validar(n) {
    if (n === 1 && !datos.nombre.trim()) { setError('Escribe el nombre del cliente.'); return false; }
    if (n === 2) {
      const sinPrecio = [...seleccion.values()].filter((v) => !(numero(v) > 0)).length;
      if (sinPrecio) { setError(`Falta el precio de ${sinPrecio} ${sinPrecio === 1 ? 'producto marcado' : 'productos marcados'}.`); return false; }
    }
    setError('');
    return true;
  }
  const ir = (n) => { if (n > paso && !validar(paso)) return; setError(''); setPaso(n); };

  function marcar(ids, valor) {
    setSeleccion((s) => {
      const m = new Map(s);
      ids.forEach((id) => {
        const p = productos.find((x) => x.id === id);
        if (valor) m.set(id, m.get(id) || (Number(p.precio_base) ? String(Number(p.precio_base)) : ''));
        else m.delete(id);
      });
      return m;
    });
    setError('');
  }

  function ajustar() {
    if (porcentaje === null || porcentaje === undefined) return message.error('Escribe el porcentaje, por ejemplo 10 o -5.');
    if (!seleccion.size) return message.error('Primero marca productos.');
    setSeleccion((s) => new Map([...s].map(([id, v]) => {
      const precio = numero(v);
      return [id, precio > 0 ? String(Math.round(precio * (1 + porcentaje / 100) * 100) / 100) : v];
    })));
    message.success(`Precios ajustados ${porcentaje > 0 ? '+' : ''}${porcentaje} %`);
  }

  function copiarDe(id) {
    const origen = clientes.find((x) => x.id === id);
    if (!origen) return;
    const aplicar = () => {
      setSeleccion(new Map(origen.cliente_productos.map((x) => [x.producto_id, String(Number(x.precio) || '')])));
      message.success(`Copiados ${origen.cliente_productos.length} productos de ${origen.nombre}`);
    };
    if (seleccion.size) {
      modal.confirm({ title: `¿Copiar de ${origen.nombre}?`, content: 'Se reemplazarán los productos y precios actuales.', okText: 'Copiar', cancelText: 'Cancelar', onOk: aplicar });
    } else aplicar();
  }

  async function guardarCliente() {
    const fila = {
      nombre: datos.nombre.trim(), tipo: datos.tipo || null, telefono: datos.telefono.trim() || null,
      direccion: datos.direccion.trim() || null, horario_recepcion: datos.horario_recepcion.trim() || null,
      instrucciones: datos.instrucciones.trim() || null, activo: datos.activo,
    };
    let id = editando?.id;
    let previo = editando || { sucursales: [], cliente_productos: [] };
    if (id) {
      const { error: e } = await db.from('clientes').update(fila).eq('id', id);
      if (e) throw e;
    } else {
      const { data, error: e } = await db.from('clientes').insert(fila).select('id').single();
      if (e) throw e;
      id = data.id;
      previo = { id, sucursales: [], cliente_productos: [] };
    }

    // Sucursales: actualizar, agregar y quitar
    const filas = sucursales.map((s, i) => ({ id: s.id || null, nombre: (s.nombre || '').trim(), orden: i })).filter((s) => s.nombre);
    const conservar = new Set(filas.filter((s) => s.id).map((s) => s.id));
    const quitar = previo.sucursales.filter((s) => !conservar.has(s.id)).map((s) => s.id);
    if (quitar.length) { const { error: e } = await db.from('sucursales').delete().in('id', quitar); if (e) throw e; }
    for (const s of filas.filter((x) => x.id)) {
      const { error: e } = await db.from('sucursales').update({ nombre: s.nombre, orden: s.orden }).eq('id', s.id);
      if (e) throw e;
    }
    const nuevas = filas.filter((x) => !x.id).map((s) => ({ cliente_id: id, nombre: s.nombre, orden: s.orden }));
    if (nuevas.length) { const { error: e } = await db.from('sucursales').insert(nuevas); if (e) throw e; }

    // Productos y precios: actualizar o agregar los marcados, quitar los desmarcados
    const asignados = [...seleccion].map(([producto_id, precio]) => ({ cliente_id: id, producto_id, precio: numero(precio) }));
    if (asignados.length) {
      const { error: e } = await db.from('cliente_productos').upsert(asignados, { onConflict: 'cliente_id,producto_id' });
      if (e) throw e;
    }
    const quitarProductos = previo.cliente_productos.map((x) => x.producto_id).filter((pid) => !seleccion.has(pid));
    if (quitarProductos.length) {
      const { error: e } = await db.from('cliente_productos').delete().eq('cliente_id', id).in('producto_id', quitarProductos);
      if (e) throw e;
    }
    return id;
  }

  async function guardar() {
    for (const n of [1, 2]) if (!validar(n)) { setPaso(n); return; }
    setGuardando(true);
    try {
      const id = await guardarCliente();
      const lista = await recargarClientes();
      message.success('Cliente guardado');
      if (nuevo) { setEditando(lista.find((x) => x.id === id)); setPaso(4); } else alCerrar();
    } catch (e) {
      message.error(e.message || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  }

  function linkNuevo() {
    modal.confirm({
      title: '¿Generar un link nuevo?', content: 'El link actual dejará de funcionar y tendrás que enviarle el nuevo al cliente.',
      okText: 'Generar', okButtonProps: { danger: true }, cancelText: 'Cancelar',
      onOk: async () => {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
        const { error: e } = await db.from('clientes').update({ token }).eq('id', editando.id);
        if (e) return message.error(e.message);
        setEditando((c) => ({ ...c, token }));
        message.success('Link nuevo generado');
        recargarClientes();
      },
    });
  }

  // ─────────── Contenido de cada paso ───────────
  const paso1 = (
    <div className="paso" data-paso="1">
      <Flex align="center" gap={10} style={{ marginBottom: 16 }}>
        <Switch id="clActivo" checked={datos.activo} onChange={campo('activo')} /><Text strong>Cliente activo (puede hacer pedidos)</Text>
      </Flex>
      <Form layout="vertical" component="div"><Row gutter={12}>
        <Col span={24}><Form.Item label="Nombre"><Input id="clNombre" value={datos.nombre} onChange={campo('nombre')} maxLength={80} placeholder="Ej. Café Centro" status={error && paso === 1 ? 'error' : ''} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item label="Tipo"><Select id="clTipo" value={datos.tipo} onChange={campo('tipo')} allowClear placeholder="—" style={{ width: '100%' }} options={TIPOS.map((t) => ({ value: t, label: t }))} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item label="Teléfono (WhatsApp)"><Input id="clTelefono" value={datos.telefono} onChange={campo('telefono')} inputMode="tel" maxLength={30} /></Form.Item></Col>
        <Col span={24}><Form.Item label="Dirección de entrega"><Input id="clDireccion" value={datos.direccion} onChange={campo('direccion')} maxLength={200} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item label="Horario de recepción"><Input id="clHorario" value={datos.horario_recepcion} onChange={campo('horario_recepcion')} maxLength={60} placeholder="Ej. 7:00 a 10:00" /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item label="Instrucciones de entrega"><Input id="clInstrucciones" value={datos.instrucciones} onChange={campo('instrucciones')} maxLength={200} placeholder="Ej. puerta trasera" /></Form.Item></Col>
      </Row></Form>
    </div>
  );

  const campoPrecio = (p, ancho = 140) => (
    <InputNumber
      aria-label={`Precio de ${p.nombre}`} className="precio-cliente" min={0} step={0.5} precision={2} prefix="$" style={{ width: ancho }}
      inputMode="decimal" disabled={!seleccion.has(p.id)} value={seleccion.has(p.id) && seleccion.get(p.id) !== '' ? Number(seleccion.get(p.id)) : null}
      placeholder="0.00" onChange={(v) => { setSeleccion((s) => new Map(s).set(p.id, v === null ? '' : String(v))); setError(''); }}
    />
  );
  const textoMargenDe = (p) => {
    if (!seleccion.has(p.id)) return null;
    const m = margenDe(numero(seleccion.get(p.id)), p.costo);
    return <Text type={esMargenBajo(m) ? 'danger' : 'secondary'} className={`margen cifra ${esMargenBajo(m) ? 'margen-bajo' : ''}`}>{textoMargen(m)}</Text>;
  };

  const columnasPrecios = [
    {
      title: 'Producto', key: 'p',
      render: (_, p) => <><Text strong>{p.nombre}</Text> <Text type="secondary" style={{ fontSize: 12 }}>{textoPresentacion(p)}</Text>{!p.activo && <Text type="danger" style={{ fontSize: 12 }}> inactivo</Text>}</>,
    },
    { title: 'Precio base', dataIndex: 'precio_base', align: 'right', width: 120, render: (v) => <Text type="secondary" className="cifra">{Number(v) ? dinero(v) : '—'}</Text> },
    {
      title: 'Precio del cliente', key: 'precio', align: 'right', width: 160,
      render: (_, p) => campoPrecio(p),
    },
    {
      title: 'Margen', key: 'm', align: 'right', width: 90,
      render: (_, p) => textoMargenDe(p),
    },
  ];

  const herramientas = (
    <Flex gap={8} wrap>
      <Space.Compact>
        <InputNumber id="ppPorcentaje" value={porcentaje} onChange={setPorcentaje} step={0.5} placeholder="%" suffix="%" style={{ width: 90 }} aria-label="Porcentaje de ajuste" />
        <Button id="ppAjustar" onClick={ajustar}>Ajustar precios</Button>
      </Space.Compact>
      <Select id="ppCopiar" value={null} placeholder="Copiar de otro cliente…" style={{ width: celular ? '100%' : 230 }} onChange={copiarDe}
        options={clientes.filter((x) => x.id !== editando?.id && x.cliente_productos.length).map((x) => ({ value: x.id, label: `${x.nombre} (${x.cliente_productos.length})` }))} />
    </Flex>
  );

  const listaPrecios = (
    <div id="ppTabla">
      {!visibles.length && <Text type="secondary">Ningún producto coincide.</Text>}
      {visibles.map((p) => {
        const marcado = seleccion.has(p.id);
        return (
          <Flex key={p.id} data-producto={p.id} className={marcado ? 'marcado' : 'sin-marcar'} align="center" gap={10}
            style={{ padding: '10px 0', borderBottom: '1px solid rgba(128,128,128,.15)', opacity: marcado ? 1 : 0.75 }}>
            <Checkbox checked={marcado} onChange={(e) => marcar([p.id], e.target.checked)} aria-label={`Asignar ${p.nombre}`} />
            <div style={{ flex: 1, minWidth: 0 }} onClick={() => marcar([p.id], !marcado)}>
              <Text strong style={{ display: 'block' }}>{p.nombre}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{textoPresentacion(p)} · base {Number(p.precio_base) ? dinero(p.precio_base) : '—'}</Text>
              {marcado && <div style={{ fontSize: 12 }}>Margen {textoMargenDe(p)}</div>}
            </div>
            {campoPrecio(p, 118)}
          </Flex>
        );
      })}
    </div>
  );

  const paso2 = (
    <div className="paso" data-paso="2">
      {celular ? (
        <>
          <Flex gap={8} style={{ marginBottom: 8 }}>
            <Input.Search id="ppBuscar" placeholder="Buscar producto…" allowClear value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ flex: 1 }} />
            <Select id="ppCategoria" value={categoria} onChange={setCategoria} style={{ width: 130 }} popupMatchSelectWidth={false}
              options={[{ value: '', label: 'Todas' }, ...categorias.map((c) => ({ value: c, label: c }))]} />
          </Flex>
          <Collapse size="small" ghost style={{ marginBottom: 8 }} items={[{ key: 'h', label: 'Herramientas: ajustar ±% y copiar de otro cliente', children: herramientas }]} />
        </>
      ) : (
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Input.Search id="ppBuscar" placeholder="Buscar producto…" allowClear value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: 200 }} />
          <Select id="ppCategoria" value={categoria} onChange={setCategoria} style={{ width: 180 }}
            options={[{ value: '', label: 'Todas las categorías' }, ...categorias.map((c) => ({ value: c, label: c }))]} />
          {herramientas}
        </Flex>
      )}
      {productos.length ? celular ? listaPrecios : (
        <Table id="ppTabla" rowKey="id" size="small" pagination={false} scroll={{ y: '42vh', x: 560 }} dataSource={visibles} columns={columnasPrecios}
          rowClassName={(p) => (seleccion.has(p.id) ? 'marcado' : 'sin-marcar')}
          onRow={(p) => ({ 'data-producto': p.id })}
          rowSelection={{
            selectedRowKeys: [...seleccion.keys()],
            onSelect: (p, valor) => marcar([p.id], valor),
            onSelectAll: (valor, _f, cambios) => marcar((cambios.length ? cambios : visibles).map((p) => p.id), valor),
            columnTitle: undefined,
          }}
          locale={{ emptyText: 'Ningún producto coincide.' }} />
      ) : <Alert type="info" showIcon message="Primero agrega productos en Catálogo." />}
      <Text type="secondary" id="ppContador" style={{ display: 'block', marginTop: 8 }}>{seleccion.size} de {disponibles} productos asignados.</Text>
    </div>
  );

  const paso3 = (
    <div className="paso" data-paso="3">
      <Paragraph type="secondary">Agrega sucursales solo si cada una pide y recibe por separado. Todas usan los mismos precios.</Paragraph>
      <div id="clSucursales">
        {sucursales.map((s, i) => (
          <Flex key={s.clave} gap={6} style={{ marginBottom: 8 }} className="fila">
            <Input value={s.nombre} maxLength={60} placeholder="Nombre de la sucursal"
              onChange={(e) => setSucursales((l) => l.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} />
            <Button icon={<DeleteOutlined />} aria-label="Quitar sucursal" onClick={() => setSucursales((l) => l.filter((_, j) => j !== i))} />
          </Flex>
        ))}
      </div>
      <Button icon={<PlusOutlined />} id="btnAgregarSucursal" onClick={() => setSucursales((l) => [...l, { clave: `n${Date.now()}${Math.random()}`, nombre: '' }])}>Agregar sucursal</Button>
    </div>
  );

  const link = editando ? urlCliente(editando.token) : '';
  const nProductos = editando?.cliente_productos?.length || 0;
  const paso4 = editando && (
    <div className="paso" data-paso="4">
      <Result status="success" title={editando.nombre}
        subTitle={<span id="listoTexto">{nProductos} {nProductos === 1 ? 'producto' : 'productos'} con precio. Envíale este link para que haga sus pedidos.</span>}
        extra={[
          <Paragraph key="l" copyable={{ text: link, tooltips: ['Copiar link', 'Copiado'] }} code id="listoLink" style={{ wordBreak: 'break-all' }}>{link}</Paragraph>,
          <Space key="b" wrap style={{ justifyContent: 'center' }}>
            <Button type="primary" icon={<WhatsAppOutlined />} id="listoWhatsApp" onClick={() => abrirWhatsApp(editando.telefono, `Hola, este es tu link para hacer pedidos: ${link}`)}>Enviar por WhatsApp</Button>
            <Button danger icon={<ReloadOutlined />} id="btnNuevoLink" onClick={linkNuevo}>Generar link nuevo</Button>
          </Space>,
        ]} />
    </div>
  );

  const pie = (
    <Flex gap={8} wrap={!celular}>
      {paso > 1 && paso < 4 && <Button id="btnAtras" onClick={() => { setError(''); setPaso(paso - 1); }}>Atrás</Button>}
      <span style={{ flex: 1 }} />
      <Button id="btnCancelarCliente" onClick={alCerrar}>{paso === 4 ? 'Cerrar' : 'Cancelar'}</Button>
      {nuevo && paso < 3 && <Button type="primary" ghost id="btnSiguiente" onClick={() => ir(paso + 1)}>Siguiente</Button>}
      {paso < 4 && (!nuevo || paso === 3) && (
        <Button type="primary" id="btnGuardarCliente" loading={guardando} onClick={guardar}>{nuevo ? (celular ? 'Guardar' : 'Guardar y ver link') : 'Guardar'}</Button>
      )}
    </Flex>
  );

  return (
    <Hoja open width={920} title={editando ? editando.nombre : 'Nuevo cliente'} onCancel={alCerrar} footer={pie} rootClassName="modal-cliente" maskClosable={false}
      styles={{ body: { minHeight: 320 } }}>
      <Steps id="pasosCliente" current={paso - 1} size="small" responsive={false} style={{ margin: celular ? '0 0 16px' : '8px 0 24px' }}
        onChange={(i) => ir(i + 1)}
        items={[
          { title: 'Datos' },
          { title: 'Productos y precios', disabled: nuevo && paso < 2 },
          { title: 'Sucursales', disabled: nuevo && paso < 3 },
          { title: 'Link', disabled: nuevo },
        ].map((x, i) => (celular && i !== paso - 1 ? { ...x, title: '' } : x))} />
      {paso === 1 && paso1}
      {paso === 2 && paso2}
      {paso === 3 && paso3}
      {paso === 4 && paso4}
      {error && <Alert type="error" showIcon message={error} id="errorPaso" style={{ marginTop: 12 }} />}
    </Hoja>
  );
}
