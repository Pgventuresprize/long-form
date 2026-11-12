import type { UsoMusica } from "@/engine/long-form/nuevo"
import type { ClipPrevio } from "@/engine/long-form/nuevo-datos"

/** El estado de la pantalla "Nuevo video", paso por paso. */

export type Clip =
  | { id: string; origen: "subida"; archivo: File; duracion: number | null }
  | { id: string; origen: "biblioteca"; previo: ClipPrevio }

export type Apoyo = { id: string; archivo: File; tipo: "ilustracion" | "pdf" }

export type MusicaBib = { id: string; nombre: string; duracion: number | null; momento: string | null }

export type Pista =
  | { id: string; uso: UsoMusica | null; origen: "subida"; archivo: File }
  | { id: string; uso: UsoMusica | null; origen: "biblioteca"; audio: MusicaBib }

export type Referente = { modo: "archivo" | "enlace"; archivo: File | null; url: string }

export const nombreClip = (c: Clip) => (c.origen === "subida" ? c.archivo.name : c.previo.nombre)
export const duracionClip = (c: Clip) => (c.origen === "subida" ? c.duracion : c.previo.duracion)
export const nombrePista = (p: Pista) => (p.origen === "subida" ? p.archivo.name : p.audio.nombre)
