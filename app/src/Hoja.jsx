// Ventana responsiva: Modal de antd en computadora; hoja inferior de casi pantalla completa en celular.
import { Button, Drawer, Flex, Modal } from 'antd';
import { useCelular } from './Tema.jsx';

const ALTO_MAXIMO = 'calc(100dvh - env(safe-area-inset-top) - 10px)';

export default function Hoja({
  open, title, footer, onCancel, onOk, okText = 'Aceptar', cancelText = 'Cancelar', okButtonProps = {},
  rootClassName = '', width, children, alto = 'completa', destroyOnClose, maskClosable, ...resto
}) {
  const celular = useCelular();
  if (!celular) {
    return (
      <Modal open={open} title={title} footer={footer} onCancel={onCancel} onOk={onOk} okText={okText} cancelText={cancelText}
        okButtonProps={okButtonProps} rootClassName={rootClassName} width={width} destroyOnClose={destroyOnClose} maskClosable={maskClosable} {...resto}>
        {children}
      </Modal>
    );
  }
  // Mismo pie que el Modal cuando no se da uno
  const pie = Array.isArray(footer) ? <Flex gap={8} justify="flex-end">{footer}</Flex> : footer !== undefined ? footer : (
    <Flex gap={8} justify="flex-end">
      <Button size="large" onClick={onCancel}>{cancelText}</Button>
      <Button size="large" type="primary" onClick={onOk} {...okButtonProps}>{okText}</Button>
    </Flex>
  );
  return (
    <Drawer
      open={open}
      onClose={onCancel}
      placement="bottom"
      height={alto === 'completa' ? ALTO_MAXIMO : 'auto'}
      title={title}
      footer={pie}
      rootClassName={`hoja-celular ${rootClassName}`}
      destroyOnClose={destroyOnClose}
      maskClosable={maskClosable !== false}
      styles={{ wrapper: { maxHeight: ALTO_MAXIMO } }}
    >
      {children}
    </Drawer>
  );
}
