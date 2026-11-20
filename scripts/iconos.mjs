// Genera los íconos fijos de la app (respaldo cuando aún no se carga la marca).
// Uso: node scripts/iconos.mjs   (requiere Playwright con Chromium)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(new URL('../pruebas/package.json', import.meta.url));
const { chromium } = require('playwright');
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const tam of [180, 192, 512]) {
  const datos = await pagina.evaluate((t) => {
    const c = document.createElement('canvas');
    c.width = c.height = t;
    const g = c.getContext('2d');
    g.fillStyle = '#0f766e';
    g.fillRect(0, 0, t, t);
    g.fillStyle = '#ffffff';
    g.font = `700 ${Math.round(t * 0.4)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PR', t / 2, t * 0.53);
    return c.toDataURL('image/png').split(',')[1];
  }, tam);
  writeFileSync(new URL(`../app/public/icono-${tam}.png`, import.meta.url), Buffer.from(datos, 'base64'));
}
await navegador.close();
console.log('Íconos generados en app/public/');
