import type { OverlayTextStyle } from '@ccm/habblaud/client/src/world'

export const ISO_FONT_NAME = 'Be Vietnam Pro'
export const ISO_FONT_FAMILY = `"${ISO_FONT_NAME}", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`
export const ISO_FONT_WEIGHTS = [500, 600] as const
export const ISO_ICON_LIFT = 6
export const ISO_TEXT: OverlayTextStyle = { family: ISO_FONT_FAMILY, padX: 8, padY: 4, declutter: true, iconLift: ISO_ICON_LIFT }
export const ISO_FONT_SAMPLE = 'Aa Đđ Ặặ Ỹỹ Ơơ Ưư'
export const ISO_FONT_WAIT_MS = 1500

type FontLoader = Pick<FontFaceSet, 'load'>

let ready: Promise<void> | null = null

export function loadIsoFonts(fonts: FontLoader | null | undefined = typeof document === 'undefined' ? undefined : document.fonts): Promise<void> {
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve()
  if (ready) return ready
  ready = Promise.all(ISO_FONT_WEIGHTS.map((w) => fonts.load(`${w} 12px "${ISO_FONT_NAME}"`, ISO_FONT_SAMPLE))).then(
    () => undefined,
    () => undefined,
  )
  return ready
}

export function waitIsoFonts(fonts?: FontLoader | null, ms = ISO_FONT_WAIT_MS): Promise<void> {
  const load = fonts === undefined ? loadIsoFonts() : loadIsoFonts(fonts)
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    void load.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export function resetIsoFontsForTest(): void {
  ready = null
}
