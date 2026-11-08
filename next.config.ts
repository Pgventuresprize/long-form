import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las fuentes del carrusel se leen del disco en tiempo de ejecucion, y el
  // trazado automatico de Vercel no las ve porque nadie las importa: solo se
  // referencian por ruta. Sin esto, el render falla en produccion y funciona en
  // local, que es la peor forma de enterarse.
  outputFileTracingIncludes: {
    "/api/**": ["./src/engine/render/fonts/**"],
    // El Chromium de @sparticuz va comprimido en bin/ y se lee por ruta: el
    // trazado no lo ve solo. Marca > Kit de diseño dibuja con el, y los
    // carruseles de una marca con kit activo tambien: los hace el tick y se
    // redibujan desde el tablero (la pagina de inicio).
    // Marca > Estilo editorial > Long form dibuja la vista previa con las plantillas del motor,
    // que se leen por ruta igual que las fuentes.
    "/marca": ["./node_modules/@sparticuz/chromium/bin/**", "./long-form/plantillas/**"],
    "/long-form/**": ["./long-form/plantillas/**"],
    "/api/long-form/**": ["./long-form/plantillas/**"],
    "/api/content/tick": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/estudio": ["./node_modules/@sparticuz/chromium/bin/**"],
    // "Publicar ahora" corre en la ruta del calendario y dibuja la tarjeta de LinkedIn.
    "/calendario": ["./src/engine/render/fonts/**", "./node_modules/@sparticuz/chromium/bin/**"],
    // El chat dispara pasadas que dibujan carruseles y restaura versiones
    // redibujandolas desde su maqueta.
    "/api/chat/**": ["./node_modules/@sparticuz/chromium/bin/**"],
    // El onboarding abre la web de la marca con un navegador de verdad.
    "/api/onboarding": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Marca salio de Configuracion a su propia seccion: los enlaces viejos
  // (marcadores, avisos ya enviados) siguen llegando, con su ?tab=.
  async redirects() {
    return [{ source: "/configuracion/marca", destination: "/marca", permanent: false }]
  },
};

export default nextConfig;
