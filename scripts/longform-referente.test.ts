import assert from "node:assert/strict"
import { test } from "node:test"

import { esRutaReferente, referenteDe, rutaReferente, validarUrlReferente, VIDEO_REFERENTE } from "../src/engine/long-form/referente"

test("referente: enlaces publicos http o https, nada mas", () => {
  const ok = validarUrlReferente("  https://www.youtube.com/watch?v=abc  ")
  assert.deepEqual(ok, { ok: true, url: "https://www.youtube.com/watch?v=abc" })
  assert.equal(validarUrlReferente("http://vimeo.com/123").ok, true)
  for (const malo of ["", "youtube.com/watch", "ftp://x.com/a.mp4", "file:///C:/a.mp4", "javascript:alert(1)", "https://localhost/a", "http://127.0.0.1:8787/despertar", "http://10.0.0.4/a", "http://192.168.1.2/a", "http://172.20.0.1/a", "http://169.254.169.254/latest", "http://[::1]/a", "https://intranet/a", "https://yo:clave@x.com/a", `https://x.com/${"a".repeat(600)}`]) {
    assert.equal(validarUrlReferente(malo).ok, false, malo)
  }
})

test("referente: su ruta se reconoce y no choca con un archivo numerado", () => {
  const r = rutaReferente("cuenta", "proyecto", "mi-video.mp4")
  assert.equal(r, "cuenta/proyecto/entrada/referente-mi-video.mp4")
  assert.equal(esRutaReferente(r), true)
  // un video de la grabacion que se llama "referente-..." va numerado: no es el referente
  assert.equal(esRutaReferente("cuenta/proyecto/entrada/3-referente-mi-video.mp4"), false)
  assert.equal(VIDEO_REFERENTE.test("a.MOV"), true)
  assert.equal(VIDEO_REFERENTE.test("a.mp3"), false)
})

test("referente: la tarjeta solo aparece con lo que deja el motor", () => {
  assert.equal(referenteDe({}), null)
  assert.equal(referenteDe({ referente: null }), null)
  assert.equal(referenteDe({ referente: { metricas: {} } }), null)
  const r = { origen: "archivo", metricas: {}, ficha: { por_ia: false, resumen: "", tono_editorial: "" }, parametros: {}, resumen: { ve: ["Cambia de plano cada 4,2 s"], aplica: [], pendiente: [] } }
  assert.equal(referenteDe({ referente: r })?.resumen.ve[0], "Cambia de plano cada 4,2 s")
})
