<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CodeToken, Match } from '../../lib/codeView'
import type { Block } from '../../lib/diffBlocks'
import { useSettingsStore } from '../../stores/settings'

const props = defineProps<{
  lines: readonly string[]
  tokens: readonly CodeToken[][] | null
  /** The code view's scroll container; rows are found inside `content`. */
  scroller: HTMLElement | null
  /** Element whose children are the rendered rows, one per line, in order. */
  content: HTMLElement | null
  matches: readonly Match[]
  current: number
  targetLine: number | null
  /** Change blocks vs HEAD: coloured bars along the left edge. */
  changes?: readonly Pick<Block, 'line1' | 'line2' | 'type'>[]
  /** Windowed code view: row offsets computed, not read from rows that may not be rendered. */
  geometry?: { top: (line: number) => number; at: (y: number) => number } | null
}>()

const WIDTH = 96
const PAD = 6
const MAX_COLS = WIDTH - PAD * 2
const TAB = 4

const settings = useSettingsStore()
const wrapEl = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const probe = ref<HTMLElement | null>(null)
const slider = ref({ top: 0, height: 0 })
const dragging = ref(false)

const colors = new Map<string, string>()
let offset = 0
let pitch = 2
let raf = 0
let drag: { y: number; scrollTop: number } | null = null

/** Resolves a theme colour expression (shiki `var(--…)`) to something canvas accepts. */
function resolve(expr: string): string {
  let hit = colors.get(expr)
  if (hit) return hit
  const el = probe.value
  if (!el) return 'transparent'
  el.style.color = expr
  hit = getComputedStyle(el).color
  colors.set(expr, hit)
  return hit
}

const tokenColor = (c: string | undefined): string => resolve(c?.startsWith('var(') ? c : 'var(--shiki-foreground)')

/** Fractional line index at content offset `y` of the scroller (rows may wrap, so measure them). */
function lineAt(y: number): number {
  if (props.geometry) return props.geometry.at(y)
  const rows = props.content?.children
  if (!rows?.length) return 0
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((rows[mid] as HTMLElement).offsetTop <= y) lo = mid
    else hi = mid - 1
  }
  const row = rows[lo] as HTMLElement
  return lo + Math.min(1, Math.max(0, (y - row.offsetTop) / Math.max(1, row.offsetHeight)))
}

function rowTop(line: number): number {
  if (props.geometry) return props.geometry.top(line)
  const rows = props.content?.children
  if (!rows?.length) return 0
  const i = Math.min(rows.length - 1, Math.max(0, Math.floor(line)))
  const row = rows[i] as HTMLElement
  return row.offsetTop + (line - i) * row.offsetHeight
}

function schedule(): void {
  if (!raf) raf = requestAnimationFrame(draw)
}

function draw(): void {
  raf = 0
  const sc = props.scroller
  const cv = canvas.value
  const box = wrapEl.value
  if (!sc || !cv || !box) return
  const dpr = window.devicePixelRatio || 1
  const cssH = box.clientHeight
  const w = Math.round(WIDTH * dpr)
  const h = Math.round(cssH * dpr)
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)

  const rowPx = Math.max(2, Math.round(2 * dpr))
  const blockH = rowPx - 1
  pitch = rowPx / dpr
  const n = props.lines.length
  const total = n * pitch
  const maxScroll = sc.scrollHeight - sc.clientHeight
  offset = total > cssH && maxScroll > 0 ? (sc.scrollTop / maxScroll) * (total - cssH) : 0
  const first = Math.max(0, Math.floor(offset / pitch))
  const last = Math.min(n, Math.ceil((offset + cssH) / pitch) + 1)
  const yOf = (line: number) => Math.round(line * rowPx - offset * dpr)

  // Find hits and the jump target sit behind the text, full width like VS Code's overview.
  if (props.targetLine) {
    const line = props.targetLine - 1
    if (line >= first && line < last) {
      ctx.fillStyle = resolve('var(--ccm-selection)')
      ctx.fillRect(0, yOf(line), w, rowPx)
    }
  }
  if (props.matches.length) {
    ctx.fillStyle = resolve('var(--ccm-selection)')
    let currentLine = -1
    props.matches.forEach((m, i) => {
      if (i === props.current) currentLine = m.line
      else if (m.line >= first && m.line < last) ctx.fillRect(0, yOf(m.line), w, rowPx)
    })
    if (currentLine >= first && currentLine < last) {
      ctx.fillStyle = resolve('var(--ccm-waiting)')
      ctx.fillRect(0, yOf(currentLine), w, rowPx)
    }
  }

  for (const c of props.changes ?? []) {
    const to = Math.max(c.line2, c.line1 + 1)
    if (to <= first || c.line1 >= last) continue
    ctx.fillStyle = resolve(c.type === 'added' ? 'var(--ccm-diff-add-well)' : c.type === 'deleted' ? 'var(--ccm-diff-del-well)' : 'var(--ccm-diff-mod-well)')
    ctx.fillRect(0, yOf(c.line1), Math.round(3 * dpr), c.type === 'deleted' ? Math.max(2, Math.round(dpr)) : (to - c.line1) * rowPx)
  }

  const x0 = PAD * dpr
  for (let i = first; i < last; i++) {
    const y = yOf(i)
    const toks = props.tokens?.[i] ?? [{ content: props.lines[i] ?? '' }]
    let col = 0
    for (const tok of toks) {
      if (col >= MAX_COLS) break
      ctx.fillStyle = tokenColor(tok.color)
      const s = tok.content
      let run = -1
      for (let k = 0; k < s.length && col < MAX_COLS; k++) {
        const ch = s.charCodeAt(k)
        if (ch === 32 || ch === 9) {
          if (run >= 0) ctx.fillRect(x0 + run * dpr, y, (col - run) * dpr, blockH)
          run = -1
          col += ch === 9 ? TAB - (col % TAB) : 1
        } else {
          if (run < 0) run = col
          col++
        }
      }
      if (run >= 0) ctx.fillRect(x0 + run * dpr, y, (Math.min(col, MAX_COLS) - run) * dpr, blockH)
    }
  }

  const top = lineAt(sc.scrollTop) * pitch - offset
  const bottom = lineAt(sc.scrollTop + sc.clientHeight) * pitch - offset
  slider.value = { top, height: Math.max(4, bottom - top) }
}

function onPointerDown(e: PointerEvent): void {
  const sc = props.scroller
  const box = wrapEl.value
  if (!sc || !box || e.button !== 0) return
  e.preventDefault()
  const y = e.clientY - box.getBoundingClientRect().top
  const { top, height } = slider.value
  if (y < top || y > top + height) {
    sc.scrollTop = rowTop((y + offset) / pitch) - sc.clientHeight / 2
    draw()
  }
  drag = { y: e.clientY, scrollTop: sc.scrollTop }
  dragging.value = true
  box.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  const sc = props.scroller
  const box = wrapEl.value
  if (!drag || !sc || !box) return
  const track = Math.min(props.lines.length * pitch, box.clientHeight) - slider.value.height
  sc.scrollTop = drag.scrollTop + ((e.clientY - drag.y) * (sc.scrollHeight - sc.clientHeight)) / Math.max(1, track)
}

function onPointerUp(): void {
  drag = null
  dragging.value = false
}

function onWheel(e: WheelEvent): void {
  props.scroller?.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY, left: e.deltaX })
}

const resize = new ResizeObserver(schedule)

watch(
  () => [props.scroller, props.content] as const,
  ([sc, content], _old, onCleanup) => {
    sc?.addEventListener('scroll', schedule, { passive: true })
    if (content) resize.observe(content)
    schedule()
    onCleanup(() => {
      sc?.removeEventListener('scroll', schedule)
      if (content) resize.unobserve(content)
    })
  },
  { immediate: true },
)
watch(() => [props.lines, props.tokens, props.matches, props.current, props.targetLine, props.changes], schedule)
watch(
  () => settings.theme,
  () => {
    colors.clear()
    schedule()
  },
  { flush: 'post' },
)

onMounted(() => {
  if (wrapEl.value) resize.observe(wrapEl.value)
  schedule()
})

onBeforeUnmount(() => {
  resize.disconnect()
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div
    ref="wrapEl"
    class="minimap ccm-code relative shrink-0 cursor-default overflow-hidden border-l border-well-line"
    :class="{ 'is-dragging': dragging }"
    :style="{ width: `${WIDTH}px` }"
    aria-hidden="true"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.passive="onWheel"
  >
    <span ref="probe" class="hidden" />
    <canvas ref="canvas" class="absolute inset-0 size-full" />
    <div class="slider absolute inset-x-0" :style="{ top: `${slider.top}px`, height: `${slider.height}px` }" />
  </div>
</template>

<style scoped>
.minimap {
  background: var(--ccm-well);
  color: var(--shiki-foreground);
  touch-action: none;
  user-select: none;
}
.slider {
  background: color-mix(in srgb, var(--ccm-well-ink) 8%, transparent);
  transition: background-color var(--ccm-dur-fast, 120ms) ease-out;
}
.minimap:hover .slider {
  background: color-mix(in srgb, var(--ccm-well-ink) 14%, transparent);
}
.minimap.is-dragging .slider {
  background: color-mix(in srgb, var(--ccm-well-ink) 20%, transparent);
}
</style>
