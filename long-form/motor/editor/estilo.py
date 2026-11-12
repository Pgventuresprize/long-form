"""Del estilo long form de Studio (lf_estilos.config) a la carpeta de marca que leen las etapas.

Studio guarda el estilo como JSON (src/engine/long-form/estilo.ts) y sus archivos en Storage. El motor
trabaja con una carpeta con marca.json y sus archivos, como los presets de antes. Aqui se arma esa carpeta
una vez por version del estilo: colores, fuente, logos, CTA con su QR, textos, musica y efectos.
"""
import json
import re
import shutil
from pathlib import Path

from . import config

FUENTES_STUDIO = {
    'Plogy Display': ('PlogyDisplay-Bold.woff2', 'PlogyDisplay-Bold.ttf'),
    'HeroFont': ('HeroFont-Bold.otf', 'HeroFont-Bold.otf'),
    'Space Grotesk': ('SpaceGrotesk-700.ttf', 'SpaceGrotesk-700.ttf'),
}

# Los momentos del estilo y el nombre del efecto en las etapas (src/engine/long-form/estilo.ts, SFX_MOTOR).
SFX_MOTOR = {'rotulo': 'rotulo-entra', 'barra': 'barra-entra', 'barra_sale': 'barra-sale', 'popup': 'popup-entra',
             'cita': 'cita-entra', 'pregunta': 'pregunta-entra', 'pregunta_sale': 'pregunta-sale', 'transicion': 'transicion'}

GRAFICOS = {'pocos': (12, 15, 1), 'normal': (7, 9, 2), 'muchos': (5, 6, 3)}


def _esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def marcado(texto, etiqueta):
    """`*resaltado*` a HTML, igual que `marcado` en estilo.ts."""
    return re.sub(r'\*([^*]+)\*', rf'<{etiqueta}>\1</{etiqueta}>', _esc(texto or ''))


def armar(cfg, bajar, destino, biblioteca):
    """cfg: el estilo normalizado. bajar(bucket, ruta, destino) trae un archivo. biblioteca: id -> fila de
    lf_biblioteca. Devuelve la carpeta lista para Marca(...)."""
    d = Path(destino)
    if d.exists():
        shutil.rmtree(d)
    (d / 'fonts').mkdir(parents=True)
    (d / 'logos').mkdir()
    (d / 'qr').mkdir()
    (d / 'audio').mkdir()

    def traer(archivo, carpeta):
        if not archivo:
            return None
        nombre = Path(archivo['ruta']).name
        bajar(archivo['bucket'], archivo['ruta'], d / carpeta / nombre)
        return f'{carpeta}/{nombre}'

    # Fuente: las de Studio vienen con el motor; las del kit o subidas se bajan.
    f = cfg.get('fuente') or {}
    if f.get('origen') == 'studio':
        familia = f.get('nombre', 'HeroFont')
        web, ttf = FUENTES_STUDIO.get(familia, FUENTES_STUDIO['HeroFont'])
        for n in {web, ttf}:
            shutil.copy2(config.FUENTES_STUDIO / n, d / 'fonts' / n)
        fuente = {'familia': familia, 'woff2': f'fonts/{web}', 'ttf': f'fonts/{ttf}'}
    else:
        familia = f.get('familia', 'Marca')
        rel = traer(f.get('archivo'), 'fonts')
        fuente = {'familia': familia, 'woff2': rel, 'ttf': rel}
    fuente['cuerpo'] = cfg.get('cuerpo') or "'Helvetica Neue', Helvetica, Arial, sans-serif"
    # Plogy Display tiene sus contornos para los subtitulos de los clips.
    if familia == 'Plogy Display':
        shutil.copytree(config.SUBTITULOS, d / 'subtitulos')

    logo = cfg.get('logo') or {}
    sobre_acento = traer(logo.get('sobre_acento'), 'logos')
    sobre_oscuro = traer(logo.get('sobre_oscuro'), 'logos')
    if not (sobre_oscuro and sobre_oscuro.lower().endswith('.png')):
        # Los clips ponen el logo como PNG. Sin uno, va una imagen vacia: el clip sale sin logo.
        from PIL import Image
        Image.new('RGBA', (8, 8), (0, 0, 0, 0)).save(d / 'logos' / 'vacio.png')
        sobre_oscuro = 'logos/vacio.png'

    ctas = {}
    for c in cfg.get('ctas') or []:
        ctas[c['clave']] = {'qr': traer(c.get('qr'), 'qr'), 'kick': c.get('kick', ''), 'head': marcado(c.get('titular', ''), 'span'),
                            'sub': marcado(c.get('apoyo', ''), 'b'), 'cta': c.get('boton', ''), 'cap': c.get('pie', '')}

    def audio(aid):
        if aid and aid.startswith('studio:'):
            # Biblioteca de Studio: sonidos genericos que vienen con el motor (plantillas/sfx/generar.py).
            origen = config.SFX_STUDIO / f'{aid[len("studio:"):]}.wav'
            if not origen.exists():
                return None
            shutil.copy2(origen, d / 'audio' / origen.name)
            return f'audio/{origen.name}'
        fila = biblioteca.get(aid) if aid else None
        if not fila:
            return None
        nombre = Path(fila['ruta']).name
        bajar(config.BUCKET, fila['ruta'], d / 'audio' / nombre)
        return f'audio/{nombre}'

    musica = cfg.get('musica') or {}
    sfx = cfg.get('sfx') or {}
    barra, popup, por_cta = GRAFICOS.get(cfg.get('graficos', 'normal'), GRAFICOS['normal'])
    textos = dict(cfg.get('textos') or {})

    marca = {
        'slug': 'estilo',
        'nombre': textos.get('pie_intro') or 'Marca',
        'colores': cfg['colores'] | {'degradado': cfg['colores'].get('degradado') or [cfg['colores']['acento'], cfg['colores']['acento_texto']]},
        'fuente': fuente,
        'logos': {'sobre_acento': sobre_acento, 'sobre_oscuro_png': sobre_oscuro, 'simbolo': None},
        'caja_alfa': cfg.get('caja_alfa', 0.85),
        'redes': cfg.get('redes') or [],
        'handle': cfg.get('handle', ''),
        'web': cfg.get('web', ''),
        'ctas': ctas,
        'musica': {'intro': audio(musica.get('intro')), 'fondo': audio(musica.get('fondo')), 'cierre': audio(musica.get('cierre')),
                   'volumen': musica.get('volumen', 0.8), 'volumen_fondo': musica.get('volumen_fondo', 0.35),
                   'loudness_lufs': musica.get('loudness_lufs', -17)},
        # Un efecto que ya no existe (borrado de la biblioteca, slug viejo) se omite: ese momento queda sin sonido.
        'sfx': {SFX_MOTOR[k]: r for k, v in sfx.items() if k in SFX_MOTOR and v and (r := audio(v))},
        'volumen_efectos': sfx.get('volumen', 0.7),
        'textos': textos,
        'reglas': {'barras_por_cta_min': por_cta, 'barra_cada_min': barra, 'popup_cada_min': popup,
                   'cita_seg_min': 6.5, 'cita_seg_max': 8.5, 'cita_max_caracteres': 66},
        'subtitulos': cfg.get('subtitulos') or {},
        'personas': cfg.get('personas') or [],
    }
    (d / 'marca.json').write_text(json.dumps(marca, ensure_ascii=False, indent=1), encoding='utf8')
    return d
