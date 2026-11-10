"""Quién habla por la boca, medido contra una respuesta conocida.

    python tests/prueba_quien_habla.py         (desde long-form/motor)

Dos cámaras con un micrófono cada una (LF_MUESTRA_CAM_A y LF_MUESTRA_CAM_B, por defecto las de César y María
Lucía) dicen quién habla en cada frase por el nivel de cada micrófono: esa es la respuesta. Las mismas dos
cámaras, sincronizadas y puestas lado a lado en un solo cuadro, son "una cámara con dos personas": ahí el
motor tiene que decir quién habla solo mirando las bocas. Se compara frase por frase.

Usa 10 minutos desde el minuto 10 (LF_BOCA_DESDE, LF_BOCA_DURA). La primera corrida transcribe; las siguientes
usan la caché.
"""
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ['LF_DATOS'] = os.environ.get('LF_PRUEBAS', r'C:\Users\juanf\lf-local\pruebas-tipos')
os.environ.pop('LF_STUDIO_URL', None)

from editor import almacen, config, ffm  # noqa: E402
from editor.contexto import Contexto  # noqa: E402
from editor.etapas import una_camara  # noqa: E402
from editor.pipeline import correr_etapa  # noqa: E402

CARPETA = Path(r'C:\Users\juanf\Downloads\Ia en deportes plogycesar')
def _buscar(nombre):
    # por nombre: las carpetas de iCloud traen la ñ descompuesta y no coincide escrita a mano
    return next(iter(CARPETA.rglob(nombre)), CARPETA / nombre) if CARPETA.exists() else CARPETA / nombre


CAM_A = Path(os.environ.get('LF_MUESTRA_CAM_A') or _buscar('IMG_1437.MP4'))
CAM_B = Path(os.environ.get('LF_MUESTRA_CAM_B') or _buscar('IMG_0849.MP4'))
DESDE = float(os.environ.get('LF_BOCA_DESDE', 600))
DURA = float(os.environ.get('LF_BOCA_DURA', 600))
MARCA = os.environ.get('LF_MARCA', r'C:\Users\juanf\lf-local\datos\marcas\ae595bcd-a273-4a10-928e-f66f9d59ca68')
M = Path(os.environ.get('LF_MUESTRAS', r'C:\Users\juanf\lf-local\muestras')) / 'boca'


def proyecto(alm, pid, archivos, forzado=None):
    d = alm.carpeta(pid)
    (d / 'estado').mkdir(parents=True, exist_ok=True)
    spec = {'id': pid, 'titulo': pid, 'tipo': None, 'esfuerzo': 'rapido', 'marca': MARCA, 'idioma': 'es', 'opciones': {'clips': 0},
            'archivos': [{'tipo': 'fuente', 'rol': 'AB'[i], 'ruta': str(r), 'nombre': Path(r).name} for i, r in enumerate(archivos)]}
    if forzado:
        spec['tipo_forzado'] = forzado
    (d / 'proyecto.json').write_text(json.dumps(spec, ensure_ascii=False), encoding='utf8')


def hasta(alm, pid, etapa):
    est = alm.estado(pid)
    for e in ['ingesta', 'clasificar', 'analisis', 'transcripcion']:
        if (e if e != 'clasificar' else 'clasificacion') not in est:
            correr_etapa(alm, pid, e, encadenar=False)
        if e == etapa:
            break


def main():
    if not (CAM_A.exists() and CAM_B.exists()):
        print('-- faltan las grabaciones de las dos cámaras (LF_MUESTRA_CAM_A, LF_MUESTRA_CAM_B)')
        return 0
    M.mkdir(parents=True, exist_ok=True)
    a, b = M / 'cam_a.mp4', M / 'cam_b.mp4'
    for src, dst in ((CAM_A, a), (CAM_B, b)):
        if not dst.exists():
            ffm.correr(['-ss', str(DESDE), '-i', str(src), '-t', str(DURA), '-c', 'copy', str(dst)])
    alm = almacen.AlmacenLocal()

    # 1. la respuesta: cada camara con su micro
    proyecto(alm, 'boca_camaras', [a, b])
    hasta(alm, 'boca_camaras', 'transcripcion')
    an = alm.estado('boca_camaras')['analisis']
    segs = json.loads((alm.carpeta('boca_camaras') / 'trabajo' / 'transcripcion.json').read_text(encoding='utf8'))
    off = an['offsets']['B'] - an['offsets']['A']

    # 2. las dos camaras lado a lado, sincronizadas: una camara con dos personas (A a la izquierda)
    lado = M / 'lado.mp4'
    ia, ib = (0.0, off) if off >= 0 else (-off, 0.0)
    # segundo t del programa de camaras = segundo inicio + t + offset_A de la camara A = segundo (ese - ia) del lado a lado
    corrimiento = ia - an['inicio'] - an['offsets']['A']
    if not lado.exists():
        ffm.correr(['-ss', f'{ia:.3f}', '-i', str(a), '-ss', f'{ib:.3f}', '-i', str(b), '-filter_complex',
                    '[0:v]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,setsar=1[l];'
                    '[1:v]scale=960:540:force_original_aspect_ratio=increase,crop=960:540,setsar=1[r];'
                    '[l][r]hstack,pad=1920:1080:0:270[v]', '-map', '[v]', '-map', '0:a', '-t', str(DURA - abs(off) - 1),
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', str(lado)])
    proyecto(alm, 'boca_lado', [lado], forzado='una_camara')
    hasta(alm, 'boca_lado', 'analisis')
    ctx = Contexto(alm, 'boca_lado', 'transcripcion')
    ps = ctx.estado['analisis']['personas']
    if len(ps) != 2:
        print(f'FALLA se esperaban 2 personas y se ven {len(ps)}')
        return 1
    izq, der = sorted(ps, key=lambda p: p['cx'])
    # las frases de la respuesta, en el tiempo del video lado a lado
    mias = [dict(s, inicio=s['inicio'] - corrimiento, fin=s['fin'] - corrimiento) for s in segs
            if s.get('hablante') in ('A', 'B') and s['inicio'] - corrimiento > 1 and s['fin'] - corrimiento < DURA - abs(off) - 2]
    verdad = [s['hablante'] for s in mias]
    for s in mias:
        s.pop('hablante')
    una_camara.hablantes(ctx, mias)
    traduce = {izq['id']: 'A', der['id']: 'B'}
    from collections import Counter
    total = len(mias)
    dichas = [(traduce.get(s.get('hablante')), v) for s, v in zip(mias, verdad) if s.get('hablante')]
    aciertos = sum(1 for d, v in dichas if d == v)
    por = {w: (sum(1 for d, v in dichas if v == w and d == w), sum(1 for v in verdad if v == w)) for w in 'AB'}
    print(f'frases: {total} ({dict(Counter(verdad))}); con persona: {len(dichas)}, acertadas {aciertos} '
          f'({aciertos / max(len(dichas), 1):.0%}); A {por["A"][0]} de {por["A"][1]}, B {por["B"][0]} de {por["B"][1]}')
    base = max(Counter(verdad).values()) / max(total, 1)
    print(f'referencia: decir siempre la persona que más habla acierta el {base:.0%}')
    # que acierte y que no sea a costa de la persona que habla menos
    ok = len(dichas) >= 0.8 * total and aciertos / max(len(dichas), 1) >= 0.9 and all(a >= 0.7 * n for a, n in por.values() if n)
    print('ok' if ok else 'FALLA')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
