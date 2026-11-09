import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ProveedorSubidas } from "@/components/long-form/subidas";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// La letra de la marca (brand kit 02). Solo para el logo, los titulos y los
// botones principales; el texto corrido sigue en Geist.
const plogyDisplay = localFont({
  src: "./fonts/PlogyDisplay-Bold.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--font-plogy-display",
});

export const metadata: Metadata = {
  title: "Plogy Studio",
  description: "El estudio de contenido de Plogy: agentes que investigan, escriben, diseñan y publican.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${plogyDisplay.variable} h-full antialiased`}
    >
      {/* Las subidas de Long-form viven aqui: siguen aunque se cambie de pantalla. */}
      <body className="min-h-full flex flex-col">
        <ProveedorSubidas>{children}</ProveedorSubidas>
      </body>
    </html>
  );
}
