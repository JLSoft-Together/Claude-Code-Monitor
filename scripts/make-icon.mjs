// Rasterizes scripts/assets/logo.svg into scripts/assets/ccm.ico (PNG-in-ICO, Vista+), the macOS icons and the PWA icons in apps/web/public. Zero dependencies.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'ccm.ico')
const SIZES = [16, 24, 32, 48, 64, 256]
const BG = [22, 24, 29]
const ACCENT = [232, 145, 90]
const INK = [232, 230, 227]

function quad([ax, ay], [cx, cy], [bx, by], steps = 8) {
  const pts = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pts.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by])
  }
  return pts
}

// Same geometry as scripts/assets/logo.svg (viewBox 1024). w = stroke width multiplier for the tray glyph.
function shapes(w = 1) {
  return [
    { kind: 'ring', color: INK, rect: [218, 218, 588, 588, 72], width: 34 * w },
    { kind: 'line', color: INK, width: 34 * w, cap: 'round', lines: [[[294, 427], [375, 508], [294, 589]]] },
    { kind: 'fill', color: ACCENT, rect: [423, 437, 50, 138, 10] },
    { kind: 'line', color: INK, width: 24 * w, cap: 'butt', lines: [[[487, 506], [590, 506]]] },
    {
      kind: 'line',
      color: INK,
      width: 24 * w,
      cap: 'square',
      lines: [
        [[590, 506], [590, 376], ...quad([590, 376], [590, 364], [602, 364]), [670, 364]],
        [[590, 506], [670, 506]],
        [[590, 506], [590, 636], ...quad([590, 636], [590, 648], [602, 648]), [670, 648]],
      ],
    },
    { kind: 'fill', color: ACCENT, rect: [670, 326, 78, 78, 16] },
    { kind: 'fill', color: INK, rect: [670, 467, 78, 78, 16] },
    { kind: 'fill', color: INK, rect: [670, 609, 78, 78, 16] },
  ]
}
const LOGO = shapes()
// Menu bar glyph for macOS: black on transparent, thicker strokes so it survives 16 px.
const GLYPH = shapes(1.6).map((s) => ({ ...s, color: [0, 0, 0] }))

function sdRoundRect(x, y, [rx, ry, w, h, r]) {
  const qx = Math.abs(x - rx - w / 2) - (w / 2 - r)
  const qy = Math.abs(y - ry - h / 2) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// Polyline with round joins; ends get the SVG cap (round, butt or square).
function onLine(line, cap, hw, x, y) {
  const n = line.length
  for (let i = 1; i < n; i++) {
    let [ax, ay] = line[i - 1]
    let [bx, by] = line[i]
    const len = Math.hypot(bx - ax, by - ay) || 1
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    if (cap === 'square' && i === 1) (ax -= ux * hw), (ay -= uy * hw)
    if (cap === 'square' && i === n - 1) (bx += ux * hw), (by += uy * hw)
    const t = (x - ax) * ux + (y - ay) * uy
    const segLen = Math.hypot(bx - ax, by - ay)
    if (t >= 0 && t <= segLen && Math.abs((x - ax) * uy - (y - ay) * ux) <= hw) return true
  }
  const ends = cap === 'round' ? line : line.slice(1, -1)
  return ends.some(([px, py]) => Math.hypot(x - px, y - py) <= hw)
}

function hit(s, x, y) {
  if (s.kind === 'fill') return sdRoundRect(x, y, s.rect) <= 0
  if (s.kind === 'ring') return Math.abs(sdRoundRect(x, y, s.rect)) <= s.width / 2
  return s.lines.some((l) => onLine(l, s.cap, s.width / 2, x, y))
}

// inset: transparent margin per side; radius: tile corner (logo units); glyph: GLYPH cropped to the frame, no tile.
function render(size, { inset = 0, radius = 0, glyph = false } = {}) {
  const ss = size <= 32 ? 6 : size <= 256 ? 4 : 2
  const [x0, span] = glyph ? [180, 664] : [0, 1024]
  const scale = span / (size - 2 * inset)
  const strokes = glyph ? GLYPH : LOGO
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = x0 + (px - inset + (sx + 0.5) / ss) * scale
          const y = x0 + (py - inset + (sy + 0.5) / ss) * scale
          if (x < 0 || y < 0 || x > 1024 || y > 1024) continue
          if (radius && sdRoundRect(x, y, [0, 0, 1024, 1024, radius]) > 0) continue
          let c = glyph ? null : BG
          for (const s of strokes) if (hit(s, x, y)) c = s.color
          if (!c) continue
          r += c[0]; g += c[1]; b += c[2]; a += 255
        }
      }
      const n = ss * ss
      const o = (py * size + px) * 4
      const cov = a / n
      rgba[o] = cov ? Math.round((r / a) * 255) : 0
      rgba[o + 1] = cov ? Math.round((g / a) * 255) : 0
      rgba[o + 2] = cov ? Math.round((b / a) * 255) : 0
      rgba[o + 3] = Math.round(cov)
    }
  }
  return rgba
}


const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const images = SIZES.map((size) => ({ size, data: png(size, render(size)) }))
const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = 6 + 16 * images.length
const entries = images.map(({ size, data }) => {
  const e = Buffer.alloc(16)
  e[0] = size >= 256 ? 0 : size
  e[1] = size >= 256 ? 0 : size
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += data.length
  return e
})
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]))
writeFileSync(OUT.replace(/\.ico$/, '-256.png'), images.at(-1).data)
console.log(`wrote ${OUT}`)
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public')
for (const size of [192, 512]) writeFileSync(path.join(PUBLIC, `icon-${size}.png`), png(size, render(size)))
console.log(`wrote ${PUBLIC}/icon-{192,512}.png`)
const ASSETS = path.dirname(OUT)
writeFileSync(path.join(ASSETS, 'ccm-mac.png'), png(1024, render(1024, { inset: 100, radius: 230 })))
writeFileSync(path.join(ASSETS, 'ccmTrayTemplate.png'), png(16, render(16, { glyph: true })))
writeFileSync(path.join(ASSETS, 'ccmTrayTemplate@2x.png'), png(32, render(32, { glyph: true })))
console.log(`wrote ${ASSETS}/ccm-mac.png, ccmTrayTemplate{,@2x}.png`)
