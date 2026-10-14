export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024

const PREFIX = 'data:image/png;base64,'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Decoded PNG bytes of a `data:image/png;base64,…` URL, or null (other type, bad base64, too big, not a PNG). */
export function parsePngDataUrl(value: unknown, maxBytes = MAX_CLIPBOARD_IMAGE_BYTES): Buffer | null {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return null
  const b64 = value.slice(PREFIX.length)
  if (!b64 || b64.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
  const buf = Buffer.from(b64, 'base64')
  if (buf.length > maxBytes || buf.length < PNG_SIGNATURE.length || !buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null
  return buf
}

export interface ClipboardImageDeps {
  /** `nativeImage.createFromDataURL`: proves the bytes decode as an image. */
  createFromDataURL: (dataUrl: string) => { isEmpty: () => boolean; toPNG: () => Buffer }
  /** Electron 44 clipboard is the async W3C-style API: `clipboard.write([new ClipboardItem({'image/png': blob})])`. */
  writePng: (png: Buffer) => Promise<void>
}

/** Re-encodes through nativeImage (drops anything but pixels) before it reaches the clipboard. */
export async function writeClipboardImage(dataUrl: unknown, deps: ClipboardImageDeps): Promise<boolean> {
  if (!parsePngDataUrl(dataUrl)) return false
  const image = deps.createFromDataURL(dataUrl as string)
  if (image.isEmpty()) return false
  await deps.writePng(image.toPNG())
  return true
}

/** Electron's own implementation, loaded lazily so tests never import `electron`. */
export async function electronClipboardImage(): Promise<ClipboardImageDeps> {
  const { clipboard, ClipboardItem, nativeImage } = await import('electron')
  return {
    createFromDataURL: (u) => nativeImage.createFromDataURL(u),
    writePng: (png) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]),
  }
}
