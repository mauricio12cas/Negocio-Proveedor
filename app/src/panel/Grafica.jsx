// Gráfica de barras de ventas por día (Chart.js), con los colores del tema de antd.
import { useEffect, useRef } from 'react';
import { theme } from 'antd';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { dinero, dineroCompacto, fechaCorta, fechaLarga } from '../comun.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export default function Grafica({ dias, alto = 280 }) {
  const lienzo = useRef(null);
  const { token } = theme.useToken();

  useEffect(() => {
    if (!lienzo.current) return undefined;
    const fuente = { family: token.fontFamily, size: 11 };
    const g = new Chart(lienzo.current, {
      type: 'bar',
      data: {
        labels: dias.map((d) => d.fecha),
        datasets: [{
          data: dias.map((d) => Number(d.total) || 0),
          backgroundColor: token.colorPrimary,
          hoverBackgroundColor: token.colorPrimaryHover,
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 24,
          categoryPercentage: 0.82,
          barPercentage: 0.9,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: token.colorBgElevated, titleColor: token.colorText, bodyColor: token.colorTextSecondary,
            borderColor: token.colorBorder, borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: false,
            titleFont: { ...fuente, size: 12, weight: '600' }, bodyFont: { ...fuente, size: 12 },
            callbacks: {
              title: (items) => fechaLarga(dias[items[0].dataIndex].fecha),
              label: (item) => [`Ventas: ${dinero(dias[item.dataIndex].total)}`, `Pedidos: ${dias[item.dataIndex].pedidos}`],
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: token.colorBorderSecondary },
            ticks: { color: token.colorTextTertiary, font: fuente, autoSkip: true, maxRotation: 0, maxTicksLimit: 8, callback: (_, i) => fechaCorta(dias[i].fecha) },
          },
          y: {
            beginAtZero: true,
            grid: { color: token.colorBorderSecondary, drawTicks: false },
            border: { display: false },
            ticks: { color: token.colorTextTertiary, font: fuente, padding: 8, maxTicksLimit: 5, callback: (v) => (v >= 10000 ? dineroCompacto(v) : dinero(v).replace(/\.00$/, '')) },
          },
        },
      },
    });
    return () => g.destroy();
  }, [dias, token]);

  const total = dias.reduce((a, d) => a + (Number(d.total) || 0), 0);
  return (
    <div style={{ position: 'relative', height: alto }}>
      <canvas ref={lienzo} id="graficaVentas" data-puntos={dias.length} role="img"
        aria-label={`Ventas por día, últimos ${dias.length} días. Total ${dinero(total)}.`} />
    </div>
  );
}
