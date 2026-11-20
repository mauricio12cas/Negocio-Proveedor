// Panel de administración: acceso, estructura (menú lateral) y datos compartidos entre vistas.
import { createContext, useContext, useEffect, useState } from 'react';
import {
  Alert, App, Avatar, Badge, Button, Card, Drawer, Flex, Form, Grid, Input, Layout, Menu, Segmented, Spin, Tooltip, Typography, theme,
} from 'antd';
import {
  AppstoreOutlined, DashboardOutlined, DesktopOutlined, LogoutOutlined, MenuOutlined, MoonOutlined,
  ProfileOutlined, SettingOutlined, ShoppingCartOutlined, SunOutlined, TeamOutlined,
} from '@ant-design/icons';
import { db, hoyMX, iniciales, margen, mensajeError } from '../comun.js';
import { Logo } from '../Tema.jsx';
import Inicio from './Inicio.jsx';
import Pedidos from './Pedidos.jsx';
import Compras from './Compras.jsx';
import Clientes from './Clientes.jsx';
import Catalogo from './Catalogo.jsx';
import Ajustes from './Ajustes.jsx';

const { Text, Title, Paragraph } = Typography;
const Contexto = createContext(null);
/** Datos y acciones compartidas por todas las vistas del panel. */
export const usePanel = () => useContext(Contexto);

/** Encabezado de cada vista: título, descripción y acciones. */
export function Encabezado({ titulo, texto, children }) {
  return (
    <Flex justify="space-between" align="flex-end" gap={12} wrap style={{ marginBottom: 20 }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>{titulo}</Title>
        {texto && <Text type="secondary">{texto}</Text>}
      </div>
      {children && <Flex gap={8} wrap align="center" className="sin-imprimir">{children}</Flex>}
    </Flex>
  );
}

const VISTAS = { inicio: Inicio, pedidos: Pedidos, compras: Compras, clientes: Clientes, catalogo: Catalogo, ajustes: Ajustes };

function Acceso({ alEntrar, error, nota, sinConfig }) {
  const { token } = theme.useToken();
  const [enviando, setEnviando] = useState(false);
  return (
    <Flex align="center" justify="center" style={{
      minHeight: '100vh', padding: 16,
      background: `radial-gradient(900px 500px at 15% -10%, ${token.colorPrimaryBg}, transparent 70%), ${token.colorBgLayout}`,
    }}>
      <Card style={{ width: '100%', maxWidth: 400, boxShadow: token.boxShadow }} styles={{ body: { padding: 28 } }}>
        <Flex align="center" gap={10} style={{ marginBottom: 22 }}>
          <Logo nombre="PROVEEDOR" size={40} /><Text strong>PROVEEDOR</Text>
        </Flex>
        <Title level={3} style={{ margin: 0 }}>Bienvenido de vuelta</Title>
        <Paragraph type="secondary" style={{ margin: '4px 0 20px' }}>Entra al panel para administrar pedidos, clientes y precios.</Paragraph>
        <Form layout="vertical" requiredMark={false} disabled={sinConfig}
          onFinish={async (v) => { setEnviando(true); await alEntrar(v.correo.trim(), v.contrasena); setEnviando(false); }}>
          <Form.Item label="Correo" name="correo" rules={[{ required: true, type: 'email', message: 'Escribe tu correo' }]}>
            <Input id="correo" autoComplete="username" placeholder="tu@correo.com" size="large" />
          </Form.Item>
          <Form.Item label="Contraseña" name="contrasena" rules={[{ required: true, message: 'Escribe tu contraseña' }]}>
            <Input.Password id="contrasena" autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={enviando} id="btnEntrar">Entrar</Button>
        </Form>
        {(error || sinConfig) && <Alert style={{ marginTop: 16 }} type="error" showIcon id="accesoError" message={sinConfig ? 'Falta configurar la conexión a Supabase en config.js.' : error} />}
        {nota && <Paragraph copyable code id="accesoNota" style={{ marginTop: 10, fontSize: 12 }}>{nota}</Paragraph>}
      </Card>
    </Flex>
  );
}

export default function Panel({ modo, cambiarModo, cambiarColor }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const pantalla = Grid.useBreakpoint();
  const escritorio = !!pantalla.lg;

  const [sesion, setSesion] = useState(undefined);   // undefined: revisando; null: sin sesión
  const [acceso, setAcceso] = useState({});
  const [vista, setVista] = useState('inicio');
  const [filtroPedidos, setFiltroPedidos] = useState(null);
  const [menuMovil, setMenuMovil] = useState(false);
  const [ajustes, setAjustes] = useState(null);
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [porConfirmar, setPorConfirmar] = useState(0);

  async function recargarAjustes() {
    const { data, error } = await db.from('ajustes').select('*').single();
    if (error) return message.error(mensajeError(error));
    setAjustes(data);
    cambiarColor(data.color_acento);
    document.title = `Administración · ${data.nombre_negocio}`;
  }
  async function recargarProductos() {
    const { data, error } = await db.from('productos').select('*').order('categoria').order('nombre');
    if (error) return message.error(mensajeError(error));
    setProductos(data);
  }
  async function recargarClientes() {
    const { data, error } = await db.from('clientes')
      .select('*, sucursales(id, nombre, orden), cliente_productos(producto_id, precio)').order('nombre');
    if (error) return message.error(mensajeError(error));
    setClientes(data);
    return data;
  }
  async function contarPorConfirmar() {
    const { data } = await db.from('pedidos').select('id').eq('estado', 'recibido').gte('fecha_entrega', hoyMX());
    if (data) setPorConfirmar(data.length);
  }

  async function entrar(s) {
    const { data: esAdmin, error } = await db.rpc('es_admin');
    if (error || !esAdmin) {
      setAcceso({
        error: 'Este usuario no tiene permiso de administrador.',
        nota: `Para darle permiso, ejecuta en Supabase: insert into administradores (user_id) values ('${s.user.id}');`,
      });
      await db.auth.signOut();
      setSesion(null);
      return;
    }
    await recargarAjustes();
    await Promise.all([recargarProductos(), recargarClientes()]);
    setSesion(s);
  }

  useEffect(() => {
    if (!db) { setSesion(null); return; }
    db.auth.getSession().then(({ data }) => (data.session ? entrar(data.session) : setSesion(null)));
  }, []);

  async function iniciarSesion(correo, contrasena) {
    setAcceso({});
    const { data, error } = await db.auth.signInWithPassword({ email: correo, password: contrasena });
    if (error) return setAcceso({ error: 'Correo o contraseña incorrectos.' });
    await entrar(data.session);
  }

  function irA(destino, filtro = null) {
    setFiltroPedidos(filtro);
    setVista(destino);
    setMenuMovil(false);
    if (ajustes) cambiarColor(ajustes.color_acento);   // descarta la vista previa de Ajustes sin guardar
    window.scrollTo({ top: 0 });
  }

  if (sesion === undefined) return <Flex justify="center" align="center" style={{ minHeight: '100vh' }}><Spin size="large" /></Flex>;
  if (!sesion) return <Acceso alEntrar={iniciarSesion} error={acceso.error} nota={acceso.nota} sinConfig={!db} />;

  const margenMinimo = ajustes?.margen_minimo ?? null;
  const ctx = {
    ajustes, productos, clientes, recargarAjustes, recargarProductos, recargarClientes, contarPorConfirmar,
    setPorConfirmar, irA, filtroPedidos, cambiarColor,
    esMargenBajo: (m) => m !== null && margenMinimo !== null && m < Number(margenMinimo),
    margenDe: (precio, costo) => margen(precio, costo),
  };

  const correo = sesion.user.email || '';
  const nombreNegocio = ajustes?.nombre_negocio || 'PROVEEDOR';
  const elementos = [
    { key: 'inicio', icon: <DashboardOutlined />, label: 'Inicio' },
    { key: 'pedidos', icon: <ProfileOutlined />, label: <Flex justify="space-between" align="center">Pedidos<Badge count={porConfirmar} id="insigniaPedidos" size="small" /></Flex> },
    { key: 'compras', icon: <ShoppingCartOutlined />, label: 'Por comprar' },
    { key: 'clientes', icon: <TeamOutlined />, label: 'Clientes' },
    { key: 'catalogo', icon: <AppstoreOutlined />, label: 'Catálogo' },
    { key: 'ajustes', icon: <SettingOutlined />, label: 'Ajustes' },
  ];

  const marca = (
    <Flex align="center" gap={10} style={{ padding: '18px 20px 14px', minWidth: 0 }}>
      <Logo logo={ajustes?.logo} nombre={nombreNegocio} size={34} />
      <Text strong ellipsis id="panelNegocio" style={{ fontSize: 15 }}>{nombreNegocio}</Text>
    </Flex>
  );
  const selectorTema = (
    <Segmented id="selectorTema" block size="small" value={modo} onChange={cambiarModo} options={[
      { value: 'claro', icon: <SunOutlined />, label: 'Claro' },
      { value: 'sistema', icon: <DesktopOutlined />, label: 'Auto' },
      { value: 'oscuro', icon: <MoonOutlined />, label: 'Oscuro' },
    ]} />
  );
  const usuario = (
    <Flex align="center" gap={10}>
      <Avatar style={{ background: token.colorFillSecondary, color: token.colorText, flexShrink: 0 }}>{iniciales(correo.split('@')[0].replace(/[._-]+/g, ' '))}</Avatar>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text strong ellipsis style={{ display: 'block', fontSize: 13 }} id="usuarioCorreo">{correo}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>Administrador</Text>
      </div>
      <Tooltip title="Cerrar sesión">
        <Button type="text" icon={<LogoutOutlined />} id="btnSalir" aria-label="Cerrar sesión"
          onClick={async () => { await db.auth.signOut(); window.location.reload(); }} />
      </Tooltip>
    </Flex>
  );
  const menu = (
    <Menu id="menu" mode="inline" selectedKeys={[vista]} items={elementos} onClick={({ key }) => irA(key)}
      style={{ borderInlineEnd: 0, padding: '0 8px', background: 'transparent' }} />
  );

  const Vista = VISTAS[vista];
  return (
    <Contexto.Provider value={ctx}>
      <Layout style={{ minHeight: '100vh' }}>
        {escritorio ? (
          <Layout.Sider width={240} className="sin-imprimir" style={{
            position: 'fixed', insetBlock: 0, left: 0, borderInlineEnd: `1px solid ${token.colorBorderSecondary}`,
          }}>
            <Flex vertical style={{ height: '100%' }}>
              {marca}
              <div style={{ flex: 1, overflowY: 'auto' }}>{menu}</div>
              <Flex vertical gap={12} style={{ padding: 14, borderTop: `1px solid ${token.colorBorderSecondary}` }}>{selectorTema}{usuario}</Flex>
            </Flex>
          </Layout.Sider>
        ) : (
          <Layout.Header className="sin-imprimir" style={{
            position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px 0 0',
            borderBottom: `1px solid ${token.colorBorderSecondary}`, height: 56,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>{marca}</div>
            <Badge count={porConfirmar} size="small" offset={[-6, 6]}>
              <Button type="text" size="large" icon={<MenuOutlined />} aria-label="Menú" id="btnMenu" onClick={() => setMenuMovil(true)} />
            </Badge>
          </Layout.Header>
        )}
        {!escritorio && (
          <Drawer open={menuMovil} onClose={() => setMenuMovil(false)} placement="left" width={280} title={null} closable={false}
            styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}>
            {marca}
            <div style={{ flex: 1 }}>{menu}</div>
            <Flex vertical gap={12} style={{ padding: 14, borderTop: `1px solid ${token.colorBorderSecondary}` }}>{selectorTema}{usuario}</Flex>
          </Drawer>
        )}
        <Layout className="panel-principal" style={{ marginLeft: escritorio ? 240 : 0 }}>
          <Layout.Content style={{ padding: escritorio ? '28px 32px 64px' : '18px 14px 48px', maxWidth: 1360, width: '100%' }}>
            <Vista key={vista} />
          </Layout.Content>
        </Layout>
      </Layout>
    </Contexto.Provider>
  );
}
