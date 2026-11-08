"""Las plantillas de los graficos (long-form/plantillas), llenas con la marca del proyecto.

Es la misma logica que src/engine/long-form/plantillas.ts en Studio: lo que se ve en la vista previa de
Marca es lo que sale en el video. La prueba tests/prueba_plantillas.py compara las dos salidas.
"""
import re
from functools import lru_cache
from pathlib import Path

from . import config

ANCHO, ALTO = 1920, 1080


@lru_cache(maxsize=None)
def leer(nombre):
    return (config.PLANTILLAS / nombre).read_text(encoding='utf8')


def escapar(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&#39;'))


def _valor(datos, k):
    v = datos.get(k)
    return '' if v is None else str(v)


def rellenar(plantilla, datos):
    """`{{#x}}..{{/x}}` si x tiene valor, `{{{x}}}` tal cual, `{{x}}` escapado."""
    s = re.sub(r'\{\{#(\w+)\}\}([\s\S]*?)\{\{/\1\}\}', lambda m: m.group(2) if _valor(datos, m.group(1)) else '', plantilla)
    s = re.sub(r'\{\{\{(\w+)\}\}\}', lambda m: _valor(datos, m.group(1)), s)
    return re.sub(r'\{\{(\w+)\}\}', lambda m: escapar(_valor(datos, m.group(1))), s)


def rellenar_css(css, datos):
    def uno(m):
        k = m.group(1)
        s = _valor(datos, k)
        return s if k == 'fuentes' else re.sub(r'[<>{}]', '', s)
    return re.sub(r'\{\{(\w+)\}\}', uno, css)


def grad_css(paradas, angulo='90deg'):
    n = len(paradas) - 1
    return f'linear-gradient({angulo}, ' + ', '.join(f'{c} {round(i * 100 / max(n, 1))}%' for i, c in enumerate(paradas)) + ')'


def fuentes_css(m):
    """El @font-face de la fuente de la marca, desde su archivo (Chromium abre la pagina desde disco)."""
    rel = m.cfg['fuente'].get('woff2') or m.cfg['fuente'].get('ttf')
    if not rel:
        return ''
    ext = rel.rsplit('.', 1)[-1].lower()
    fmt = {'woff2': 'woff2', 'woff': 'woff', 'ttf': 'truetype', 'otf': 'opentype'}.get(ext, 'truetype')
    familia = m.familia.replace("'", '').replace('"', '').replace('\\', '')
    return f"@font-face{{font-family:'{familia}';src:url({m.url(rel)}) format('{fmt}');font-weight:700}}"


def variables(m, fondo='transparent'):
    c = m.c
    grad = m.degradado if len(m.degradado) >= 2 else [c['acento'], c['acento_texto']]
    return {
        'fuentes': fuentes_css(m), 'ancho': ANCHO, 'alto': ALTO, 'fondo': fondo,
        'familia': m.familia.replace("'", '').replace('"', '').replace('\\', ''),
        'tinta': c['tinta'], 'papel': c.get('papel', '#ffffff'), 'acento': c['acento'], 'acento_texto': c['acento_texto'],
        'apagado': c['apagado'], 'kick': c.get('kick', '#c9bfb6'), 'borde': c.get('borde', '#a39486'),
        'caja_alfa': m.cfg.get('caja_alfa', 0.85), 'degradado_h': grad_css(grad), 'degradado_v': grad_css(grad, '180deg'),
        'cuerpo': m.cuerpo,
    }


def _num(v):
    """Los numeros como los escribe JavaScript (6 y no 6.0), para que las dos salidas coincidan."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def datos_de(m, tipo, p):
    e = m.esfera_svg
    if tipo == 'pregunta':
        return {'etiqueta': m.texto('pregunta', 'Pregunta'), 'num': p.get('num', ''), 'encabezado': p.get('encabezado'), 'texto': p.get('texto')}
    if tipo == 'cita':
        return {'texto': p.get('texto'), 'quien': p.get('quien'), 'rol': p.get('rol', '')}
    if tipo == 'rotulo':
        return {'esfera': e, 'nombre': p.get('nombre'), 'rol': p.get('rol', ''), 'handle': p.get('handle', ''), 'red': p.get('red') or 'Instagram'}
    if tipo == 'barra':
        claves = m.ctas
        clave = p.get('cta') if p.get('cta') in claves else (claves[0] if claves else None)
        if not clave:
            return {'esfera': e, 'kick': '', 'head': '', 'sub': '', 'cta': '', 'qr': None, 'cap': ''}
        c = m.cfg['ctas'][clave]
        return {'esfera': e, 'kick': c.get('kick', ''), 'head': c.get('head', ''), 'sub': c.get('sub', ''), 'cta': c.get('cta', ''),
                'qr': m.url(c['qr']) if c.get('qr') else None, 'cap': c.get('cap', '')}
    if tipo == 'popup':
        return {'esfera': e, 'texto': m.texto('popup', 'Síguenos'), 'handle': m.cfg.get('handle', '')}
    if tipo == 'etiquetas':
        return {'izquierda': p.get('izquierda'), 'derecha': p.get('derecha')}
    if tipo == 'foto':
        x, y, w, h = p['caja']
        return {'x': x, 'y': y, 'w': w, 'h': h, 'src': p['src'], 'wmax': w - 24, 'hmax': h - 24}
    if tipo == 'tarjeta-intro':
        t = p.get('titulo') or ''
        return {'logo': logo_html(m), 'titulo': t, 'tam': 170 if len(t) <= 16 else 130 if len(t) <= 28 else 104,
                'subtitulo': p.get('subtitulo'), 'pie': p.get('pie') if p.get('pie') is not None else m.texto('pie_intro', '')}
    if tipo == 'tarjeta-cierre':
        chips = ''.join(f'<span class="chip">{escapar(r)} <em>{escapar(h)}</em></span>' for r, h in m.redes)
        return {'logo': logo_html(m), 'titulo': m.texto('cierre_titulo', 'Síguenos'), 'handle': m.cfg.get('handle', ''),
                'chips': chips, 'web': m.cfg.get('web', '')}
    raise ValueError(tipo)


def logo_html(m):
    rel = (m.cfg.get('logos') or {}).get('sobre_acento')
    return f'<img class="logo" src="{escapar(m.url(rel))}" alt="">' if rel else ''


def css_de(m, tipo):
    tarjeta = tipo.startswith('tarjeta')
    v = variables(m, m.c['acento'] if tarjeta else 'transparent')
    return rellenar_css(leer('base.css'), v) + rellenar_css(leer('tarjetas.css' if tarjeta else 'piezas.css'), v)


def cuerpo(m, tipo, p):
    return rellenar(leer(f'{tipo}.html'), {k: _num(v) for k, v in datos_de(m, tipo, p).items()})


def pagina(m, tipo, p, disposicion='pantalla'):
    return (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><style>{css_de(m, tipo)}</style></head>'
            f'<body class="d-{disposicion}">{cuerpo(m, tipo, p)}</body></html>')
