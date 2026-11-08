import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * La puerta del dashboard.
 *
 * En Next 16 esto se llama `proxy.ts` — es el antiguo `middleware.ts`, renombrado
 * y ya en runtime de Node por defecto.
 *
 * Hace dos cosas en la misma pasada, y las dos hacen falta:
 *
 *   1. Refresca la sesion. Los tokens de Supabase caducan en una hora; si nadie
 *      los renueva, la sesion se muere sola aunque el usuario este trabajando.
 *      Renovarlos aqui es lo que hace que las cookies lleguen frescas a todo lo
 *      que corra despues.
 *   2. Manda a /login a quien no tenga sesion.
 *
 * `getUser()` valida el token contra Supabase en cada peticion. Es una llamada
 * de red por peticion, que para un panel interno es un precio razonable a cambio
 * de que la puerta no dependa de una cookie que el navegador manda tal cual.
 */

/** Lo que se atraviesa sin sesion, y por que. */
const ABIERTAS = [
  // La propia pagina de login, o no habria forma de entrar.
  "/login",
  // Crear cuenta y pedir el enlace de "¿Olvidaste tu contraseña?": las usa
  // justo quien no tiene sesion.
  "/registro",
  "/recuperar",
  // Adonde llegan los enlaces de los correos; la sesion se abre ahi dentro.
  "/auth/confirm",
  // Los dispara Postgres con `INGEST_SECRET`, no un navegador: pedirles sesion
  // romperia los crons. Tienen su propia autorizacion en `lib/api-auth.ts`.
  "/api/ingest",
  "/api/content/tick",
  "/api/studio/tick",
  "/api/videos/tick",
  "/api/redaccion/tick",
  "/api/publicacion/tick",
  "/api/calendario/tick",
  "/api/chat/pasada",
  // La llama el motor de long form con `LF_MOTOR_SECRETO`, no un navegador.
  "/api/long-form/ia",
]

/** Con sesion no ofrecen nada: se va al inicio. */
const SOLO_SIN_SESION = ["/login", "/registro", "/recuperar"]

function esAbierta(pathname: string): boolean {
  return ABIERTAS.some((ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`))
}

export async function proxy(request: NextRequest) {
  // Un enlace de correo que cayo en otra ruta: pasa cuando Supabase no reconoce
  // el `redirectTo` (no esta en su lista de Redirect URLs) y lo cambia por la
  // Site URL, que es la raiz. Se lleva a /auth/confirm con su token.
  const { searchParams } = request.nextUrl
  if (searchParams.has("token_hash") && searchParams.has("type") && request.nextUrl.pathname !== "/auth/confirm") {
    const confirmar = request.nextUrl.clone()
    confirmar.pathname = "/auth/confirm"
    return NextResponse.redirect(confirmar)
  }

  // La respuesta se crea antes de hablar con Supabase porque `setAll` escribe en
  // ella las cookies renovadas. Si se creara despues, se perderian.
  const response = NextResponse.next({ request })

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY

  // Sin credenciales no se puede comprobar nada. Se deja pasar en vez de tapiar
  // la aplicacion: el fallo es de configuracion y ya se ve en cuanto algo lee la
  // base, mientras que un redirect infinito a /login no explicaria nada.
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        }
        // Los manda `@supabase/ssr` para que ninguna CDN cachee una respuesta
        // que lleva la sesion de alguien dentro.
        for (const [clave, valor] of Object.entries(headers)) {
          response.headers.set(clave, valor)
        }
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  // Igual que `usuarioActual`: sin esto, un bloqueado con token vigente rebotaria
  // para siempre entre /login, que lo ve con sesion, y el dashboard, que no.
  const bloqueado = data.user?.banned_until && new Date(data.user.banned_until).getTime() > Date.now()
  const user = bloqueado ? null : data.user

  const { pathname, search } = request.nextUrl

  if (!user && !esAbierta(pathname)) {
    const login = request.nextUrl.clone()
    login.pathname = "/login"
    // Para volver a donde iba una vez dentro.
    login.search = pathname === "/" ? "" : `?destino=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(login)
  }

  // Con sesion, /login, /registro y /recuperar no tienen nada que ofrecer.
  if (user && SOLO_SIN_SESION.includes(pathname)) {
    const inicio = request.nextUrl.clone()
    inicio.pathname = "/"
    inicio.search = ""
    return NextResponse.redirect(inicio)
  }

  return response
}

export const config = {
  /**
   * Todo menos los estaticos.
   *
   * Se listan por extension y no por carpeta porque los assets de Next viven en
   * `_next` pero el icono y el resto salen de rutas normales, y pasar imagenes
   * por una llamada de red a Supabase seria absurdo.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
