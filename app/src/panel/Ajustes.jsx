// Ajustes: datos del negocio, marca (logo y color), datos de la remisión y reglas.
import { useState } from 'react';
import {
  App, Button, Card, Col, ColorPicker, Flex, Form, Input, InputNumber, Row, Space, Tag, TimePicker, Typography, Upload, theme,
} from 'antd';
import { CheckOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { COLOR_PREDETERMINADO, db, mensajeError, numero } from '../comun.js';
import { Logo } from '../Tema.jsx';
import { Encabezado, usePanel } from './Panel.jsx';

const { Text } = Typography;
const SUGERIDOS = ['#0f766e', '#15803d', '#1677ff', '#4338ca', '#7e22ce', '#be123c', '#c2410c', '#1e293b'];

/** Reduce la imagen a un máximo de 256 px y la convierte en data URL. */
function reducirImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 256 / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(img.width * escala));
      lienzo.height = Math.max(1, Math.round(img.height * escala));
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      let dato = lienzo.toDataURL('image/png');
      if (dato.length > 280000) dato = lienzo.toDataURL('image/webp', 0.9);
      if (dato.length > 280000) return rechazar(new Error('El logo es demasiado pesado. Prueba con una imagen más sencilla.'));
      resolver(dato);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

export default function Ajustes() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { ajustes, recargarAjustes, cambiarColor, celular, conPestanas } = usePanel();
  const [form] = Form.useForm();
  const [color, setColor] = useState(ajustes.color_acento || COLOR_PREDETERMINADO);
  const [logo, setLogo] = useState(ajustes.logo || null);
  const [guardando, setGuardando] = useState(false);
  const nombre = Form.useWatch('nombre_negocio', form) ?? ajustes.nombre_negocio;

  const elegirColor = (c) => { setColor(c); cambiarColor(c); };

  async function guardar(v) {
    setGuardando(true);
    const whatsapp = (v.whatsapp || '').replace(/\D/g, '');
    const { error } = await db.from('ajustes').update({
      nombre_negocio: (v.nombre_negocio || '').trim() || 'PROVEEDOR',
      whatsapp: whatsapp || null,
      hora_corte: v.hora_corte ? v.hora_corte.format('HH:mm') : null,
      margen_minimo: v.margen_minimo ?? null,
      dias_inactividad: Math.round(numero(v.dias_inactividad) || 7),
      color_acento: color,
      logo,
      razon_social: (v.razon_social || '').trim() || null,
      rfc: (v.rfc || '').trim().toUpperCase() || null,
      telefono: (v.telefono || '').trim() || null,
      direccion: (v.direccion || '').trim() || null,
      leyenda_remision: (v.leyenda_remision || '').trim(),
    }).eq('id', 1);
    setGuardando(false);
    if (error) return message.error(/whatsapp/.test(error.message) ? 'El WhatsApp debe tener de 10 a 15 dígitos.' : mensajeError(error));
    message.success('Ajustes guardados');
    recargarAjustes();
  }

  return (
    <>
      <Encabezado titulo="Ajustes" texto="Datos de tu negocio, tu marca y reglas." />
      <Form form={form} layout="vertical" onFinish={guardar} requiredMark={false} initialValues={{
        nombre_negocio: ajustes.nombre_negocio, whatsapp: ajustes.whatsapp || '',
        hora_corte: ajustes.hora_corte ? dayjs(ajustes.hora_corte, 'HH:mm:ss') : null,
        margen_minimo: ajustes.margen_minimo ?? null, dias_inactividad: ajustes.dias_inactividad ?? 7,
        razon_social: ajustes.razon_social || '', rfc: ajustes.rfc || '', telefono: ajustes.telefono || '',
        direccion: ajustes.direccion || '', leyenda_remision: ajustes.leyenda_remision || '',
      }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="Negocio" extra={<Text type="secondary">Lo que ven tus clientes</Text>} style={{ height: '100%' }}>
              <Form.Item name="nombre_negocio" label="Nombre del negocio" rules={[{ required: true, whitespace: true, message: 'Escribe el nombre' }]}><Input id="ajNombre" maxLength={60} /></Form.Item>
              <Form.Item name="whatsapp" label="WhatsApp para recibir avisos de pedido"
                extra="Solo números, con 52 y 1 al inicio para celulares de México. Déjalo vacío si no quieres usarlo.">
                <Input id="ajWhatsapp" inputMode="numeric" placeholder="5215512345678" />
              </Form.Item>
              <Form.Item name="hora_corte" label="Hora de corte" style={{ marginBottom: 0 }}
                extra="Los pedidos hechos después de esta hora se entregan un día después. Vacío = siempre se puede pedir para mañana.">
                <TimePicker id="ajCorte" format="HH:mm" minuteStep={5} placeholder="Sin hora de corte" style={{ width: 180 }} />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="Marca" extra={<Text type="secondary">Panel, clientes y remisiones</Text>} style={{ height: '100%' }}>
              <Flex align="center" gap={14} style={{ marginBottom: 18 }}>
                <div id="ajLogoVista"><Logo logo={logo} nombre={nombre} size={64} /></div>
                <Space wrap>
                  <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={(archivo) => {
                    reducirImagen(archivo).then(setLogo).catch((e) => message.error(e.message));
                    return false;
                  }}>
                    <Button icon={<UploadOutlined />} id="btnSubirLogo">Subir logo</Button>
                  </Upload>
                  {logo && <Button type="text" icon={<DeleteOutlined />} id="btnQuitarLogo" onClick={() => setLogo(null)}>Quitar</Button>}
                </Space>
              </Flex>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Color principal</Text>
              <Flex gap={8} wrap align="center" id="colores" style={{ marginBottom: 18 }}>
                {SUGERIDOS.map((c) => (
                  <button key={c} type="button" data-color={c} aria-label={`Color ${c}`} onClick={() => elegirColor(c)} style={{
                    width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                    border: `2px solid ${token.colorBgContainer}`, boxShadow: `0 0 0 ${c.toLowerCase() === color.toLowerCase() ? 2 : 1}px ${c.toLowerCase() === color.toLowerCase() ? token.colorText : token.colorBorder}`,
                  }}>{c.toLowerCase() === color.toLowerCase() && <CheckOutlined style={{ color: '#fff' }} />}</button>
                ))}
                <ColorPicker value={color} disabledAlpha onChangeComplete={(c) => elegirColor(c.toHexString())} showText={(c) => <span>Otro: {c.toHexString()}</span>} />
              </Flex>
              <Flex align="center" justify="space-between" gap={10} wrap style={{ border: `1px dashed ${token.colorBorder}`, borderRadius: token.borderRadiusLG, padding: 14 }}>
                <Flex align="center" gap={10}><Logo logo={logo} nombre={nombre} size={34} /><Text strong>{nombre}</Text></Flex>
                <Space><Tag color="blue">Confirmado</Tag><Button type="primary" size="small" tabIndex={-1}>Botón</Button></Space>
              </Flex>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="Datos para remisión" extra={<Text type="secondary">Encabezado de cada nota</Text>} style={{ height: '100%' }}>
              <Form.Item name="razon_social" label="Razón social"><Input id="ajRazon" maxLength={120} placeholder="Opcional" /></Form.Item>
              <Row gutter={12}>
                <Col xs={24} sm={12}><Form.Item name="rfc" label="RFC" normalize={(v) => (v || '').toUpperCase()}><Input id="ajRfc" maxLength={13} placeholder="Opcional" /></Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="telefono" label="Teléfono"><Input id="ajTelefono" maxLength={30} inputMode="tel" placeholder="Opcional" /></Form.Item></Col>
              </Row>
              <Form.Item name="direccion" label="Dirección"><Input id="ajDireccion" maxLength={200} placeholder="Opcional" /></Form.Item>
              <Form.Item name="leyenda_remision" label="Leyenda al pie" style={{ marginBottom: 0 }}><Input.TextArea id="ajLeyenda" rows={2} maxLength={300} showCount /></Form.Item>
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="Reglas" extra={<Text type="secondary">Alertas de Inicio</Text>} style={{ height: '100%' }}>
              <Row gutter={12}>
                <Col xs={24} sm={12}><Form.Item name="margen_minimo" label="Margen mínimo (%)" extra="Te avisa si un precio deja menos margen.">
                  <InputNumber id="ajMargen" min={0} max={100} step={0.5} placeholder="Ej. 15" style={{ width: '100%' }} />
                </Form.Item></Col>
                <Col xs={24} sm={12}><Form.Item name="dias_inactividad" label="Días sin pedir para avisarte" extra="Para la lista de Inicio.">
                  <InputNumber id="ajInactividad" min={1} max={365} step={1} style={{ width: '100%' }} />
                </Form.Item></Col>
              </Row>
            </Card>
          </Col>
        </Row>
        <Flex justify="flex-end" style={{ position: 'sticky', bottom: conPestanas ? 'calc(62px + env(safe-area-inset-bottom))' : 0, padding: '16px 0', marginTop: 8, background: `linear-gradient(transparent, ${token.colorBgLayout} 40%)` }}>
          <Button type="primary" htmlType="submit" size="large" block={celular} icon={<CheckOutlined />} loading={guardando} id="btnGuardarAjustes">Guardar ajustes</Button>
        </Flex>
      </Form>
    </>
  );
}
