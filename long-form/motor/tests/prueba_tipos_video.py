"""Una prueba por tipo de grabacion, con video (las muestras de tests/armar_muestras.py), sin base ni Claude.

    python tests/prueba_tipos_video.py clasificar [caso ...]   # ingesta + clasificar: que reconozca el tipo
    python tests/prueba_tipos_video.py todo [caso ...]         # de punta a punta en Rapido: video y control de calidad

Cada caso es un proyecto en LF_PRUEBAS/proyectos/<caso> (por defecto C:/Users/juanf/lf-local/pruebas-tipos). La
carpeta de trabajo es cache: repetir no vuelve a transcribir ni a renderizar lo que no cambio. El estado se
borra en cada corrida para que la clasificacion se decida de nuevo.
"""
import json
import os
import shutil
import sys
import time
from pathlib import Path

M = Path(os.environ.get('LF_MUESTRAS', r'C:\Users\juanf\lf-local\muestras'))
T = M / 'tipos'
os.environ['LF_DATOS'] = os.environ.get('LF_PRUEBAS', r'C:\Users\juanf\lf-local\pruebas-tipos')
os.environ.pop('LF_STUDIO_URL', None)          # sin Claude: cada etapa usa su respaldo
MARCA = os.environ.get('LF_MARCA', r'C:\Users\juanf\lf-local\datos\marcas\ae595bcd-a273-4a10-928e-f66f9d59ca68')

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from editor import almacen  # noqa: E402
from editor.pipeline import ORDEN, correr_etapa  # noqa: E402

# caso: (tipo esperado, archivos [(tipo de archivo, ruta)])
CASOS = {
    'una_camara': ('una_camara', [('fuente', M / 'corta-A.mp4')]),
    'grupo': ('una_camara', [('fuente', T / 'grupo.mp4')]),
    # subidas al reves: tienen que unirse en orden de nombre
    'partes': ('una_camara', [('fuente', T / 'C0002.MP4'), ('fuente', T / 'C0001.MP4')]),
    'camaras': ('camaras', [('fuente', M / 'corta-A.mp4'), ('fuente', M / 'corta-B.mp4')]),
    'podcast': ('podcast', [('fuente', T / 'editado.mp4')]),
    'meet': ('meet', [('fuente', T / 'meet.mp4'), ('pdf', T / 'laminas.pdf')]),
    'charla': ('charla', [('fuente', M / 'corta-A.mp4'), ('fuente', T / 'proyeccion.mp4'), ('pdf', T / 'laminas.pdf')]),
    'pantalla': ('pantalla', [('fuente', T / 'pantalla.mp4')]),
}


def preparar(alm, caso):
    esperado, archivos = CASOS[caso]
    d = alm.carpeta(caso)
    shutil.rmtree(d / 'estado', ignore_errors=True)
    (d / 'estado').mkdir()
    for p in (d / 'trabajo').glob('.hecho_*'):
        p.unlink()
    n = 0
    lista = []
    for tipo, ruta in archivos:
        a = {'tipo': tipo, 'ruta': str(ruta), 'nombre': Path(ruta).name}
        if tipo == 'fuente':
            a['rol'] = 'ABCDEFGH'[n]
            n += 1
        lista.append(a)
    spec = {'id': caso, 'titulo': f'Prueba {caso}', 'tipo': None, 'esfuerzo': 'rapido', 'marca': MARCA, 'idioma': 'es',
            'opciones': {'clips': 0}, 'archivos': lista}
    (d / 'proyecto.json').write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf8')
    return esperado


def correr(caso, hasta):
    alm = almacen.AlmacenLocal()
    if not all(Path(r).exists() for _, r in CASOS[caso][1]):
        print(f'-- {caso}: falta su muestra, se salta (tests/armar_muestras.py)')
        return None
    esperado = preparar(alm, caso)
    t0 = time.time()
    tiempos = {}
    for e in ORDEN:
        if e == 'clips':
            break
        t = time.time()
        correr_etapa(alm, caso, e, encadenar=False)
        tiempos[e] = round(time.time() - t)
        if e == hasta:
            break
    est = alm.estado(caso)
    cl = est['clasificacion']
    errores = []
    if cl['tipo'] != esperado:
        errores.append(f'tipo {cl["tipo"]}, se esperaba {esperado}')
    if caso == 'partes' and cl['partes'] != [['C0001.MP4', 'C0002.MP4']]:
        errores.append(f'partes {cl["partes"]}')
    if caso == 'charla' and cl['roles'] != {'contenido': 'B', 'camara': 'A'}:
        errores.append(f'roles {cl["roles"]}')
    if hasta == 'qa':
        if 'render' not in est or not Path(est['render']['local']).exists():
            errores.append('no hay video')
        qa = est.get('qa') or {}
        if qa.get('problemas'):
            errores.append(f'control de calidad: {qa["problemas"]}')
        planos = sorted({t.get('plano') or t.get('f') for t in est.get('tomas', [])})
        if caso in ('una_camara', 'partes', 'grupo') and len(planos) < 2:
            errores.append(f'una cámara sin reencuadre: planos {planos}')
        if caso == 'pantalla' and 'Z' not in planos:
            errores.append(f'pantalla sin acercamientos: planos {planos}')
        laminas = {t.get('pag') for t in est.get('tomas', []) if t.get('f') == 'S'}
        if caso == 'charla' and len(laminas) < 3:
            errores.append(f'la charla no sigue las láminas: muestra {sorted(laminas)}')
    print(f'{"ok   " if not errores else "FALLA"} {caso}: {cl["tipo"]} ({cl["confianza"]}) en {time.time() - t0:.0f} s {tiempos}')
    for r in cl['razones']:
        print('        ·', r)
    for e in errores:
        print('        !', e)
    return not errores


if __name__ == '__main__':
    modo = sys.argv[1] if len(sys.argv) > 1 else 'clasificar'
    casos = sys.argv[2:] or list(CASOS)
    hasta = 'clasificar' if modo == 'clasificar' else 'qa'
    res = {}
    for c in casos:
        try:
            res[c] = correr(c, hasta)
        except Exception as e:  # noqa: BLE001  un caso que se cae no detiene a los demas
            import traceback
            traceback.print_exc()
            print(f'FALLA {c}: {type(e).__name__}: {e}')
            res[c] = False
    fallas = [c for c, ok in res.items() if ok is False]
    print(f'{sum(1 for v in res.values() if v)} ok, {len(fallas)} fallas, {sum(1 for v in res.values() if v is None)} saltadas')
    sys.exit(1 if fallas else 0)
