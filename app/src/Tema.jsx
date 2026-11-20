// Tema de Ant Design: color de marca, modo claro/oscuro, idioma español y logo.
import { useEffect, useState } from 'react';
import { App as AntApp, Avatar, ConfigProvider, theme } from 'antd';
import esES from 'antd/locale/es_ES';
import dayjs from 'dayjs';
import 'dayjs/locale/es';
import { COLOR_PREDETERMINADO, esLogoValido, iniciales } from './comun.js';
import './estilos.css';

dayjs.locale('es');

/** Mezcla dos colores hex: p = proporción del primero (0 a 1). */
function mezclar(a, b, p) {
  const c = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(c(a, i) * p + c(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('');
}

const FUENTE = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** true si el sistema está en modo oscuro (y se actualiza al cambiar). */
export function useSistemaOscuro() {
  const consulta = () => window.matchMedia?.('(prefers-color-scheme: dark)');
  const [oscuro, setOscuro] = useState(() => !!consulta()?.matches);
  useEffect(() => {
    const mq = consulta();
    if (!mq) return undefined;
    const cambio = (e) => setOscuro(e.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return oscuro;
}

/** Envuelve una página con el tema de antd. modo: 'claro' | 'oscuro' | 'sistema'. */
export function Tema({ color, modo = 'sistema', children }) {
  const sistemaOscuro = useSistemaOscuro();
  const oscuro = modo === 'oscuro' || (modo === 'sistema' && sistemaOscuro);
  const primario = /^#[0-9a-f]{6}$/i.test(color || '') ? color : COLOR_PREDETERMINADO;

  useEffect(() => {
    document.documentElement.dataset.tema = oscuro ? 'oscuro' : 'claro';
    document.documentElement.style.colorScheme = oscuro ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#141414' : '#ffffff');
  }, [oscuro]);

  return (
    <ConfigProvider
      locale={esES}
      theme={{
        algorithm: oscuro ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: primario, colorInfo: primario, borderRadius: 8, fontFamily: FUENTE, colorBgLayout: oscuro ? '#0a0a0a' : '#f5f6f8',
          // Fondos suaves calculados a mano: la paleta de antd los vuelve grises con colores oscuros
          colorPrimaryBg: mezclar(primario, oscuro ? '#141414' : '#ffffff', oscuro ? 0.22 : 0.1),
          colorPrimaryBgHover: mezclar(primario, oscuro ? '#141414' : '#ffffff', oscuro ? 0.3 : 0.16),
          controlItemBgActive: mezclar(primario, oscuro ? '#141414' : '#ffffff', oscuro ? 0.22 : 0.1),
          controlItemBgActiveHover: mezclar(primario, oscuro ? '#141414' : '#ffffff', oscuro ? 0.3 : 0.16),
        },
        components: {
          Layout: { headerBg: oscuro ? '#141414' : '#ffffff', siderBg: oscuro ? '#141414' : '#ffffff', headerPadding: '0 24px' },
          Menu: { itemBorderRadius: 8, activeBarBorderWidth: 0 },
          Card: { headerFontSize: 15 },
          Table: { headerBg: oscuro ? '#1d1d1d' : '#fafafa' },
        },
      }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

/** Logo del negocio o sus iniciales sobre el color de marca. */
export function Logo({ logo, nombre, size = 36 }) {
  const { token } = theme.useToken();
  if (esLogoValido(logo)) {
    return <Avatar shape="square" size={size} src={logo} alt="" style={{ background: 'transparent', flexShrink: 0 }} data-logo="img" />;
  }
  return (
    <Avatar shape="square" size={size} style={{ background: token.colorPrimary, fontWeight: 700, fontSize: size * 0.38, flexShrink: 0 }} data-logo="iniciales">
      {iniciales(nombre)}
    </Avatar>
  );
}
