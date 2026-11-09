"""Arma las muestras de las pruebas por tipo (tests/prueba_tipos_video.py) en LF_MUESTRAS/tipos.

    python tests/armar_muestras.py

Los originales no se tocan: se recortan copias. Las rutas de las grabaciones reales se pasan por variables de
entorno (son archivos de la maquina de quien prueba, no del repo); la que falte, su muestra no se arma y su
prueba se salta.

  LF_MUESTRAS        carpeta de muestras (por defecto la de corta-A/B de la fase 4)
  LF_MUESTRA_MEET    grabacion de pantalla de un Meet con laminas     (+ LF_MUESTRA_PDF, el PDF de esas laminas)
  LF_MUESTRA_EDITADO un video ya editado (talk show, podcast)
  LF_MUESTRA_GRUPO   una sola camara con varias personas
  corta-A.mp4 y corta-B.mp4 (dos camaras de una misma charla) deben estar en LF_MUESTRAS.

Charla y pantalla se generan: las laminas del PDF en un video (con el audio de corta-A, como si la camara y la
proyeccion se grabaran a la vez) y una pantalla con texto donde algo se mueve en dos zonas.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from editor import ffm  # noqa: E402

M = Path(os.environ.get('LF_MUESTRAS', r'C:\Users\juanf\lf-local\muestras'))
T = M / 'tipos'


def hecho(p):
    return p.exists() and p.stat().st_size > 1000


def recorte(origen, destino, desde, dur, copiar=True):
    if hecho(destino):
        return destino
    cod = ['-c', 'copy'] if copiar else ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac']
    ffm.correr(['-ss', f'{desde}', '-t', f'{dur}', '-i', origen, '-map', '0:v:0', '-map', '0:a:0?'] + cod + [destino])
    print('listo', destino.name)
    return destino


def main():
    T.mkdir(parents=True, exist_ok=True)
    a, b = M / 'corta-A.mp4', M / 'corta-B.mp4'
    if not (hecho(a) and hecho(b)):
        sys.exit(f'Faltan {a} y {b}')
    # partes sucesivas: corta-A en dos partes recodificadas (corte exacto), con nombres de camara
    recorte(a, T / 'C0001.MP4', 0, 60, copiar=False)
    recorte(a, T / 'C0002.MP4', 60, 60, copiar=False)
    if os.environ.get('LF_MUESTRA_EDITADO'):
        recorte(os.environ['LF_MUESTRA_EDITADO'], T / 'editado.mp4', 600, 120)
    if os.environ.get('LF_MUESTRA_GRUPO'):
        recorte(os.environ['LF_MUESTRA_GRUPO'], T / 'grupo.mp4', 0, 75)
    if os.environ.get('LF_MUESTRA_MEET'):
        recorte(os.environ['LF_MUESTRA_MEET'], T / 'meet.mp4', 1500, 150)
    pdf = os.environ.get('LF_MUESTRA_PDF')
    if pdf:
        import shutil
        if not hecho(T / 'laminas.pdf'):
            shutil.copy2(pdf, T / 'laminas.pdf')
        # las laminas en video: 8 laminas de 15 s, con el audio de la camara A (misma charla)
        if not hecho(T / 'proyeccion.mp4'):
            import pymupdf
            d = T / '_laminas'
            d.mkdir(exist_ok=True)
            doc = pymupdf.open(T / 'laminas.pdf')
            paginas = list(range(min(len(doc), 30)))[2:10]
            for i, n in enumerate(paginas):
                pg = doc[n]
                k = 1920 / pg.rect.width
                pg.get_pixmap(matrix=pymupdf.Matrix(k, k), alpha=False).save(str(d / f'{i:02d}.png'))
            ffm.correr(['-framerate', '1/15', '-i', d / '%02d.png', '-i', a, '-map', '0:v', '-map', '1:a', '-vf',
                        'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,fps=30',
                        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-t', '120', T / 'proyeccion.mp4'])
            print('listo proyeccion.mp4')
    # pantalla: una pagina con texto y algo que se mueve en dos zonas (escribir, un menu), con la voz de B
    if not hecho(T / 'pantalla.mp4'):
        x = "if(between(t\\,20\\,50)\\,220+mod(t*60\\,500)\\,if(between(t\\,65\\,95)\\,1350+mod(t*40\\,300)\\,-200))"
        y = "if(between(t\\,20\\,50)\\,760\\,if(between(t\\,65\\,95)\\,180\\,-200))"
        fuente = next((p for p in (Path(r'C:\Windows\Fonts\arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
                       if p.exists()), None)
        ff = f"fontfile='{ffm.ruta_filtro(fuente)}':" if fuente else ''
        texto = (f"drawtext={ff}text='Panel de contenido':fontsize=64:fontcolor=0x222222:x=120:y=90,"
                 f"drawtext={ff}text='Publicaciones de la semana':fontsize=40:fontcolor=0x555555:x=120:y=200,"
                 "drawbox=x=120:y=300:w=1680:h=2:color=0xdddddd:t=fill,"
                 f"drawtext={ff}text='Lunes  Martes  Miercoles  Jueves  Viernes':fontsize=36:fontcolor=0x333333:x=120:y=340,"
                 "drawbox=x=120:y=700:w=900:h=120:color=0xf2f2f2:t=fill")
        ffm.correr(['-f', 'lavfi', '-i', 'color=c=white:s=1920x1080:r=30:d=120', '-f', 'lavfi', '-i', 'color=c=0xff5a1f:s=60x36:r=30:d=120',
                    '-i', b, '-filter_complex', f'[0:v]{texto}[f];[f][1:v]overlay=x={x}:y={y}[v]', '-map', '[v]', '-map', '2:a',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-t', '120', T / 'pantalla.mp4'])
        print('listo pantalla.mp4')
    print('muestras en', T)


if __name__ == '__main__':
    main()
