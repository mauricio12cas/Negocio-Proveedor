"""Genera versiones PDF del cuestionario pensadas para contestar a mano en iPad con Apple Pencil.

Fuente: docs/cuestionario-descubrimiento.md (textos, códigos y prioridades).
Este script agrega el formato para escribir a mano: casillas, renglones, tablas y matrices.

Uso:
    python3 scripts/cuestionario/generar.py

Salida:
    docs/cuestionario-ipad-completo.pdf   (todas las preguntas)
    docs/cuestionario-ipad-esencial.pdf   (solo las preguntas críticas)
"""

from __future__ import annotations

import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import logging

import pdfplumber

logging.getLogger("pdfminer").setLevel(logging.ERROR)

from formato import FORMATO

RAIZ = Path(__file__).resolve().parents[2]
FUENTE = RAIZ / "docs" / "cuestionario-descubrimiento.md"
RENDER = Path(__file__).with_name("render.cjs")
ESTILOS = Path(__file__).with_name("estilos.css")
FUENTES = Path(__file__).with_name("fuentes")

PRIORIDAD = {"🔴": ("r", "Crítica"), "🟡": ("a", "Importante"), "🟢": ("v", "Futuro")}


# ---------------------------------------------------------------------------
# Lectura del Markdown
# ---------------------------------------------------------------------------

def leer_cuestionario(texto: str):
    partes, anexos = [], {"entrevista": [], "documentos": [], "glosario": []}
    parte = seccion = pregunta = None
    en_anexos = anexo = None

    for linea in texto.splitlines():
        if linea.startswith("# ANEXOS"):
            en_anexos = True
            continue
        if en_anexos:
            if linea.startswith("## Anexo 1"):
                anexo = "entrevista"
            elif linea.startswith("## Anexo 2"):
                anexo = "documentos"
            elif linea.startswith("## Anexo 3"):
                anexo = "glosario"
            elif linea.startswith("### ") or linea.startswith("---"):
                anexo = None
            elif anexo == "entrevista" and (m := re.match(r"^\d+\. (.+)$", linea)):
                anexos["entrevista"].append(m.group(1))
            elif anexo == "documentos" and (m := re.match(r"^- \[ \] (.+)$", linea)):
                anexos["documentos"].append(m.group(1))
            elif anexo == "glosario" and (m := re.match(r"^\| \*\*(.+?)\*\* \| (.+) \|$", linea)):
                anexos["glosario"].append((m.group(1), m.group(2)))
            continue

        if m := re.match(r"^# (PARTE [IVX]+): (.+)$", linea):
            parte = {"num": m.group(1).title(), "titulo": m.group(2), "secciones": []}
            partes.append(parte)
        elif m := re.match(r"^## ([A-Z]+)\. (.+)$", linea):
            seccion = {"cod": m.group(1), "titulo": m.group(2), "items": []}
            parte["secciones"].append(seccion)
            pregunta = None
        elif m := re.match(r"^### [A-Z]+\.\d+ (.+)$", linea):
            seccion["items"].append({"tipo": "sub", "titulo": m.group(1)})
            pregunta = None
        elif m := re.match(r"^- \*\*([A-Z]+-\d+)\*\* (🔴|🟡|🟢) (.+)$", linea):
            pregunta = {"tipo": "q", "cod": m.group(1), "pri": m.group(2), "texto": m.group(3), "sub": []}
            seccion["items"].append(pregunta)
        elif pregunta and (m := re.match(r"^  - (?:[a-z]\) )?(.+)$", linea)):
            pregunta["sub"].append(m.group(1))
        elif seccion and not pregunta and linea.strip() and not linea.startswith(("---", "R:", "  R:")):
            seccion["items"].append({"tipo": "nota", "texto": linea.strip()})
    return partes, anexos


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

def md(texto: str) -> str:
    """Escapa HTML y convierte **negritas**."""
    t = html.escape(texto, quote=False)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)


CASILLA = '<span class="box"></span>'
CASILLA_NUM = '<span class="box num"></span>'


def renglones(n: int) -> str:
    return "".join('<div class="ln"></div>' for _ in range(n))


def opciones(lista, cols, numerar=False) -> str:
    caja = CASILLA_NUM if numerar else CASILLA
    celdas = "".join(f'<div class="opt">{caja}<span>{md(o)}</span></div>' for o in lista)
    return f'<div class="opts" style="--cols:{cols}">{celdas}</div>'


def campo(etiqueta: str) -> str:
    return f'<div class="field"><span>{md(etiqueta)}:</span><span class="fill"></span></div>'


def tabla(cfg) -> str:
    cols = cfg["cols"]
    etiquetas = cfg.get("filas")
    numerada = cfg.get("numerada", False)
    n = len(etiquetas) if etiquetas else cfg.get("n", 1)
    anchos = cfg.get("anchos")
    cab = ""
    if numerada:
        cab += '<th class="nro">#</th>'
    for i, c in enumerate(cols):
        estilo = f' style="width:{anchos[i]}"' if anchos else ""
        cab += f"<th{estilo}>{md(c)}</th>"
    cuerpo = ""
    for i in range(n):
        fila = f'<td class="nro">{i + 1}</td>' if numerada else ""
        for j in range(len(cols)):
            if etiquetas and j == 0:
                fila += f'<td class="lbl">{md(etiquetas[i])}</td>'
            else:
                fila += "<td></td>"
        cuerpo += f"<tr>{fila}</tr>"
    clase = "t larga" if n > 12 else "t"
    return f'<table class="{clase}"><thead><tr>{cab}</tr></thead><tbody>{cuerpo}</tbody></table>'


def matriz(cfg) -> str:
    cab = '<th class="lbl"></th>' + "".join(f'<th class="c">{md(c)}</th>' for c in cfg["cols"])
    cuerpo = ""
    for fila in cfg["filas"]:
        celdas = "".join(f'<td class="c">{CASILLA}</td>' for _ in cfg["cols"])
        cuerpo += f'<tr><td class="lbl">{md(fila)}</td>{celdas}</tr>'
    return f'<table class="t matriz"><thead><tr>{cab}</tr></thead><tbody>{cuerpo}</tbody></table>'


def tabla_marcar(cfg) -> str:
    cuerpo = "".join(
        f'<tr><td class="c chk">{CASILLA}</td><td class="lbl">{md(f)}</td><td></td></tr>' for f in cfg["filas"]
    )
    cab = f'<th class="c chk">Sí</th><th>{md(cfg.get("item", "Concepto"))}</th><th>{md(cfg["col"])}</th>'
    return f'<table class="t marcar"><thead><tr>{cab}</tr></thead><tbody>{cuerpo}</tbody></table>'


def pregunta_html(q, formato: dict | None = None) -> str:
    f = formato if formato is not None else FORMATO.get(q["cod"], {})
    clase, etiqueta = PRIORIDAD[q["pri"]]
    texto = f.get("t", q["texto"])
    cuerpo = []

    grupos = f.get("grupos")
    if not grupos and "op" in f:
        grupos = [(None, f["op"])]
    if not grupos and q["sub"] and not f.get("sin_sub"):
        subs = [s for s in q["sub"] if s.strip("*").rstrip(".") not in ("Otro", "Recomiéndame")]
        if f.get("marcar"):
            f = {**f, "tabla_marcar": {"filas": subs, "col": f["marcar"], "item": "Sistema"}}
        else:
            grupos = [(None, subs)]
            f = {**f, "cols": f.get("cols", 1)}

    if f.get("sn"):
        cuerpo.append(f'<div class="opts sn" style="--cols:6">'
                      f'<div class="opt">{CASILLA}<span>Sí</span></div>'
                      f'<div class="opt">{CASILLA}<span>No</span></div></div>')

    hay_respuesta_estructurada = False
    if grupos:
        hay_respuesta_estructurada = True
        orden = f.get("orden", False)
        pista = "Escribe 1, 2, 3… (1 = lo más importante)" if orden else ("Marca una" if f.get("una") else "Marca las que apliquen")
        cuerpo.append(f'<div class="pista">{pista}</div>')
        total = sum(len(g[1]) for g in grupos)
        for titulo, lista in grupos:
            if titulo:
                cuerpo.append(f'<div class="grupo">{md(titulo)}</div>')
            cols = f.get("cols") or (2 if max(len(o) for o in lista) > 26 else 3 if len(lista) > 2 else 4)
            cuerpo.append(opciones(lista, cols, numerar=orden))
        if f.get("otro", total >= 4 and not f.get("una")):
            cuerpo.append(campo("Otro"))

    for tipo, fn in (("tabla", tabla), ("matriz", matriz), ("tabla_marcar", tabla_marcar)):
        if tipo in f:
            hay_respuesta_estructurada = True
            cuerpo.append(fn(f[tipo]))

    if f.get("funcion"):
        hay_respuesta_estructurada = True
        cuerpo.append(opciones(["Indispensable en el MVP", "Después", "No lo necesito"], 3))
    if f.get("interes"):
        hay_respuesta_estructurada = True
        cuerpo.append(opciones(["Me interesa ya", "Más adelante", "No me interesa"], 3))

    if "num" in f:
        hay_respuesta_estructurada = True
        cuerpo.append('<ol class="numeradas">' + "".join("<li><span class='fill'></span></li>" for _ in range(f["num"])) + "</ol>")

    for c in f.get("campos", []):
        cuerpo.append(campo(c))

    if "lineas" in f:
        n = f["lineas"]
    elif hay_respuesta_estructurada or f.get("campos"):
        n = 1 if not f.get("campos") else 0
    elif f.get("sn"):
        n = 2
    else:
        n = {"🔴": 4, "🟡": 3, "🟢": 2}[q["pri"]]
    if n:
        cuerpo.append(f'<div class="lines">{renglones(n)}</div>')

    return f"""
<div class="q pri-{clase}">
  <div class="qhead">
    <span class="code">{q['cod']}</span><span class="pri {clase}">{etiqueta}</span>
    <span class="quick"><span>{CASILLA}No sé</span><span>{CASILLA}Recomiéndame</span><span>{CASILLA}No aplica</span></span>
  </div>
  <div class="qtext">{md(texto)}</div>
  {''.join(cuerpo)}
</div>"""


def fuentes_css() -> str:
    """Inter en formato web (contornos TrueType) para que el PDF incruste fuentes normales y no Type 3."""
    css = ""
    for archivo in sorted(FUENTES.glob("inter-latin-*.woff2")):
        _, _, peso, estilo = archivo.stem.split("-")
        css += (f"@font-face{{font-family:'InterDoc';font-weight:{peso};font-style:{estilo};"
                f"src:url('{archivo.as_uri()}') format('woff2');}}\n")
    return css


def documento(partes, anexos, esencial: bool, paginas: dict | None) -> str:
    def filtrar(seccion):
        items = seccion["items"]
        if esencial:
            items = [i for i in items if i["tipo"] == "q" and i["pri"] == "🔴"]
        return items

    # Índice
    indice = []
    for p in partes:
        filas = []
        for s in p["secciones"]:
            items = filtrar(s)
            if not items:
                continue
            nq = sum(1 for i in items if i["tipo"] == "q")
            ncrit = sum(1 for i in items if i["tipo"] == "q" and i["pri"] == "🔴")
            pag = paginas.get(s["cod"], "") if paginas else ""
            detalle = f"{nq} preguntas" if esencial else f"{nq} preguntas · {ncrit} críticas"
            filas.append(
                f'<a class="toc-row" href="#sec-{s["cod"]}"><span class="toc-cod">{s["cod"]}</span>'
                f'<span class="toc-tit">{md(s["titulo"])}</span><span class="toc-det">{detalle}</span>'
                f'<span class="toc-pag">{pag}</span></a>'
            )
        if filas:
            indice.append(f'<div class="toc-part"><div class="toc-ptit">{p["num"]} · {md(p["titulo"].capitalize())}</div>{"".join(filas)}</div>')
    pag_anexos = paginas.get("ANEXOS", "") if paginas else ""
    indice.append(f'<div class="toc-part"><a class="toc-row" href="#anexos"><span class="toc-cod">+</span>'
                  f'<span class="toc-tit">Anexos: entrevista para restaurantes, documentos a reunir, glosario y notas</span>'
                  f'<span class="toc-det"></span><span class="toc-pag">{pag_anexos}</span></a></div>')

    total = sum(1 for p in partes for s in p["secciones"] for i in filtrar(s) if i["tipo"] == "q")
    version = "Versión esencial · solo preguntas críticas" if esencial else "Versión completa"
    paso_prioridad = (
        "<strong>Esta versión solo trae las preguntas críticas.</strong> Con ellas ya se puede definir la primera "
        "versión; las demás están en la versión completa."
        if esencial else
        '<strong>Empieza por las preguntas <span class="pri r">Crítica</span></strong>. '
        "Con esas ya se puede definir la primera versión."
    )

    cuerpo = []
    for p in partes:
        secciones_html = []
        for s in p["secciones"]:
            items = filtrar(s)
            if not items:
                continue
            cabecera = (f'<div class="sec-head" id="sec-{s["cod"]}"><div class="eyebrow">SECCIÓN {s["cod"]}</div>'
                        f'<h2>{md(s["titulo"])}</h2></div>')
            bloques, pendiente = [], cabecera
            for it in items:
                if it["tipo"] == "sub":
                    pendiente += f'<h3>{md(it["titulo"])}</h3>'
                elif it["tipo"] == "nota":
                    pendiente += f'<p class="nota">{md(it["texto"])}</p>'
                else:
                    html_q = pregunta_html(it)
                    if pendiente:
                        bloques.append(f'<div class="keep">{pendiente}{html_q}</div>')
                        pendiente = ""
                    else:
                        bloques.append(html_q)
            secciones_html.append(f'<section>{"".join(bloques)}</section>')
        if secciones_html:
            cuerpo.append(f'<div class="parte"><div class="parte-head"><div class="eyebrow">{p["num"].upper()}</div>'
                          f'<h1>{md(p["titulo"].capitalize())}</h1></div>{"".join(secciones_html)}</div>')

    entrevista = "".join(
        f'<div class="q"><div class="qtext"><span class="code">{i + 1}</span> {md(t)}</div><div class="lines">{renglones(2)}</div></div>'
        for i, t in enumerate(anexos["entrevista"])
    )
    docs = "".join(f'<div class="opt doc">{CASILLA}<span>{md(d)}</span></div>' for d in anexos["documentos"])
    glosario = "".join(f"<tr><td class='lbl'><strong>{md(a)}</strong></td><td>{md(b)}</td></tr>" for a, b in anexos["glosario"])
    notas = "".join(f'<div class="hoja-notas"><h2>Notas, dudas e ideas</h2><div class="lines">{renglones(25)}</div></div>' for _ in range(2))

    estilos = fuentes_css() + ESTILOS.read_text(encoding="utf-8")
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Cuestionario de descubrimiento</title>
<style>{estilos}</style></head><body>

<div class="portada">
  <div class="eyebrow">CUESTIONARIO DE DESCUBRIMIENTO</div>
  <h1 class="titulo">Proveedor de insumos para restaurantes</h1>
  <p class="subtitulo">{version} · {total} preguntas</p>
  <div class="datos">{campo("Nombre")}{campo("Fecha")}{campo("Negocio o nombre tentativo")}</div>

  <h2>Cómo contestarlo con Apple Pencil</h2>
  <ol class="pasos">
    <li><strong>Ábrelo</strong> en GoodNotes, Notability, Notas o la app Archivos (toca el botón de marcación).</li>
    <li>{paso_prioridad}</li>
    <li><strong>No hay respuestas incorrectas.</strong> Si no sabes algo, marca una de las casillas pequeñas de la derecha: <em>No sé</em>, <em>Recomiéndame</em> o <em>No aplica</em>.</li>
    <li><strong>Si te falta espacio</strong>, usa las hojas de notas del final e indica el código de la pregunta (por ejemplo «H-2»).</li>
    <li><strong>Al terminar</strong>, exporta el PDF con tus anotaciones y súbelo al chat. Puedo leer tu letra.</li>
  </ol>

  <h2>Cómo marcar</h2>
  <div class="leyenda">
    <div><span class="box"></span><span><strong>Casilla:</strong> márcala con una palomita o una cruz. Si dice «Marca una», elige solo una.</span></div>
    <div><span class="box num"></span><span><strong>Casilla para ordenar:</strong> escribe 1, 2, 3… según la importancia.</span></div>
    <div><span class="ln-demo"></span><span><strong>Renglones:</strong> escribe con tus palabras; frases cortas están bien.</span></div>
    <div><span class="tabla-demo"></span><span><strong>Tablas:</strong> llena las filas que puedas; no tienes que llenarlas todas.</span></div>
  </div>

  <h2>Prioridad</h2>
  <div class="leyenda pri-leyenda">
    <div><span class="pri r">Crítica</span><span>Define la primera versión y la arquitectura. Contestar primero.</span></div>
    <div><span class="pri a">Importante</span><span>Afecta el diseño; se puede decidir durante el proyecto.</span></div>
    <div><span class="pri v">Futuro</span><span>Sirve para planear el crecimiento; puede esperar.</span></div>
  </div>
  <p class="tip">Usa el índice de la siguiente página para saltar a cualquier sección: cada fila es un enlace.</p>
</div>

<div class="indice"><h1 class="indice-tit">Índice</h1>{''.join(indice)}</div>

{''.join(cuerpo)}

<div class="parte" id="anexos"><div class="parte-head"><div class="eyebrow">ANEXOS</div><h1>Herramientas de apoyo</h1></div>
  <section>
    <div class="keep"><div class="sec-head"><div class="eyebrow">ANEXO 1</div><h2>Entrevista de validación para restaurantes</h2></div>
    <p class="nota">Hazle estas preguntas a 5 a 10 restaurantes antes de construir. Duplica estas páginas en tu app de notas para cada entrevista.</p>
    <div class="datos">{campo("Restaurante")}{campo("Contacto y puesto")}{campo("Fecha")}</div></div>
    {entrevista}
  </section>
  <section class="salto">
    <div class="sec-head"><div class="eyebrow">ANEXO 2</div><h2>Documentos y archivos útiles para reunir</h2></div>
    <p class="nota">Marca lo que ya tienes. Puedes subir fotos o archivos al chat cuando los juntes.</p>
    <div class="docs">{docs}</div>
  </section>
  <section>
    <div class="sec-head"><div class="eyebrow">ANEXO 3</div><h2>Glosario</h2></div>
    <table class="t glosario"><tbody>{glosario}</tbody></table>
  </section>
  {notas}
</div>
</body></html>"""


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def renderizar(html_doc: str, salida: Path):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as tmp:
        tmp.write(html_doc)
        ruta = tmp.name
    subprocess.run(["node", str(RENDER), ruta, str(salida)], check=True)
    Path(ruta).unlink()


def ubicar_secciones(pdf: Path, codigos) -> dict:
    """Busca en qué página empieza cada sección (para el índice)."""
    paginas = {}
    with pdfplumber.open(pdf) as doc:
        for n, pagina in enumerate(doc.pages, start=1):
            texto = pagina.extract_text() or ""
            for cod in codigos:
                if cod not in paginas and re.search(rf"SECCIÓN {cod}\b", texto):
                    paginas[cod] = n
            if "ANEXOS" not in paginas and re.search(r"^ANEXOS$", texto, re.M):
                paginas["ANEXOS"] = n
    return paginas


def construir(partes, anexos, esencial: bool, salida: Path):
    codigos = [s["cod"] for p in partes for s in p["secciones"]]
    renderizar(documento(partes, anexos, esencial, None), salida)
    paginas = ubicar_secciones(salida, codigos)
    renderizar(documento(partes, anexos, esencial, paginas), salida)
    with pdfplumber.open(salida) as doc:
        print(f"{salida.relative_to(RAIZ)}: {len(doc.pages)} páginas")


def main():
    partes, anexos = leer_cuestionario(FUENTE.read_text(encoding="utf-8"))
    faltan = set(FORMATO) - {i["cod"] for p in partes for s in p["secciones"] for i in s["items"] if i["tipo"] == "q"}
    if faltan:
        sys.exit(f"Códigos en formato.py que no existen en el cuestionario: {sorted(faltan)}")
    construir(partes, anexos, False, RAIZ / "docs" / "cuestionario-ipad-completo.pdf")
    construir(partes, anexos, True, RAIZ / "docs" / "cuestionario-ipad-esencial.pdf")


if __name__ == "__main__":
    main()
