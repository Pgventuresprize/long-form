"""Una hora por tipo de grabacion: que el motor aguante el largo real y cuanto tarda en esta maquina.

    python tests/prueba_hora.py armar               # genera la proyeccion y la pantalla de una hora
    python tests/prueba_hora.py [caso ...]          # de punta a punta en Rapido, sin Claude ni Groq

Casos (las grabaciones son de la maquina de quien prueba; la que falte, su caso se salta):
  meet        el taller del 2026-11-05 (68 min) con su PDF       LF_HORA_MEET, LF_MUESTRA_PDF
  camaras     las dos camaras de la charla de César (57-60 min)  LF_HORA_CAM_A, LF_HORA_CAM_B
  una_camara  la camara de César sola                            LF_HORA_CAM_A
  podcast     el talk show ya editado (57 min)                   LF_HORA_EDITADO
  charla      la camara de César y una proyeccion del PDF generada con su misma duracion
  pantalla    una pantalla generada de una hora, con el audio de la otra camara

Cada caso deja en LF_PRUEBAS_HORA/proyectos/<caso>/medida.json el tiempo por etapa, la memoria maxima del motor
y el control de calidad.
"""
import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ['LF_DATOS'] = os.environ.get('LF_PRUEBAS_HORA', r'C:\Users\juanf\lf-local\pruebas-hora')
os.environ.pop('LF_STUDIO_URL', None)

from editor import almacen, ffm  # noqa: E402
from editor.pipeline import ORDEN, correr_etapa  # noqa: E402

D = Path(r'C:\Users\juanf\Downloads')
M = Path(os.environ.get('LF_MUESTRAS', r'C:\Users\juanf\lf-local\muestras'))
H = M / 'hora'
MARCA = os.environ.get('LF_MARCA', r'C:\Users\juanf\lf-local\datos\marcas\ae595bcd-a273-4a10-928e-f66f9d59ca68')


def _buscar(carpeta, nombre):
    carpeta = Path(carpeta)
    return next(iter(carpeta.rglob(nombre)), carpeta / nombre) if carpeta.exists() else carpeta / nombre


CESAR = D / 'Ia en deportes plogycesar'
CAM_A = Path(os.environ.get('LF_HORA_CAM_A') or _buscar(CESAR, 'IMG_1437.MP4'))
CAM_B = Path(os.environ.get('LF_HORA_CAM_B') or _buscar(CESAR, 'IMG_0849.MP4'))
EDITADO = Path(os.environ.get('LF_HORA_EDITADO') or CESAR / 'IA en deportes - Plogy x Cesar (talk show v2).mp4')
MEET = Path(os.environ.get('LF_HORA_MEET') or _buscar(D / 'plogy studio carruseles', 'Grabaci*7.35.14*.mov'))
PDF = M / 'tipos' / 'laminas.pdf'

CASOS = {
    'una_camara': ('una_camara', [('fuente', CAM_A)]),
    'podcast': ('podcast', [('fuente', EDITADO)]),
    'camaras': ('camaras', [('fuente', CAM_A), ('fuente', CAM_B)]),
    'meet': ('meet', [('fuente', MEET), ('pdf', PDF)]),
    'charla': ('charla', [('fuente', CAM_A), ('fuente', H / 'proyeccion.mp4'), ('pdf', PDF)]),
    'pantalla': ('pantalla', [('fuente', H / 'pantalla.mp4')]),
}


def armar():
    """Proyeccion del PDF y pantalla, del largo de la camara A: con su audio la proyeccion (misma charla) y con el
    de la camara B la pantalla."""
    H.mkdir(parents=True, exist_ok=True)
    dur = ffm.sondear(CAM_A)['duracion']
    if not (H / 'proyeccion.mp4').exists():
        import pymupdf
        d = H / '_laminas'
        d.mkdir(exist_ok=True)
        doc = pymupdf.open(PDF)
        paginas = list(range(len(doc)))
        lista = []
        for i, n in enumerate(paginas):
            pg = doc[n]
            k = 1920 / pg.rect.width
            p = d / f'{i:02d}.png'
            pg.get_pixmap(matrix=pymupdf.Matrix(k, k), alpha=False).save(str(p))
        # cada lamina entre 45 y 150 s, en orden, hasta cubrir la hora
        t, i = 0.0, 0
        while t < dur:
            seg = 45 + (i * 37) % 105
            lista.append(f"file '{(d / f'{i % len(paginas):02d}.png').as_posix()}'\nduration {seg}")
            t += seg
            i += 1
        lista.append(f"file '{(d / f'{(i - 1) % len(paginas):02d}.png').as_posix()}'")
        (d / 'lista.txt').write_text('\n'.join(lista), encoding='utf8')
        ffm.correr(['-f', 'concat', '-safe', '0', '-i', d / 'lista.txt', '-i', CAM_A, '-map', '0:v', '-map', '1:a', '-vf',
                    'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '22', '-c:a', 'aac', '-t', f'{dur:.2f}',
                    H / 'proyeccion.mp4'])
        print('listo proyeccion.mp4')
    if not (H / 'pantalla.mp4').exists():
        dur_b = ffm.sondear(CAM_B)['duracion']
        # algo se mueve en dos zonas, en ciclos de 2 min (escribir abajo, un menu arriba)
        x = "if(between(mod(t\\,120)\\,20\\,50)\\,220+mod(t*60\\,500)\\,if(between(mod(t\\,120)\\,65\\,95)\\,1350+mod(t*40\\,300)\\,-200))"
        y = "if(between(mod(t\\,120)\\,20\\,50)\\,760\\,if(between(mod(t\\,120)\\,65\\,95)\\,180\\,-200))"
        fuente = Path(r'C:\Windows\Fonts\arial.ttf')
        ff = f"fontfile='{ffm.ruta_filtro(fuente)}':" if fuente.exists() else ''
        texto = (f"drawtext={ff}text='Panel de contenido':fontsize=64:fontcolor=0x222222:x=120:y=90,"
                 f"drawtext={ff}text='Publicaciones de la semana':fontsize=40:fontcolor=0x555555:x=120:y=200,"
                 "drawbox=x=120:y=300:w=1680:h=2:color=0xdddddd:t=fill,"
                 f"drawtext={ff}text='Lunes  Martes  Miercoles  Jueves  Viernes':fontsize=36:fontcolor=0x333333:x=120:y=340,"
                 "drawbox=x=120:y=700:w=900:h=120:color=0xf2f2f2:t=fill")
        ffm.correr(['-f', 'lavfi', '-i', f'color=c=white:s=1920x1080:r=30:d={dur_b:.2f}', '-f', 'lavfi',
                    '-i', f'color=c=0xff5a1f:s=60x36:r=30:d={dur_b:.2f}', '-i', CAM_B, '-filter_complex',
                    f'[0:v]{texto}[f];[f][1:v]overlay=x={x}:y={y}[v]', '-map', '[v]', '-map', '2:a',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-t', f'{dur_b:.2f}', H / 'pantalla.mp4'])
        print('listo pantalla.mp4')


def correr(caso):
    import psutil
    esperado, archivos = CASOS[caso]
    if not all(Path(r).exists() for _, r in archivos):
        print(f'-- {caso}: falta {[str(r) for _, r in archivos if not Path(r).exists()]}, se salta')
        return None
    alm = almacen.AlmacenLocal()
    d = alm.carpeta(caso)
    (d / 'estado').mkdir(parents=True, exist_ok=True)
    lista, n = [], 0
    for tipo, ruta in archivos:
        a = {'tipo': tipo, 'ruta': str(ruta), 'nombre': Path(ruta).name}
        if tipo == 'fuente':
            a['rol'] = 'AB'[n]
            n += 1
        lista.append(a)
    spec = {'id': caso, 'titulo': f'Una hora: {caso}', 'tipo': None, 'esfuerzo': 'rapido', 'marca': MARCA, 'idioma': 'es',
            'opciones': {'clips': 0}, 'archivos': lista}
    (d / 'proyecto.json').write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf8')

    yo = psutil.Process()
    pico = {'mb': 0}
    vivo = {'si': True}

    def vigilar():
        while vivo['si']:
            try:
                total = yo.memory_info().rss + sum(c.memory_info().rss for c in yo.children(recursive=True))
                pico['mb'] = max(pico['mb'], total / 2**20)
            except psutil.Error:
                pass
            time.sleep(2)
    threading.Thread(target=vigilar, daemon=True).start()
    medida = {'caso': caso, 'etapas': {}, 'inicio': time.strftime('%Y-%m-%d %H:%M')}
    t0 = time.time()
    try:
        for e in ORDEN:
            if e == 'clips':
                break
            t = time.time()
            correr_etapa(alm, caso, e, encadenar=False)
            medida['etapas'][e] = round(time.time() - t)
            print(f'   {caso} {e} {medida["etapas"][e]} s (memoria máx. {pico["mb"]:.0f} MB)', flush=True)
            (d / 'medida.json').write_text(json.dumps(medida, ensure_ascii=False, indent=1), encoding='utf8')
    finally:
        vivo['si'] = False
    est = alm.estado(caso)
    cl = est.get('clasificacion') or {}
    qa = est.get('qa') or {}
    medida.update(total_s=round(time.time() - t0), memoria_max_mb=round(pico['mb']), tipo=cl.get('tipo'),
                  duracion_s=round(max(p['duracion'] for p in cl.get('pistas', [{'duracion': 0}])), 1),
                  video=bool(est.get('render')), qa=qa.get('problemas'))
    (d / 'medida.json').write_text(json.dumps(medida, ensure_ascii=False, indent=1), encoding='utf8')
    errores = []
    if cl.get('tipo') != esperado:
        errores.append(f'tipo {cl.get("tipo")}, se esperaba {esperado}')
    if not medida['video']:
        errores.append('no hay video')
    if qa.get('problemas'):
        errores.append(f'control de calidad: {qa["problemas"]}')
    print(f'{"ok   " if not errores else "FALLA"} {caso}: {medida["duracion_s"] / 60:.0f} min en {medida["total_s"] / 60:.0f} min, '
          f'memoria máx. {medida["memoria_max_mb"]} MB {medida["etapas"]}', flush=True)
    for e in errores:
        print('        !', e)
    return not errores


if __name__ == '__main__':
    if sys.argv[1:2] == ['armar']:
        armar()
        sys.exit(0)
    res = {}
    for c in sys.argv[1:] or list(CASOS):
        try:
            res[c] = correr(c)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(f'FALLA {c}: {type(e).__name__}: {e}', flush=True)
            res[c] = False
    fallas = [c for c, ok in res.items() if ok is False]
    print(f'{sum(1 for v in res.values() if v)} ok, {len(fallas)} fallas, {sum(1 for v in res.values() if v is None)} saltadas')
    sys.exit(1 if fallas else 0)
