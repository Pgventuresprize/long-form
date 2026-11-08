"""Lo que dibuja el motor es lo que muestra la vista previa de Studio.

Arma la marca del motor a partir de un estilo de Studio y compara, pieza por pieza, el HTML de Python
(editor/plantillas.py) con el de TypeScript (src/engine/long-form/plantillas.ts). Solo cambian las rutas de
los archivos (file:// en el motor, URL firmada en Studio) y el @font-face; eso se normaliza antes de comparar.

    python tests/prueba_plantillas.py        (desde long-form/motor, con node y npx en el PATH)
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
MOTOR = AQUI.parent
REPO = MOTOR.parent.parent
sys.path.insert(0, str(MOTOR))

from editor import estilo, plantillas  # noqa: E402
from editor.marca import Marca  # noqa: E402

ESTILO = {
    'colores': {'tinta': '#171310', 'papel': '#ffffff', 'apagado': '#625951', 'acento': '#ff5b00', 'acento_texto': '#b43d00',
                'borde': '#a39486', 'fondo_escenario': '#100d0c', 'kick': '#c9bfb6',
                'degradado': ['#f75946', '#ee5358', '#e1556a', '#c85981', '#9c5aa7']},
    'fuente': {'origen': 'studio', 'nombre': 'Plogy Display'},
    'handle': '@plogy.xyz', 'web': 'plogy.xyz', 'redes': [['Instagram', '@plogy.xyz'], ['YouTube', 'Plogy & Co']],
    'textos': {'pie_intro': 'Comunidad Plogy', 'cierre_titulo': 'Síguenos', 'pregunta': 'Pregunta', 'popup': 'Síguenos',
               'en_esta_sesion': 'En esta sesión'},
    'ctas': [{'clave': 'comunidad', 'kick': 'Plogy Academy', 'titular': 'Únete a la *comunidad*',
              'apoyo': '*Haz parte de los Ploggers.* Aprende <con> IA.', 'boton': 'Escanea y únete', 'pie': 'Grupo de WhatsApp',
              'url': '', 'qr': None}],
}
CASOS = [
    {'tipo': 'rotulo', 'disposicion': 'pantalla', 'datos': {'nombre': 'César Martínez', 'rol': 'Fundador', 'handle': '@cesar', 'red': 'Instagram'}},
    {'tipo': 'rotulo', 'disposicion': 'escenario', 'datos': {'nombre': 'Ana <B>', 'rol': '', 'handle': '', 'red': 'Instagram'}},
    {'tipo': 'cita', 'disposicion': 'pantalla', 'datos': {'texto': '"La IA no reemplaza" a nadie & todo', 'quien': 'César', 'rol': 'Inter'}},
    {'tipo': 'pregunta', 'disposicion': 'escenario', 'datos': {'num': '03', 'encabezado': 'En esta sesión', 'texto': "¿Qué es 'ser AI native'?"}},
    {'tipo': 'barra', 'disposicion': 'pantalla', 'datos': {'cta': 'comunidad'}},
    {'tipo': 'popup', 'disposicion': 'pantalla', 'datos': {}},
    {'tipo': 'etiquetas', 'disposicion': 'pantalla', 'datos': {'izquierda': 'César', 'derecha': 'Juanfra'}},
    {'tipo': 'tarjeta-intro', 'disposicion': 'pantalla', 'datos': {'titulo': 'IA en deportes', 'subtitulo': 'Con César'}},
    {'tipo': 'tarjeta-cierre', 'disposicion': 'pantalla', 'datos': {}},
]


def normalizar(html):
    html = re.sub(r'@font-face\{[^}]*\}', '', html)
    return re.sub(r'(file:///[^"\')]*/|archivo:[^"\')]*/)', 'ARCHIVO/', html)


def main():
    tmp = Path(tempfile.mkdtemp())
    try:
        e = tmp / 'estilo.json'
        e.write_text(json.dumps(ESTILO, ensure_ascii=False), encoding='utf8')
        d = tmp / 'casos.json'
        d.write_text(json.dumps(CASOS, ensure_ascii=False), encoding='utf8')
        npx = shutil.which('npx') or shutil.which('npx.cmd')
        r = subprocess.run([npx, 'tsx', str(REPO / 'scripts' / 'longform-plantillas-salida.ts'), str(e), str(d)],
                           cwd=REPO, capture_output=True, text=True, encoding='utf8')
        if r.returncode:
            raise SystemExit(f'TypeScript fallo: {r.stderr[-800:]}')
        ts = json.loads(r.stdout)
        carpeta = estilo.armar(json.loads(json.dumps(ESTILO)), lambda *a: None, tmp / 'marca', {})
        m = Marca(carpeta)
        fallos = 0
        for caso, html_ts in zip(CASOS, ts):
            html_py = plantillas.pagina(m, caso['tipo'], caso['datos'], caso['disposicion'])
            a, b = normalizar(html_py), normalizar(html_ts)
            if a != b:
                fallos += 1
                i = next(k for k in range(min(len(a), len(b))) if a[k] != b[k]) if a[:min(len(a), len(b))] != b[:min(len(a), len(b))] else min(len(a), len(b))
                print(f"DISTINTO {caso['tipo']}/{caso['disposicion']} en {i}:\n  py: {a[max(0, i - 80):i + 80]!r}\n  ts: {b[max(0, i - 80):i + 80]!r}")
            else:
                print(f"igual   {caso['tipo']}/{caso['disposicion']}")
        if fallos:
            raise SystemExit(f'{fallos} piezas distintas')
        print(f'{len(CASOS)} piezas iguales en el motor y en Studio')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
