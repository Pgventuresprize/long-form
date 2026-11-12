"""Lo que cada etapa recibe: el proyecto, su estado, sus carpetas, la marca y como avisar avances."""
import json
import time
from pathlib import Path

import numpy as np

from .marca import Marca

# Las decisiones del video que Studio deja en spec.opciones (subtitulos, gancho...) y el nombre con que el
# referente sugiere cada una en sus parametros (etapas/referente.traducir). Nombres distintos a proposito: en
# ctx.opcion el referente manda, pero aqui manda la persona.
SUGERENCIAS = {'subtitulos': 'sugerido_subtitulos', 'gancho': 'sugerido_gancho', 'broll_cada_min': 'broll_cada_min'}
FORMATOS = ('16:9', '9:16', '1:1')


def elegir(opciones, parametros, clave, defecto):
    """Lo que eligio la persona (spec.opciones) > lo que sugiere el referente > el valor por defecto.

    Una opcion ausente o en null es "automatico": decide el referente si dice algo, si no el defecto."""
    v = (opciones or {}).get(clave)
    if v is not None:
        return v
    sug = SUGERENCIAS.get(clave)
    if sug and sug in (parametros or {}) and parametros[sug] is not None:
        return parametros[sug]
    return defecto


def desfase(graficos):
    """Segundos del video final antes del programa: el gancho (si hay) y la intro (la que fijo extremos.py en
    estado.graficos: la tarjeta, el video de la marca, o 0 sin intro)."""
    return float(graficos.get('gancho_s') or 0) + graficos['intro_s']


class Contexto:
    def __init__(self, almacen, pid, etapa=''):
        self.alm = almacen
        self.pid = pid
        self.etapa = etapa
        self.spec = almacen.proyecto(pid)
        self.estado = almacen.estado(pid)
        self.dir = almacen.carpeta(pid)
        self.entrada = self.dir / 'entrada'
        self.trabajo = self.dir / 'trabajo'
        self.salida = self.dir / 'salida'
        self.marca = Marca(almacen.marca(self.spec.get('marca')))
        sal = self.spec.get('salida') or {}
        self.W = int(sal.get('ancho', 1920))
        self.H = int(sal.get('alto', 1080))
        self.FPS = int(sal.get('fps', 30))
        self._t0 = time.time()
        self.costo = {}                 # lo que gasta la etapa: minutos de audio, tokens... (el tiempo lo pone el pipeline)
        self.reconstruyendo = False     # rehaciendo una etapa ya hecha en otro worker: sin IA, sin pisar lo aprobado

    # ---- opciones con valor por defecto
    @property
    def referente(self):
        """Los parametros que dejo la etapa referente (etapas/referente.py), o {} si el proyecto no tiene."""
        return (self.estado.get('referente') or {}).get('parametros') or {}

    def opcion(self, clave, defecto):
        """Lo que pide el referente manda sobre el estilo de la marca: la persona lo eligio para este video."""
        ref = self.referente
        if clave in ref:
            return ref[clave]
        return (self.spec.get('opciones') or {}).get(clave, defecto)

    def regla(self, clave, defecto):
        """Como marca.regla, pero con lo que pide el referente encima (cadencia de barras y pop-ups)."""
        ref = self.referente
        return ref[clave] if clave in ref else self.marca.regla(clave, defecto)

    def eleccion(self, clave, defecto):
        """Para formato, duracion_objetivo_min, subtitulos, gancho, capitulos y broll_cada_min: aqui manda lo
        que la persona eligio en Studio; el referente solo sugiere cuando la opcion queda en automatico."""
        return elegir(self.spec.get('opciones'), self.referente, clave, defecto)

    @property
    def formato(self):
        """El lienzo del video largo: '16:9' (siempre igual que antes), '9:16' o '1:1'."""
        f = str(self.eleccion('formato', '16:9'))
        return f if f in FORMATOS else '16:9'

    @property
    def tipo(self):
        """El que eligio la persona al corregir la clasificacion, si no el que decidio `clasificar`, si no el
        del proyecto (pruebas locales). Ver tipos.py."""
        return (self.spec.get('tipo_forzado') or (self.estado.get('clasificacion') or {}).get('tipo')
                or self.spec.get('tipo'))

    @property
    def esfuerzo(self):
        return self.spec.get('esfuerzo') or 'normal'   # 'rapido' | 'normal' | 'detallado'

    # ---- estado
    def guardar(self, clave, valor):
        self.estado[clave] = valor
        if self.reconstruyendo and clave in ('reparto', 'guion', 'clips', 'render', 'qa', 'graficos', 'keep', 'tomas_render',
                                             'clasificacion', 'tomas'):
            return      # la reconstruccion solo rehace archivos de trabajo; el estado ya existe
        self.alm.guardar(self.pid, clave, valor)

    def necesita(self, *claves):
        faltan = [c for c in claves if c not in self.estado]
        if faltan:
            raise RuntimeError(f'La etapa {self.etapa} necesita {", ".join(faltan)} y no esta en el estado del proyecto')
        return [self.estado[c] for c in claves]

    def aprobado(self, clave):
        """El JSON aprobado por la persona; si no hay, la propuesta (solo en pruebas locales)."""
        return self.estado.get(f'{clave}_aprobado') or self.estado.get(clave)

    # ---- avisos
    def log(self, msg, nivel='info'):
        self.alm.log(self.pid, msg, nivel, self.etapa)

    def limpiar_avisos(self):
        """Cada vez que una etapa corre de nuevo, sus avisos anteriores dejan de valer."""
        av = self.estado.get('avisos')
        if isinstance(av, dict) and av.get(self.etapa):
            av[self.etapa] = []
            self.guardar('avisos', av)

    def todos_los_avisos(self):
        av = self.estado.get('avisos')
        if isinstance(av, dict):
            return [m for lista in av.values() for m in lista]
        return list(av or [])

    def avance(self, detalle, progreso=None):
        """El progreso es informativo: si la base tarda o se cae un momento, la etapa sigue. El siguiente
        avance (o el final de la etapa) vuelve a dejar el estado al dia."""
        try:
            self.alm.fase(self.pid, self.etapa, detalle, progreso)
        except Exception as e:
            print(f'[{self.pid}] no se pudo reportar el avance ({type(e).__name__}); la etapa sigue', flush=True)

    def aviso(self, msg):
        """Algo que la persona debe revisar antes de publicar: queda en el reporte final."""
        av = self.estado.get('avisos')
        av = av if isinstance(av, dict) else {}
        lista = av.setdefault(self.etapa, [])
        if msg not in lista:
            lista.append(msg)
            self.guardar('avisos', av)
        self.log(msg, 'aviso')

    # ---- archivos de entrada
    def archivos(self, tipo):
        """Archivos subidos de un tipo: fuente, pdf, ilustracion, foto, musica."""
        return [a for a in self.spec.get('archivos', []) if a.get('tipo') == tipo]

    def local(self, archivo):
        """Trae un archivo subido a la carpeta de entrada (si no esta ya) y devuelve su ruta."""
        nombre = archivo.get('nombre_local') or Path(archivo['ruta']).name
        return self.alm.traer(self.pid, archivo['ruta'], self.entrada / nombre)

    def tj(self, nombre):
        return self.trabajo / nombre

    def json_trabajo(self, nombre, valor=None):
        p = self.tj(nombre)
        if valor is None:
            return json.loads(p.read_text(encoding='utf8'))
        p.write_text(json.dumps(valor, ensure_ascii=False), encoding='utf8')
        return valor


class Mapa:
    """Traduce tiempo de la fuente a tiempo de salida (cuadros) segun los tramos que se conservan.

    keep: [(a, b), ...] en segundos de la linea de tiempo maestra, ya redondeados a cuadros.
    """

    def __init__(self, keep, fps=30, intro=0.0):
        self.keep = [tuple(k) for k in keep]
        self.fps = fps
        self.intro = intro
        self.ini = np.array([k[0] for k in self.keep])
        fin = np.array([k[1] for k in self.keep])
        self.acc = np.concatenate([[0], np.cumsum(np.round((fin - self.ini) * fps))]).astype(np.int64)

    @property
    def total(self):
        return int(self.acc[-1])

    def cuadro(self, t):
        i = int(np.searchsorted(self.ini, t, side='right')) - 1
        if i < 0:
            return 0
        return int(self.acc[i] + min(round((t - self.ini[i]) * self.fps), self.acc[i + 1] - self.acc[i]))

    def salida(self, t):
        """segundos en el video final (incluye la intro)"""
        return self.intro + self.cuadro(t) / self.fps

    def fuente(self, cuadro):
        i = int(np.searchsorted(self.acc, cuadro, side='right')) - 1
        i = min(max(i, 0), len(self.keep) - 1)
        return float(self.ini[i] + (cuadro - self.acc[i]) / self.fps)
