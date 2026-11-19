"""Genera el cuestionario de seguimiento (ronda 2) para contestar a mano en iPad.

Contiene solo lo que quedó pendiente después de la primera ronda:
  1. Aclaraciones: respuestas que se contradicen entre sí.
  2. Supuestos: lo que se hará si no se indica otra cosa (se aprueban con una palomita).
  3. Preguntas críticas que quedaron sin contestar (con su código original).

Uso:
    python3 scripts/cuestionario/seguimiento.py

Salida:
    docs/cuestionario-ipad-seguimiento.pdf
"""

from __future__ import annotations

import pdfplumber

from generar import (ESTILOS, FUENTE, RAIZ, campo, fuentes_css, leer_cuestionario, md, pregunta_html,
                     renderizar, renglones)

SALIDA = RAIZ / "docs" / "cuestionario-ipad-seguimiento.pdf"

ACLARACIONES = [
    ("ACL-1",
     "Marcaste que trabajarás **bajo pedido** (B-1), pero también que tendrás **almacén propio**, alertas de "
     "stock mínimo y reserva de inventario (K-1, K-5, K-9). ¿Cuál describe mejor cómo vas a operar?",
     {"op": ["Bajo pedido puro: compro solo lo que ya me pidieron; casi nada se queda en bodega",
             "Mixto: tengo un stock pequeño de lo que más se vende y lo demás lo compro bajo pedido",
             "Con inventario: compro por adelantado y vendo desde mi bodega"], "una": True, "cols": 1,
      "lineas": 1}),
    ("ACL-2",
     "Si compras bajo pedido, el sistema puede sumar todos los pedidos y darte la **lista de compras del día** "
     "(por ejemplo, «12 kg de frijol, 3 cajas de aceite»). En I-4 marcaste que no la quieres. ¿Por qué?",
     {"op": ["Sí la quiero; no entendí bien la pregunta",
             "No la necesito: con pocos clientes lo calculo yo",
             "Otra razón (escríbela abajo)"], "una": True, "cols": 1, "lineas": 1}),
    ("ACL-3",
     "Marcaste que también venderás a **público en general** (B-6), pero que tú das de alta a cada cliente (D-15) "
     "y que los precios solo se ven con sesión iniciada (F-10). ¿Cómo comprará el público?",
     {"op": ["También lo doy de alta yo, igual que a los negocios",
             "Puede registrarse solo y comprar con precios de lista",
             "Al inicio solo venderé a negocios; el público, después"], "una": True, "cols": 1, "lineas": 1}),
    ("ACL-4",
     "Marcaste precios **por cliente** (F-1) y también clasificar a los clientes por **nivel A, B, C** (D-19). "
     "¿Cómo quieres manejar los precios?",
     {"op": ["Cada cliente tiene sus propios precios",
             "Una lista de precios por nivel (A, B, C)",
             "Lista por nivel y, además, precios especiales para algunos clientes"], "una": True, "cols": 1,
      "lineas": 1}),
    ("ACL-5",
     "Marcaste que **se pesa** cada producto al armar el pedido (M-4), pero que no manejas peso variable y solo "
     "vendes cantidades enteras (E-9, E-10). ¿Para qué se pesa?",
     {"op": ["Para verificar que la cantidad está bien",
             "Porque vendo a granel por kilo (frijol, arroz, etc.) y hay que pesar la cantidad exacta",
             "Otra razón (escríbela abajo)"], "una": True, "cols": 1, "lineas": 1}),
    ("ACL-6",
     "Estimaste **10 restaurantes potenciales** en tu zona inicial (C-1), pero tu meta es **25 clientes en un año** "
     "(D-2). ¿Cuál es tu zona inicial y cuántos negocios hay ahí?",
     {"campos": ["Zona inicial (colonias o alcaldía)", "Negocios potenciales en esa zona"], "lineas": 1}),
    ("ACL-7",
     "En A-4 escribiste «Soy cocinero desde h…» y se cortó. ¿Cuánto tiempo llevas y dónde has trabajado?",
     {"campos": ["Años de experiencia"], "lineas": 2}),
    ("ACL-8",
     "Marcaste que ya hablaste con restaurantes para validar la idea (C-6). ¿Qué te dijeron? ¿Alguno quiere "
     "ser tu cliente?",
     {"campos": ["¿Cuántos están interesados?"], "lineas": 4}),
]

SUPUESTOS = [
    ("SUP-1",
     "**Equipo.** Al inicio trabajas tú solo: compras, armas, repartes y cobras. El sistema tendrá dos tipos de "
     "usuario: **administrador** (tú) y **cliente**. Cuando contrates personal, agregamos más roles."),
    ("SUP-2",
     "**Plataforma.** El sistema será una **página web que funciona como app en el celular**; no hay que "
     "descargarla de la App Store. Tú la usarás desde el celular o la computadora, y tus clientes desde su celular."),
    ("SUP-3",
     "**Costos.** Como prefieres pagar más al inicio y un monto fijo al mes (AJ-3, AJ-4), elegiré servicios con "
     "plan fijo. La meta es gastar **menos de $1,500 MXN al mes** en tecnología al arrancar."),
    ("SUP-4",
     "**Reparto.** No habrá una app de reparto aparte: al entregar, abres el pedido en tu celular, el cliente "
     "**firma en la pantalla** (N-8) y el pedido queda como entregado."),
    ("SUP-5",
     "**Reclamos.** Los faltantes o productos en mal estado se reportan **al momento de la entrega** y se "
     "compensan reponiendo el producto en el siguiente pedido."),
    ("SUP-6",
     "**Catálogo.** Te daré una **plantilla de Excel** para cargar tus productos (nombre, presentación, unidad de "
     "compra, unidad de venta, costo y caducidad). Tú la llenas y yo la cargo al sistema."),
    ("SUP-7",
     "**Tablero diario.** Cada mañana verás: pedidos por entregar hoy, lo que tienes que comprar, ventas de la "
     "semana, cuánto te deben y qué clientes llevan varios días sin pedir (G-8)."),
    ("SUP-8",
     "**Integraciones.** Al inicio solo conectaremos lo indispensable: **WhatsApp** para avisos y **facturación "
     "electrónica** si la necesitas. Contabilidad y banco, más adelante."),
]

PENDIENTES = """
B-2 D-3 D-8 E-2 E-3 F-8 H-2 H-3 I-3 N-1 N-2 N-3 N-4 P-1 P-2 Q-1 Q-3 R-1 R-2 S-1 S-3 T-1 V-1 W-1 W-2
X-1 X-2 X-3 Y-1 Y-2 Y-3 Y-4 AA-1 AA-2 AJ-2 AK-1 AK-2 AK-3 AN-1
""".split()


def bloque(titulo_parte, eyebrow, intro, preguntas_html):
    return (f'<div class="parte"><div class="parte-head"><div class="eyebrow">{eyebrow}</div>'
            f'<h1>{titulo_parte}</h1></div><p class="nota">{intro}</p><section>{"".join(preguntas_html)}</section></div>')


def documento() -> tuple[str, int]:
    partes, _ = leer_cuestionario(FUENTE.read_text(encoding="utf-8"))
    pendientes = set(PENDIENTES)

    acl = [pregunta_html({"cod": c, "pri": "🔴", "texto": t, "sub": []}, f) for c, t, f in ACLARACIONES]
    sup = [pregunta_html({"cod": c, "pri": "🟡", "texto": t, "sub": []},
                         {"op": ["De acuerdo", "Prefiero otra cosa (escríbela abajo)"], "una": True, "cols": 2,
                          "lineas": 1})
           for c, t in SUPUESTOS]

    pend_html = []
    for p in partes:
        for s in p["secciones"]:
            qs = [i for i in s["items"] if i["tipo"] == "q" and i["cod"] in pendientes]
            if not qs:
                continue
            cab = f'<div class="sec-head"><div class="eyebrow">SECCIÓN {s["cod"]}</div><h2>{md(s["titulo"])}</h2></div>'
            pend_html.append(f'<div class="keep">{cab}{pregunta_html(qs[0])}</div>')
            pend_html.extend(pregunta_html(q) for q in qs[1:])
    encontrados = {i["cod"] for p in partes for s in p["secciones"] for i in s["items"] if i["tipo"] == "q"}
    faltan = pendientes - encontrados
    if faltan:
        raise SystemExit(f"Códigos pendientes que no existen: {sorted(faltan)}")

    total = len(ACLARACIONES) + len(SUPUESTOS) + len(pendientes)
    estilos = fuentes_css() + ESTILOS.read_text(encoding="utf-8")
    notas = f'<div class="hoja-notas"><h2>Notas, dudas e ideas</h2><div class="lines">{renglones(25)}</div></div>'

    html_doc = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Cuestionario de seguimiento</title>
<style>{estilos}</style></head><body>
<div class="portada">
  <div class="eyebrow">CUESTIONARIO DE SEGUIMIENTO · RONDA 2</div>
  <h1 class="titulo">Lo que falta para definir la primera versión</h1>
  <p class="subtitulo">{total} preguntas · la mayoría se contestan con una palomita</p>
  <div class="datos">{campo("Fecha")}</div>

  <h2>Qué es esto</h2>
  <p>Ya pasé a texto todas tus respuestas de la primera ronda. Con ellas ya entiendo el perfil del negocio, pero
  algunas respuestas se contradicen y faltan decisiones clave (cobro, facturación, entregas y qué debe hacer la
  primera versión). Este cuestionario corto tiene tres partes:</p>
  <ol class="pasos">
    <li><strong>Aclaraciones ({len(ACLARACIONES)}).</strong> Respuestas que se contradicen. Elige la opción que describe mejor tu idea.</li>
    <li><strong>Supuestos ({len(SUPUESTOS)}).</strong> Lo que haré si no me dices otra cosa. Solo marca <em>De acuerdo</em> o escribe tu cambio.</li>
    <li><strong>Pendientes ({len(pendientes)}).</strong> Preguntas críticas que quedaron en blanco, con su mismo código.</li>
  </ol>

  <h2>Cómo contestarlo</h2>
  <ol class="pasos">
    <li><strong>Ábrelo</strong> en GoodNotes, Notability, Notas o la app Archivos.</li>
    <li><strong>Si no sabes algo</strong>, marca <em>No sé</em> o <em>Recomiéndame</em>; eso también me sirve.</li>
    <li><strong>Al terminar</strong>, exporta el PDF con tus anotaciones y súbelo al chat.</li>
  </ol>
  <p class="tip">Lo más importante para empezar a construir: las aclaraciones ACL-1 a ACL-5 y las preguntas P-1, Q-1, R-1, W-1 y AK-1.</p>
</div>
{bloque("Aclaraciones", "PARTE 1", "Estas respuestas se contradicen entre sí. No hay una correcta: elige la que describe mejor tu idea.", acl)}
{bloque("Supuestos", "PARTE 2", "Esto es lo que haré si no me dices otra cosa. Marca «De acuerdo» o escribe el cambio.", sup)}
{bloque("Preguntas críticas pendientes", "PARTE 3", "Quedaron en blanco en la primera ronda. Conservan su código original.", pend_html)}
{notas}
</body></html>"""
    return html_doc, total


def main():
    html_doc, total = documento()
    renderizar(html_doc, SALIDA)
    with pdfplumber.open(SALIDA) as doc:
        print(f"{SALIDA.relative_to(RAIZ)}: {len(doc.pages)} páginas, {total} preguntas")


if __name__ == "__main__":
    main()
