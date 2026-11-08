"""Preset de marca: colores, fuente, logos, QR, CTAs, musica y efectos.

Un preset es una carpeta con marca.json y sus archivos. El de Plogy es el brand kit 02.
Todo lo grafico (tarjetas, escenario, clips) lee de aqui: otra marca = otra carpeta, cero codigo.
"""
import json
from functools import cached_property
from pathlib import Path


class Marca:
    def __init__(self, carpeta):
        self.dir = Path(carpeta)
        self.cfg = json.loads((self.dir / 'marca.json').read_text(encoding='utf-8-sig'))
        self.c = self.cfg['colores']
        self.slug = self.cfg.get('slug', self.dir.name)

    def ruta(self, rel):
        return self.dir / rel if rel else None

    def url(self, rel):
        return self.ruta(rel).resolve().as_uri()

    # ---- tipografia
    @property
    def fuente_ttf(self):
        return str(self.ruta(self.cfg['fuente']['ttf']))

    @property
    def familia(self):
        return self.cfg['fuente']['familia']

    @property
    def cuerpo(self):
        return self.cfg['fuente'].get('cuerpo', 'Helvetica, Arial, sans-serif')

    # ---- color
    @property
    def degradado(self):
        return self.c['degradado']

    def grad_css(self, ang='90deg'):
        st = self.degradado
        n = len(st) - 1
        partes = ', '.join(f'{c} {round(i * 100 / n)}%' for i, c in enumerate(st))
        return f'linear-gradient({ang}, {partes})'

    @staticmethod
    def rgb(hexa):
        h = hexa.lstrip('#')
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    @cached_property
    def esfera_svg(self):
        st = self.degradado
        n = len(st) - 1
        stops = ''.join(f'<stop offset="{i / n:.2f}" stop-color="{c}"/>' for i, c in enumerate(st))
        return (f'<svg class="sphere" viewBox="27 27 27 27"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">{stops}'
                f'</linearGradient></defs><circle cx="40.5" cy="40.5" r="13.5" fill="url(#g)"/></svg>')

    def logo_svg(self, clave='sobre_acento'):
        p = self.ruta(self.cfg['logos'][clave])
        return p.read_text(encoding='utf8').replace('<svg ', '<svg class="logo" ', 1)

    @property
    def logo_blanco_png(self):
        return str(self.ruta(self.cfg['logos']['sobre_oscuro_png']))

    # ---- CTAs, musica y efectos
    def cta(self, clave):
        c = dict(self.cfg['ctas'][clave])
        c['qr_path'] = str(self.ruta(c['qr']))
        return c

    @property
    def ctas(self):
        return list(self.cfg.get('ctas', {}).keys())

    def sfx(self, nombre):
        rel = self.cfg.get('sfx', {}).get(nombre)
        p = self.ruta(rel) if rel else None
        return str(p) if p and p.exists() else None

    def musica(self, clave):
        rel = self.cfg.get('musica', {}).get(clave)
        p = self.ruta(rel) if rel else None
        return str(p) if p and p.exists() else None

    def texto(self, clave, defecto=''):
        return self.cfg.get('textos', {}).get(clave, defecto)

    def regla(self, clave, defecto):
        return self.cfg.get('reglas', {}).get(clave, defecto)

    @property
    def redes(self):
        return self.cfg.get('redes', [])

    def css_base(self, ancho, alto, fondo='transparent'):
        c = self.c
        return f"""
@font-face{{font-family:'{self.familia}';src:url({self.url(self.cfg['fuente']['woff2'])}) format('woff2');font-weight:700}}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{width:{ancho}px;height:{alto}px;overflow:hidden;background:{fondo}}}
body{{font-family:'{self.familia}',Arial,sans-serif;font-weight:700;color:#fff;position:relative}}
.grad{{background:{self.grad_css()}}}
.sphere{{display:block}}
:root{{--tinta:{c['tinta']};--acento:{c['acento']};--acento-texto:{c['acento_texto']};--apagado:{c['apagado']};
      --kick:{c.get('kick', '#c9bfb6')};--borde:{c['borde']};--caja:rgba(0,0,0,{self.cfg.get('caja_alfa', .85)})}}
"""
