"""El lienzo del video largo y donde van los subtitulos.

16:9 es el de siempre: el render no cambia (ningun filtro nuevo, las mismas firmas de los trozos). Para 9:16 y
1:1 cada trozo se arma igual que en 16:9 (1920x1080, con el compositor del tipo) y al final se lleva al lienzo:

- reencuadre (camaras, una camara, podcast: el plano llena el cuadro). Se recorta una ventana del lienzo
  alrededor de la cara del plano (`centro` del compositor) y se escala. El plano doble (dos mitades lado a
  lado) se apila: una persona arriba y otra abajo. Los graficos (dibujados a 1920x1080 con alfa) se escalan al
  ancho del lienzo y van como una banda abajo; las ilustraciones a pantalla completa, al centro.
- encajar (videollamada, charla, pantalla: el escenario y las laminas no se pueden recortar). El cuadro 16:9
  entero, con sus graficos, va al centro del lienzo sobre una copia desenfocada; los subtitulos, debajo.

Subtitulos (regla del brand kit 02: una linea, mayusculas, caja negra al 85 %, letra de 6,48 % del lado corto):
la altura normal es la del formato (16:9 0,80; 9:16 0,60; 1:1 0,75). Cuando una pieza ocupa la franja inferior
(pregunta, cita, rotulo, barra, etiquetas), la tarjeta de esa frase SUBE por encima de la franja en vez de
esconderse: la persona sigue leyendo lo que se dice. En encajar no hace falta (los graficos van dentro del cuadro
y los subtitulos fuera).
"""

TAMANOS = {'9:16': (1080, 1920), '1:1': (1080, 1080)}
REENCUADRE = ('camaras', 'una_camara', 'podcast')
SUB_Y = {'16:9': 0.80, '9:16': 0.60, '1:1': 0.75}          # centro de la caja, del brand kit (plogy_subtitulos)
TAMANO_REL = 70 / 1080                                    # letra: 6,48 % del lado corto
# Lo mas alto de las piezas de la franja inferior, en el cuadro de 1920x1080 (piezas.css): el rotulo en
# .d-pantalla (nombre, rol y red) y el QR de la barra en .d-escenario.
FRANJA_TOPE = {'pantalla': 714, 'escenario': 756}
FRANJA = ('pregunta', 'cita', 'rotulo', 'barra', 'etiquetas')
HUECO = 24                                                # aire entre la caja del subtitulo y la franja


def _par(x):
    return int(round(x / 2)) * 2


class Lienzo:
    """Un lienzo que no es 16:9. W x H: el cuadro en que componen los tipos (1920x1080)."""

    def __init__(self, formato, tipo, W=1920, H=1080):
        if formato not in TAMANOS:
            raise ValueError(f'formato sin lienzo propio: {formato}')
        self.formato = formato
        self.LW, self.LH = TAMANOS[formato]
        self.W, self.H = W, H
        self.modo = 'reencuadre' if tipo in REENCUADRE else 'encajar'
        self.bh = _par(self.LW * H / W)                       # alto del cuadro 16:9 al ancho del lienzo (608)
        if self.modo == 'reencuadre':
            # la banda de graficos abajo; en 9:16 con un margen para la interfaz del telefono
            margen = _par(self.LH * 0.05) if self.LH > self.LW * 1.2 else 0
            self.banda_y = self.LH - self.bh - margen
        else:
            self.banda_y = _par((self.LH - self.bh) / 2)
        self.centro_y = _par((self.LH - self.bh) / 2)

    def firma(self, cx):
        return ['lz1', self.formato, self.modo, self.LW, self.LH, round(cx, 3)]

    # ---------------------------------------------------------- filtros
    def reencuadrar(self, base, plano, cx):
        """Filtro que lleva `base` (W x H) al lienzo. Devuelve (filtro, etiqueta)."""
        W, H, LW, LH = self.W, self.H, self.LW, self.LH
        if plano == 'TWO':
            hw = (W - 4) // 2 & ~1                            # las mitades de CompositorCamaras
            mh = LH // 2
            hh = min(H, _par(hw * mh / LW))
            y0 = _par((H - hh) * 0.3)
            return (f'{base}split[lzl][lzr];[lzl]crop={hw}:{hh}:0:{y0},scale={LW}:{mh}:flags=lanczos[lza];'
                    f'[lzr]crop={hw}:{hh}:{W - hw}:{y0},scale={LW}:{LH - mh}:flags=lanczos[lzb];'
                    f'[lza][lzb]vstack,setsar=1[lz]'), '[lz]'
        cw = min(W, _par(H * LW / LH))
        x = int(min(max(cx * W - cw / 2, 0), W - cw)) & ~1
        return f'{base}crop={cw}:{H}:{x}:0,scale={LW}:{LH}:flags=lanczos,setsar=1[lz]', '[lz]'

    def encajar(self, base):
        """El cuadro entero al centro, sobre una copia desenfocada (como los clips divididos)."""
        LW, LH, q = self.LW, self.LH, 4
        return (f'{base}split[lzf][lzc];[lzf]scale={LW // q}:{LH // q}:force_original_aspect_ratio=increase,'
                f'crop={LW // q}:{LH // q},boxblur=10:2,scale={LW}:{LH},eq=brightness=-0.18:saturation=0.8[lzd];'
                f'[lzc]scale={LW}:{self.bh}:flags=lanczos[lze];[lzd][lze]overlay=0:{self.banda_y},setsar=1[lz]'), '[lz]'

    def pieza(self, p):
        """(ancho, alto, x, y) de una pieza de 1920x1080 en el lienzo (modo reencuadre)."""
        y = self.centro_y if p.get('proteger') else self.banda_y
        return self.LW, self.bh, 0, y


def lienzo_de(ctx):
    """El Lienzo del proyecto, o None si es 16:9 (el render de siempre)."""
    if ctx.formato == '16:9':
        return None
    return Lienzo(ctx.formato, ctx.tipo, ctx.W, ctx.H)


def posiciones_subtitulos(formato, disposicion='pantalla', lz=None, W=1920, H=1080):
    """(y normal, y cuando hay una pieza en la franja inferior), en fraccion del alto del video. Funcion pura."""
    if lz is None:
        em = min(W, H) * TAMANO_REL
        tope = FRANJA_TOPE.get(disposicion, FRANJA_TOPE['pantalla']) * H / 1080
        y = SUB_Y['16:9']
        return y, round(min(y, (tope - HUECO - em) / H), 3)
    em = min(lz.LW, lz.LH) * TAMANO_REL
    if lz.modo == 'encajar':
        y = round((lz.banda_y + lz.bh + HUECO + em) / lz.LH, 3)
        return y, y
    y = SUB_Y[lz.formato]
    tope = lz.banda_y + FRANJA_TOPE['pantalla'] * lz.bh / lz.H
    return y, round(min(y, (tope - HUECO - em) / lz.LH), 3)


def tamano_letra(formato, W=1920, H=1080):
    if formato in TAMANOS:
        W, H = TAMANOS[formato]
    return round(min(W, H) * TAMANO_REL)
