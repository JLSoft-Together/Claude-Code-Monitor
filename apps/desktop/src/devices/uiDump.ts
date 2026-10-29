import type { DevUiNode } from '@ccm/shared'

export const UI_NODES_MAX = 5000
const TEXT_MAX = 500

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return safeChar(parseInt(e.slice(2), 16), m)
    if (e.startsWith('#')) return safeChar(parseInt(e.slice(1), 10), m)
    return ENTITY[e] ?? m
  })
}

function safeChar(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback
}

export function xmlAttrs(body: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const m of body.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]!] = decodeXml(m[2] ?? m[3] ?? '')
  return out
}

const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/

export function parseBounds(s: string | undefined): [number, number, number, number] | null {
  const m = s ? BOUNDS.exec(s) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null
}

const clip = (s: string | undefined): string => (s ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').slice(0, TEXT_MAX)

/** `uiautomator dump` XML → flat node list in document order (`parent` = index, -1 for roots). Null when it is not a dump. */
export function parseUiDump(xml: string): { nodes: DevUiNode[]; rotation: number } | null {
  const head = /<hierarchy\b([^>]*)>/.exec(xml)
  if (!head) return null
  const rotation = Number(xmlAttrs(head[1]!).rotation ?? 0) || 0
  const nodes: DevUiNode[] = []
  const stack: number[] = []
  for (const m of xml.matchAll(/<(\/?)node\b([^>]*?)(\/?)>/g)) {
    if (m[1]) {
      stack.pop()
      continue
    }
    const a = xmlAttrs(m[2]!)
    const bounds = parseBounds(a.bounds) ?? [0, 0, 0, 0]
    const index = nodes.length
    if (index >= UI_NODES_MAX) break
    // Password fields: uiautomator already masks most, but never carry their text over.
    const secret = a.password === 'true'
    nodes.push({
      parent: stack.length ? stack[stack.length - 1]! : -1,
      depth: stack.length,
      cls: clip(a.class),
      resId: clip(a['resource-id']),
      text: secret ? '' : clip(a.text),
      desc: clip(a['content-desc']),
      pkg: clip(a.package),
      bounds,
      clickable: a.clickable === 'true',
    })
    if (!m[3]) stack.push(index)
  }
  return { nodes, rotation }
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Width / height from the IHDR chunk; null when `buf` is not a PNG. */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24 || PNG_SIG.some((b, i) => buf[i] !== b)) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** Some devices print a warning line before the PNG bytes on `exec-out screencap`. */
export function findPngStart(buf: Uint8Array): number {
  for (let i = 0; i + PNG_SIG.length <= Math.min(buf.length, 4096); i++) if (PNG_SIG.every((b, j) => buf[i + j] === b)) return i
  return -1
}
