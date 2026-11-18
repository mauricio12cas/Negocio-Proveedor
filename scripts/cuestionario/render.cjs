// Convierte un HTML en PDF con Chromium (Playwright).
// Uso: node render.cjs entrada.html salida.pdf
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [, , input, output] = process.argv;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(input), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: output,
    format: 'Letter',
    printBackground: true,
    outline: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="font-family:'Liberation Sans',sans-serif;font-size:7.5px;color:#9aa1ad;width:100%;padding:0 16mm;display:flex;justify-content:space-between;">
      <span>Cuestionario de descubrimiento · Proveedor de insumos para restaurantes</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '14mm', bottom: '16mm', left: '16mm', right: '16mm' },
  });
  await browser.close();
})();
