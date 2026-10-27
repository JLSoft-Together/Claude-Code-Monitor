import type { OverlayTextStyle, Projection, RendererFactory } from '@ccm/habblaud/client/src/world'
import type { IsoArt } from './isoArt'

export const OFFICE_STYLE_KEY = 'ccm.office.style'
export const ISO_USED_KEY = 'ccm.office.isoUsed'

export type OfficeStyle = 'pixel' | 'iso'

export const OFFICE_STYLES: readonly OfficeStyle[] = ['pixel', 'iso']

export interface IsoKit {
  projection: Projection
  createRenderer: RendererFactory
  maxZoom: (view: { w: number; h: number }) => number
  text: OverlayTextStyle
  installPersonas: (lookOf: (seed: number) => 'f' | 'm' | undefined) => () => void
  art: Promise<IsoArt>
}

export function readOfficeStyle(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): OfficeStyle {
  try {
    return storage?.getItem(OFFICE_STYLE_KEY) === 'iso' ? 'iso' : 'pixel'
  } catch {
    return 'pixel'
  }
}

export function writeOfficeStyle(style: OfficeStyle, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(OFFICE_STYLE_KEY, style)
  } catch {
    return
  }
}

export const ISO_ART_WAIT_MS = 8000

export function readIsoUsed(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    return storage?.getItem(ISO_USED_KEY) === '1'
  } catch {
    return false
  }
}

export function markIsoUsed(storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(ISO_USED_KEY, '1')
  } catch {
    return
  }
}

export function loadIsoModules() {
  return Promise.all([import('./projection'), import('./IsoRenderer'), import('./personas'), import('./isoArt'), import('./fonts')])
}

export function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

export async function loadIso(style: OfficeStyle = readOfficeStyle(), artWaitMs = ISO_ART_WAIT_MS): Promise<IsoKit | null> {
  if (style !== 'iso') return null
  const [{ isoProjection }, { createIsoRenderer, isoMaxZoom }, { installPersonas }, { isoArt }, { ISO_TEXT, waitIsoFonts }] = await loadIsoModules()
  const art = isoArt({ urgent: true })
  await Promise.all([waitIsoFonts(), settleWithin(art, artWaitMs)])
  return { projection: isoProjection, createRenderer: createIsoRenderer, maxZoom: isoMaxZoom, text: ISO_TEXT, installPersonas: (lookOf) => installPersonas(lookOf), art }
}

export function lookFromAgents(agents: () => readonly { seed: number; look: 'f' | 'm' }[] | undefined): (seed: number) => 'f' | 'm' | undefined {
  let src: readonly { seed: number; look: 'f' | 'm' }[] | undefined
  let map = new Map<number, 'f' | 'm'>()
  return (seed) => {
    const cur = agents()
    if (cur !== src) {
      src = cur
      map = new Map((cur ?? []).map((a) => [a.seed, a.look]))
    }
    return map.get(seed)
  }
}
