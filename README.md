# Negocio-Proveedor

Proyecto de proveedor de insumos para restaurantes.

- **Sistema de pedidos (versión 1):** en `app/` y `supabase/`. Instrucciones abajo.
- **Definición del negocio:** cuestionarios y respuestas en `docs/`.

## Sistema de pedidos

Hecho con **React + [Ant Design](https://ant.design)** (compilado con Vite) y Supabase. Tres pantallas:

- **`app/index.html`: pantalla del cliente.** Cada cliente recibe su propio link (`index.html?c=<código>`). Elige la fecha de entrega, las cantidades por producto (y por sucursal, si tiene) y envía. Puede ver sus pedidos recientes y su estado.
- **`app/admin.html`: tu panel.** Tablero con ventas y alertas, pedidos con su estado (recibido, confirmado, en ruta, entregado, cancelado), lista de lo que hay que comprar por día, clientes con sus productos, precios y sucursales, catálogo (con importación desde Excel) y ajustes (negocio, logo y color, datos de remisión, reglas).
- **`app/remision.html`: remisión imprimible / PDF**, por pedido o de todos los pedidos de un día.

El código está en `app/src/` (`cliente/`, `panel/`, `remision/` y lo compartido en `comun.js` y `Tema.jsx`).

Reglas: un pedido por cliente por día; no se puede pedir para el mismo día; con hora de corte, los pedidos tardíos pasan a un día después; solo cantidades enteras.

### Puesta en marcha

> **Estado actual:** el proyecto de Supabase **«pedidos-proveedor»** ya está creado, con la base de datos instalada, y `app/public/config.js` ya apunta a él. Tu usuario ya es administrador. Solo falta publicar (paso 6) y empezar a cargar datos (paso 7).

1. **Crea un proyecto en [Supabase](https://supabase.com)** (plan gratuito).
2. En **SQL Editor**, pega y ejecuta el contenido de `supabase/migrations/20261119000000_esquema_inicial.sql`.
3. En **Authentication → Users → Add user**, crea tu usuario con correo y contraseña. Luego, en **Authentication → Sign In / Providers**, desactiva *Allow new users to sign up* para que nadie más pueda registrarse.
4. Dale permiso de administrador. En **SQL Editor** ejecuta, con el ID de tu usuario (aparece en la lista de usuarios, o el panel te muestra el comando exacto si intentas entrar sin permiso):
   ```sql
   insert into administradores (user_id) values ('ID-DE-TU-USUARIO');
   ```
5. En **Project Settings → API**, copia la *Project URL* y la *anon public key* a `app/public/config.js`.
6. Publica la app. El repositorio la compila (`app/dist`) y la publica solo con GitHub Pages (`.github/workflows/publicar-app.yml`) cada vez que hay cambios en `main`: activa una vez **Settings → Pages → Source: GitHub Actions**. El panel queda en `https://mauricio12cas.github.io/Negocio-Proveedor/admin.html`.
7. Entra a `admin.html`: agrega productos en **Catálogo**, crea tus **Clientes**, marca qué productos puede pedir cada uno y envíales su link.

Para trabajar en tu computadora: `cd app && npm install && npm run dev` y abre la dirección que te muestra.

### Seguridad

- Los clientes no tienen acceso directo a ninguna tabla: solo pueden usar tres funciones con el código de su link. Si un link se comparte por error, genera uno nuevo desde el panel (botón *Generar link nuevo*).
- El panel exige iniciar sesión y que tu usuario esté en la tabla `administradores`.
- La *anon key* de `config.js` es pública por diseño; no pongas ahí la *service_role key*.

### Pruebas

```bash
cd pruebas && npm install && npm test
```

Prueban la base de datos (permisos, reglas de pedido) en un Postgres local; luego compilan la app y prueban las pantallas en Chromium.

## Documentos

| Archivo | Para qué sirve |
|---|---|
| `docs/cuestionario-ipad-esencial.pdf` | Las 93 preguntas críticas, para contestar a mano en iPad con Apple Pencil. |
| `docs/cuestionario-ipad-completo.pdf` | Las 355 preguntas, para contestar a mano en iPad con Apple Pencil. |
| `docs/cuestionario-descubrimiento.md` | El mismo cuestionario en texto, para contestar escribiendo. Es la fuente de los PDF. |
| `docs/respuestas-ronda-1.md` | Respuestas de la primera ronda transcritas, resumen del negocio y pendientes. |
| `docs/cuestionario-ipad-seguimiento.pdf` | Ronda 2: aclaraciones, supuestos y preguntas críticas pendientes (55 preguntas). |

## Regenerar los PDF del cuestionario

Si cambias el cuestionario en Markdown, vuelve a generar los PDF (requiere Python con `pdfplumber`, Node y Playwright con Chromium):

```bash
python3 scripts/cuestionario/generar.py
```

El cuestionario de seguimiento se genera aparte:

```bash
python3 scripts/cuestionario/seguimiento.py
```

El formato de respuesta de cada pregunta (casillas, tablas, renglones) está en `scripts/cuestionario/formato.py`.
