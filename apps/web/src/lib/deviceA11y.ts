import type { DevUiNode } from '@ccm/shared'
import { sanitize } from './agentHandoff'
import { boundsText, hasArea, idName, shortClass } from './deviceInspect'

export type A11yKind = 'no-label' | 'small-target' | 'low-contrast' | 'dup-label'

export interface A11yFinding {
  kind: A11yKind
  node: number
  /** small-target: size in dp. */
  wDp?: number
  hDp?: number
  /** low-contrast: estimated WCAG ratio, foreground / background as #rrggbb. */
  ratio?: number
  fg?: string
  bg?: string
  /** dup-label: the shared content description. */
  label?: string
}

/** RGBA, row-major (canvas `ImageData`). */
export interface Pixels {
  width: number
  height: number
  data: ArrayLike<number>
}

export type ContrastState = 'done' | 'no-image' | 'black'

export interface A11yReport {
  findings: A11yFinding[]
  density: number | null
  contrast: ContrastState
  truncated: boolean
}

export const MIN_TARGET_DP = 48
export const CONTRAST_NORMAL = 4.5
export const CONTRAST_LARGE = 3
export const FINDINGS_MAX = 200
const SAMPLES_MAX = 4096
const SYSTEM_PKGS = new Set(['com.android.systemui'])
// Focusable-only nodes count as controls only for these classes: scroll containers and lists are focusable too.
const CONTROL_CLASS = /Image|Button|CheckBox|Switch|Radio|Toggle|Chip|SeekBar|Spinner/
const KIND_ORDER: A11yKind[] = ['no-label', 'small-target', 'low-contrast', 'dup-label']

const own = (n: DevUiNode): boolean => !!(n.text.trim() || n.desc.trim())
const isControl = (n: DevUiNode): boolean => n.clickable || (!!n.focusable && CONTROL_CLASS.test(shortClass(n.cls)))

function linear(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(...a)
  const lb = luminance(...b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const hex = (c: [number, number, number]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** Nearly every sampled pixel black: a secure window or a screen that was off. */
export function isBlack(px: Pixels): boolean {
  const total = px.width * px.height
  if (!total) return true
  const step = Math.max(1, Math.floor(total / SAMPLES_MAX))
  let dark = 0
  let n = 0
  for (let i = 0; i < total; i += step, n++) {
    const o = i * 4
    if (Math.max(px.data[o]!, px.data[o + 1]!, px.data[o + 2]!) < 10) dark++
  }
  return dark / n >= 0.98
}

/**
 * Dominant colour of the box = background; foreground = among the other colours with at least a quarter of the
 * most common one's count, the one farthest from the background (anti-aliased edges would understate the ratio).
 * Null when too few pixels differ from the background to be text.
 */
export function estimateContrast(px: Pixels, box: [number, number, number, number]): { ratio: number; fg: [number, number, number]; bg: [number, number, number] } | null {
  const x0 = Math.max(0, Math.floor(box[0]) + 1)
  const y0 = Math.max(0, Math.floor(box[1]) + 1)
  const x1 = Math.min(px.width, Math.ceil(box[2]) - 1)
  const y1 = Math.min(px.height, Math.ceil(box[3]) - 1)
  const w = x1 - x0
  const h = y1 - y0
  if (w < 2 || h < 2) return null
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / SAMPLES_MAX)))
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  let total = 0
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const o = (y * px.width + x) * 4
      const r = px.data[o]!
      const g = px.data[o + 1]!
      const b = px.data[o + 2]!
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      bin.n++
      bin.r += r
      bin.g += g
      bin.b += b
      bins.set(key, bin)
      total++
    }
  }
  const avg = (v: { n: number; r: number; g: number; b: number }): [number, number, number] => [v.r / v.n, v.g / v.n, v.b / v.n]
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n)
  const bg = avg(sorted[0]!)
  const others = sorted.slice(1).filter((v) => contrastRatio(avg(v), bg) >= 1.25)
  const ink = others.reduce((sum, v) => sum + v.n, 0)
  if (!others.length || ink / total < 0.03) return null
  const floor = others[0]!.n / 4
  let fg = avg(others[0]!)
  let best = contrastRatio(fg, bg)
  for (const v of others) {
    if (v.n < floor) continue
    const c = avg(v)
    const r = contrastRatio(c, bg)
    if (r > best) {
      best = r
      fg = c
    }
  }
  return { ratio: Math.round(best * 100) / 100, fg, bg }
}

export interface A11yInput {
  /** dpi from `wm density`; null = touch targets are not checked. */
  density: number | null
  /** Screen size in dump coordinates (the screenshot size). */
  screen: { width: number; height: number }
  pixels: Pixels | null
}

/** Findings over a `uiautomator` dump, in node order. System UI (status / navigation bar) is skipped. */
export function a11yCheck(nodes: readonly DevUiNode[], input: A11yInput): A11yReport {
  const { screen, pixels } = input
  const density = input.density && input.density > 0 ? input.density : null
  const onScreen = (n: DevUiNode): boolean =>
    hasArea(n) && n.bounds[2] > 0 && n.bounds[3] > 0 && n.bounds[0] < screen.width && n.bounds[1] < screen.height && !SYSTEM_PKGS.has(n.pkg)
  const labelled = nodes.map(own)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const p = nodes[i]!.parent
    if (labelled[i] && p >= 0 && p < i) labelled[p] = true
  }
  const contrast: ContrastState = !pixels ? 'no-image' : isBlack(pixels) ? 'black' : 'done'
  const sx = pixels ? pixels.width / Math.max(1, screen.width) : 1
  const sy = pixels ? pixels.height / Math.max(1, screen.height) : 1
  const out: A11yFinding[] = []
  const seen = new Map<string, number>()

  nodes.forEach((n, i) => {
    if (!onScreen(n)) return
    const control = isControl(n)
    if (control && !labelled[i]) out.push({ kind: 'no-label', node: i })
    if (control && density) {
      const dp = density / 160
      const wDp = Math.round((n.bounds[2] - n.bounds[0]) / dp)
      const hDp = Math.round((n.bounds[3] - n.bounds[1]) / dp)
      if (wDp < MIN_TARGET_DP || hDp < MIN_TARGET_DP) out.push({ kind: 'small-target', node: i, wDp, hDp })
    }
    if (contrast === 'done' && pixels && n.text.trim()) {
      const box: [number, number, number, number] = [n.bounds[0] * sx, n.bounds[1] * sy, n.bounds[2] * sx, n.bounds[3] * sy]
      const est = estimateContrast(pixels, box)
      if (est && est.ratio < CONTRAST_NORMAL) out.push({ kind: 'low-contrast', node: i, ratio: est.ratio, fg: hex(est.fg), bg: hex(est.bg) })
    }
    const desc = n.desc.trim().toLowerCase()
    if (control && desc) {
      const key = `${n.parent}\u0000${desc}`
      if (seen.has(key)) out.push({ kind: 'dup-label', node: i, label: n.desc.trim() })
      else seen.set(key, i)
    }
  })
  out.sort((a, b) => a.node - b.node || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
  return { findings: out.slice(0, FINDINGS_MAX), density, contrast, truncated: out.length > FINDINGS_MAX }
}

export function a11yCounts(findings: readonly A11yFinding[]): Record<A11yKind, number> {
  const c: Record<A11yKind, number> = { 'no-label': 0, 'small-target': 0, 'low-contrast': 0, 'dup-label': 0 }
  for (const f of findings) c[f.kind]++
  return c
}

/** How the node is named in a prompt: `@id/name`, else its text / description, else class + bounds. */
export function nodeRef(n: DevUiNode): string {
  if (n.resId) return `@id/${idName(n.resId).replace(/^android:id\//, 'android:')}`
  const text = sanitize(n.text || n.desc, 60)
  return text ? `"${text}"` : `${shortClass(n.cls) || 'view'} ${boundsText(n.bounds)}`
}

function problem(f: A11yFinding): string {
  switch (f.kind) {
    case 'no-label':
      return 'no text or contentDescription for screen readers'
    case 'small-target':
      return `touch target ${f.wDp}×${f.hDp} dp, needs ${MIN_TARGET_DP}×${MIN_TARGET_DP} dp`
    case 'low-contrast':
      return `text contrast about ${f.ratio}:1 (${f.fg} on ${f.bg}, estimated from the screenshot), needs ${CONTRAST_NORMAL}:1 (${CONTRAST_LARGE}:1 for large text)`
    case 'dup-label':
      return `same contentDescription as a sibling: "${sanitize(f.label ?? '', 60)}"`
  }
}

export const PROMPT_MAX = 6000

/** Prefill text (never submitted): one line per finding with the files where its id / text was found. */
export function a11yPrompt(nodes: readonly DevUiNode[], findings: readonly A11yFinding[], device: string, hits: ReadonlyMap<number, string[]>): string {
  const head = `Fix these accessibility problems found on ${sanitize(device, 80)} (Orrery check of the view tree and screenshot):`
  const lines: string[] = []
  let size = head.length
  let i = 0
  for (; i < findings.length; i++) {
    const f = findings[i]!
    const n = nodes[f.node]
    if (!n) continue
    const files = hits.get(f.node) ?? []
    const line = `- ${nodeRef(n)} (${shortClass(n.cls) || 'view'}) · ${problem(f)}${files.length ? ` · ${files.map((p) => `@${p}`).join(', ')}` : ''}`
    if (size + line.length + 1 > PROMPT_MAX - 40) break
    lines.push(line)
    size += line.length + 1
  }
  if (i < findings.length) lines.push(`… ${findings.length - i} more`)
  return [head, ...lines].join('\n')
}
