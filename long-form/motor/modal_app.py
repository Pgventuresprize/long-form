"""El motor en Modal. Listo para desplegar; no se ha probado contra Modal (no hay cuenta todavia).

    modal deploy long-form/motor/modal_app.py      # despliega
    modal serve  long-form/motor/modal_app.py      # para probar contra un Studio local

Studio llama a `despertar` (POST con el secreto compartido) cada vez que encola algo; `despertar` responde
enseguida y lanza `vaciar`, que toma trabajos de lf_trabajos hasta que la cola del motor queda vacia.

Cada etapa corre en un contenedor grande y reparte su trabajo pesado en hilos (trozos del render, piezas
graficas con un Chromium por hilo, partes de la transcripcion por Groq). La carpeta de trabajo es un Volume
compartido, para que una etapa encuentre lo que dejo la anterior aunque corra en otro contenedor.

Secretos (modal secret create lf-motor ...): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LF_MOTOR_SECRETO,
LF_STUDIO_URL, GROQ_API_KEY.
"""
import os

import modal

app = modal.App('plogy-longform')

imagen = (
    modal.Image.debian_slim(python_version='3.12')
    .apt_install('ffmpeg', 'fonts-dejavu-core')
    .pip_install_from_requirements(os.path.join(os.path.dirname(__file__), 'requirements.txt'))
    .run_commands('playwright install --with-deps chromium')
    .add_local_dir(os.path.dirname(__file__), '/motor', ignore=['.datos', '__pycache__', '*.pyc'])
    .add_local_dir(os.path.join(os.path.dirname(__file__), '..', 'plantillas'), '/plantillas')
)

volumen = modal.Volume.from_name('lf-trabajo', create_if_missing=True)
secretos = [modal.Secret.from_name('lf-motor')]
ENTORNO = {'LF_DATOS': '/data', 'LF_HILOS': '30', 'LF_NUCLEOS': '32', 'PYTHONPATH': '/motor'}


@app.function(image=imagen, volumes={'/data': volumen}, secrets=secretos, cpu=32, memory=32768, timeout=3600,
              max_containers=10)
def vaciar():
    os.environ.update(ENTORNO)
    import sys
    sys.path.insert(0, '/motor')
    # Las plantillas van en /plantillas: config.PLANTILLAS es la carpeta hermana del motor (/motor/../plantillas).
    from editor import __main__ as motor
    volumen.reload()
    try:
        motor.vaciar()
    finally:
        volumen.commit()


web = modal.Image.debian_slim(python_version='3.12').pip_install('fastapi[standard]')
with web.imports():
    from fastapi import HTTPException, Request


@app.function(image=web, secrets=secretos, cpu=0.25)
@modal.fastapi_endpoint(method='POST')
def despertar(request: Request):
    import hmac
    esperado = f"Bearer {os.environ.get('LF_MOTOR_SECRETO', '')}"
    if not hmac.compare_digest(request.headers.get('authorization', ''), esperado):
        raise HTTPException(status_code=404)
    vaciar.spawn()
    return {'ok': True}
