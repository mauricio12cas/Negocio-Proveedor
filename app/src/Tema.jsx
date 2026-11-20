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

/** true mientras se cumpla la consulta de medios (y se actualiza al cambiar). */
function useMedia(consultaCss) {
  const consulta = () => window.matchMedia?.(consultaCss);
  const [cumple, setCumple] = useState(() => !!consulta()?.matches);
  useEffect(() => {
    const mq = consulta();
    if (!mq) return undefined;
    const cambio = (e) => setCumple(e.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, [consultaCss]);
  return cumple;
}

/** true si el sistema está en modo oscuro. */
export const useSistemaOscuro = () => useMedia('(prefers-color-scheme: dark)');

/** true en pantallas de celular (menos de 768 px): las vistas cambian tablas por listas. */
export const useCelular = () => useMedia('(max-width: 767.98px)');

/** Dibuja el ícono de la pantalla de inicio (180 px) con el logo o las iniciales sobre el color de marca. */
export function useIconoMarca({ logo, nombre, color }) {
  useEffect(() => {
    if (!nombre && !logo) return undefined;
    let cancelado = false;
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 180;
    const g = lienzo.getContext('2d');
    if (!g) return undefined;
    const poner = () => {
      if (cancelado) return;
      let enlace = document.querySelector('link[rel="apple-touch-icon"]');
      if (!enlace) { enlace = document.createElement('link'); enlace.rel = 'apple-touch-icon'; document.head.appendChild(enlace); }
      enlace.href = lienzo.toDataURL('image/png');
      enlace.dataset.marca = 'si';
    };
    if (esLogoValido(logo)) {
      const img = new Image();
      img.onload = () => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 180, 180);
        const escala = Math.min(132 / img.width, 132 / img.height);
        const w = img.width * escala, h = img.height * escala;
        g.drawImage(img, (180 - w) / 2, (180 - h) / 2, w, h);
        poner();
      };
      img.src = logo;
    } else {
      g.fillStyle = /^#[0-9a-f]{6}$/i.test(color || '') ? color : COLOR_PREDETERMINADO;
      g.fillRect(0, 0, 180, 180);
      g.fillStyle = '#ffffff';
      g.font = `700 72px ${FUENTE}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(iniciales(nombre), 90, 96);
      poner();
    }
    return () => { cancelado = true; };
  }, [logo, nombre, color]);
}

/** Envuelve una página con el tema de antd. modo: 'claro' | 'oscuro' | 'sistema'. */
export function Tema({ color, modo = 'sistema', children }) {
  const sistemaOscuro = useSistemaOscuro();
  const tactil = useMedia('(pointer: coarse)');
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
          colorInfoBg: mezclar(primario, oscuro ? '#141414' : '#ffffff', oscuro ? 0.22 : 0.08),
          colorInfoBorder: mezclar(primario, oscuro ? '#141414' : '#ffffff', oscuro ? 0.45 : 0.3),
          // En pantallas táctiles: controles más altos (dedo) y letra de 16 px en campos (Safari no hace zoom)
          ...(tactil ? { controlHeight: 40, controlHeightLG: 46, controlHeightSM: 32 } : {}),
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
