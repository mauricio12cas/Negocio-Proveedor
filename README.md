# Negocio-Proveedor

Proyecto de proveedor de insumos para restaurantes. Por ahora está en fase de definición: todavía no hay código de la aplicación.

## Documentos

| Archivo | Para qué sirve |
|---|---|
| `docs/cuestionario-ipad-esencial.pdf` | Las 93 preguntas críticas, para contestar a mano en iPad con Apple Pencil. |
| `docs/cuestionario-ipad-completo.pdf` | Las 355 preguntas, para contestar a mano en iPad con Apple Pencil. |
| `docs/cuestionario-descubrimiento.md` | El mismo cuestionario en texto, para contestar escribiendo. Es la fuente de los PDF. |

## Regenerar los PDF

Si cambias el cuestionario en Markdown, vuelve a generar los PDF (requiere Python con `pdfplumber`, Node y Playwright con Chromium):

```bash
python3 scripts/cuestionario/generar.py
```

El formato de respuesta de cada pregunta (casillas, tablas, renglones) está en `scripts/cuestionario/formato.py`.
