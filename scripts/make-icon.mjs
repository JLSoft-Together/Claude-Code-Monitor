// Rasterizes the favicon strokes into scripts/assets/ccm.ico (PNG-in-ICO, Vista+) and the PWA icons in apps/web/public. Zero dependencies.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'ccm.ico')
const SIZES = [16, 24, 32, 48, 64, 256]
const BG = [250, 249, 246]
const ACCENT = [180, 83, 47]
const INK = [27, 27, 25]

function arc(cx, cy, r, from, to, steps = 96) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

const deg = (d) => (d * Math.PI) / 180
// Same geometry as apps/web/public/favicon.svg (viewBox 128).
const STROKES = [
  { color: ACCENT, width: 8, lines: [arc(64, 64, 50, deg(-90), deg(-360))] },
  { color: INK, width: 8, lines: [arc(64, 64, 47, deg(-90), Math.atan2(45 - 64, 107 - 64))] },
  { color: INK, width: 7, lines: [[[48, 53], [63, 64], [48, 75]], [[67, 76], [81, 76]]] },
  {
    color: ACCENT,
    width: 4,
    lines: [
      [[64, 35], [64, 42]], [[64, 86], [64, 93]], [[42, 64], [49, 64]], [[79, 64], [86, 64]],
      [[48, 49], [53, 54]], [[75, 76], [80, 81]], [[80, 49], [75, 54]], [[53, 76], [48, 81]],
    ],
  },
]

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

function strokeDist(stroke, x, y) {
  let d = Infinity
  for (const line of stroke.lines) for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(x, y, line[i - 1], line[i]))
  return d
}

function insideRoundRect(x, y, r) {
  const cx = Math.max(r, Math.min(128 - r, x))
  const cy = Math.max(r, Math.min(128 - r, y))
  return Math.hypot(x - cx, y - cy) <= r
}

function render(size) {
  const ss = size <= 32 ? 6 : 4
  const scale = 128 / size
  const rgba = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * scale
          const y = (py + (sy + 0.5) / ss) * scale
          if (!insideRoundRect(x, y, 28)) continue
          let c = BG
          for (const s of STROKES) if (strokeDist(s, x, y) <= s.width / 2) c = s.color
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
