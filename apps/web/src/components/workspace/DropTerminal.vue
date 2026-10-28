<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderInput, RotateCw, SquareTerminal, X } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import '@xterm/xterm/css/xterm.css'
import type { PtyServerMessage } from '@ccm/shared'
import { fontEntry, termFontStack } from '../../lib/fonts'
import { shortPath } from '../../lib/format'
import { isMac } from '../../lib/platform'
import { PtyConnection } from '../../lib/ptyClient'
import { useSettingsStore } from '../../stores/settings'

/**
 * Ctrl+` shell (v70): its own xterm + PTY session, outside the pane store, so it never shows in tabs, the rail,
 * Mission Control or the saved layout. Hidden with v-show: the shell keeps running until the workspace unmounts.
 */
const props = defineProps<{ open: boolean; cwd: string | null }>()
const emit = defineEmits<{ hide: [] }>()
const { t } = useI18n()
const settings = useSettingsStore()

type State = 'starting' | 'running' | 'exited' | 'error'
const state = ref<State>('starting')
const exitCode = ref<number | null>(null)
const shellCwd = ref<string | null>(null)
const host = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let webgl: WebglAddon | null = null
let conn: PtyConnection | null = null
let resizeObserver: ResizeObserver | null = null
let refitTimer: ReturnType<typeof setTimeout> | null = null
let returnFocus: HTMLElement | null = null

const keyLabel = isMac ? '⌃`' : 'Ctrl+`'
const elsewhere = computed(() => !!props.cwd && !!shellCwd.value && props.cwd !== shellCwd.value)

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const
function theme(): Terminal['options']['theme'] {
  const ansi: Record<string, string> = {}
  ANSI.forEach((name, i) => {
    ansi[name] = cssVar(`--ccm-ansi-${i}`)
    ansi[`bright${name.charAt(0).toUpperCase()}${name.slice(1)}`] = cssVar(`--ccm-ansi-${i + 8}`)
  })
  return {
    ...ansi,
    background: cssVar('--ccm-well'),
    foreground: cssVar('--ccm-well-ink'),
    cursor: cssVar('--ccm-accent'),
    cursorAccent: cssVar('--ccm-well'),
    selectionBackground: cssVar('--ccm-well-selection'),
    selectionInactiveBackground: cssVar('--ccm-well-selection'),
  }
}

function setRenderer(on: boolean): void {
  if (!term) return
  if (on && !webgl) {
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => setRenderer(false))
      term.loadAddon(webgl)
    } catch {
      webgl = null
    }
  } else if (!on && webgl) {
    webgl.dispose()
    webgl = null
  }
}

function refit(): void {
  if (!props.open || !fit || !host.value?.offsetWidth) return
  try {
    fit.fit()
  } catch {
    // not laid out yet
  }
}

function onMessage(msg: PtyServerMessage): void {
  if (msg.t === 'ready') {
    state.value = 'running'
    shellCwd.value = msg.cwd
    if (term) conn?.resize(term.cols, term.rows)
    if (props.open) term?.focus()
  } else if (msg.t === 'exit') {
    state.value = 'exited'
    exitCode.value = msg.code
  } else if (msg.t === 'error' || msg.t === 'gone') state.value = 'error'
}

async function start(cwd: string | null): Promise<void> {
  if (conn?.isOpen) conn.kill()
  conn?.close()
  state.value = 'starting'
  exitCode.value = null
  shellCwd.value = cwd
  term?.reset()
  const mine = new PtyConnection({
    onOutput: (bytes) => term?.write(bytes),
    onMessage,
    onClose: () => {
      if (conn === mine && (state.value === 'running' || state.value === 'starting')) state.value = 'error'
    },
  })
  conn = mine
  try {
    await mine.open({ spawn: { preset: 'shell', cwd: cwd ?? undefined } }, term?.cols ?? 80, term?.rows ?? 24)
  } catch {
    if (conn === mine) state.value = 'error'
  }
}

const restart = (): void => void start(props.cwd ?? shellCwd.value)

function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

function onKey(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return true
  if (state.value === 'exited' && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    restart()
    return false
  }
  const key = e.key.toLowerCase()
  if (key === 'c' && !e.altKey && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey) && term?.hasSelection()) {
    e.preventDefault()
    copyText(term.getSelection())
    term.clearSelection()
    return false
  }
  if (!isMac && e.ctrlKey && !e.altKey && key === 'v') {
    e.preventDefault()
    void navigator.clipboard
      .readText()
      .then((text) => text && term?.paste(text))
      .catch(() => undefined)
    return false
  }
  return true
}

watch(
  () => props.open,
  async (open) => {
    setRenderer(open)
    if (open) {
      const active = document.activeElement as HTMLElement | null
      returnFocus = active && !root.value?.contains(active) ? active : null
      await nextTick()
      refit()
      term?.focus()
      return
    }
    if (root.value?.contains(document.activeElement)) returnFocus?.focus?.()
    returnFocus = null
  },
)

watch(
  () => settings.theme,
  async () => {
    await nextTick()
    if (term) term.options.theme = theme()
  },
)

async function applyCodeFont(): Promise<void> {
  const { codeFont: id, codeFontSize: size } = settings
  const entry = fontEntry('code', id)
  if (entry.family) await document.fonts.load(`${size}px '${entry.family}'`).catch(() => undefined)
  if (!term || id !== settings.codeFont || size !== settings.codeFontSize) return
  term.options.fontFamily = termFontStack(entry)
  term.options.fontSize = size
  term.clearTextureAtlas()
  refit()
}
watch(() => [settings.codeFont, settings.codeFontSize] as const, () => void applyCodeFont())

onMounted(() => {
  term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: termFontStack(fontEntry('code', 'system')),
    fontSize: settings.codeFontSize,
    lineHeight: 1.25,
    scrollback: 5000,
    smoothScrollDuration: 0,
    minimumContrastRatio: 4.5,
    macOptionClickForcesSelection: true,
    theme: theme(),
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new UnicodeGraphemesAddon())
  term.unicode.activeVersion = '15-graphemes'
  term.open(host.value!)
  term.attachCustomKeyEventHandler(onKey)
  term.onData((data) => conn?.write(data))
  term.onBinary((data) => conn?.writeBinary(data))
  term.onResize(({ cols, rows }) => conn?.resize(cols, rows))
  setRenderer(props.open)
  refit()
  void applyCodeFont()
  resizeObserver = new ResizeObserver(() => {
    if (refitTimer) clearTimeout(refitTimer)
    refitTimer = setTimeout(() => {
      refitTimer = null
      refit()
    }, 100)
  })
  resizeObserver.observe(host.value!)
  void start(props.cwd)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (refitTimer) clearTimeout(refitTimer)
  // Nothing can attach to this session again: the shell goes with the view.
  if (conn?.isOpen) conn.kill()
  conn?.close()
  webgl?.dispose()
  term?.dispose()
})
</script>

<template>
  <Transition name="ccm-drop">
    <section
      v-show="open"
      ref="root"
      class="absolute inset-x-0 top-0 z-40 flex h-[40%] min-h-48 flex-col overflow-hidden rounded-b-card border-b border-line bg-well shadow-card"
      :aria-label="t('workspace.dropTerm.title')"
      data-drop-term
    >
      <div class="ccm-material flex h-8 shrink-0 items-center gap-1.5 border-b border-line px-2 select-none">
        <SquareTerminal :size="14" class="shrink-0 text-agent-shell" aria-hidden="true" />
        <span class="shrink-0 text-xs font-semibold text-ink">{{ t('workspace.dropTerm.title') }}</span>
        <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint" dir="rtl" :title="shellCwd ?? ''">
          <bdi>{{ shellCwd ? shortPath(shellCwd) : '' }}</bdi>
        </span>
        <span v-if="state === 'starting'" class="shrink-0 text-2xs text-ink-muted" role="status">{{ t('workspace.rail.state.starting') }}</span>
        <span v-else-if="state === 'exited'" class="shrink-0 text-2xs text-ink-muted" role="status" data-drop-term-ended>{{ t('workspace.dropTerm.ended', { code: exitCode ?? 0 }) }}</span>
        <span v-else-if="state === 'error'" class="shrink-0 text-2xs text-st-error" role="alert">{{ t('workspace.dropTerm.failed') }}</span>
        <button v-if="elsewhere" type="button" class="ccm-btn-plain shrink-0 gap-1 text-2xs" :title="t('workspace.dropTerm.hereHint', { path: cwd ?? '' })" data-drop-term-here @click="start(cwd)">
          <FolderInput :size="13" aria-hidden="true" /><span>{{ t('workspace.dropTerm.here') }}</span>
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.restart')" :aria-label="t('workspace.restart')" @click="restart">
          <RotateCw :size="13" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.dropTerm.hide', { key: keyLabel })" :aria-label="t('workspace.dropTerm.hide', { key: keyLabel })" data-drop-term-hide @click="emit('hide')">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <div ref="host" class="min-h-0 flex-1 px-2 pt-1" />
    </section>
  </Transition>
</template>

<style scoped>
.ccm-drop-enter-active {
  transition:
    translate var(--ccm-dur-base) var(--ease-out-quint),
    opacity var(--ccm-dur-base) var(--ease-out-quint);
}
.ccm-drop-leave-active {
  transition:
    translate var(--ccm-dur-fast) var(--ease-exit),
    opacity var(--ccm-dur-fast) var(--ease-exit);
}
.ccm-drop-enter-from,
.ccm-drop-leave-to {
  translate: 0 -100%;
  opacity: 0;
}
</style>
