<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleDot, Columns2, GitBranch, LoaderCircle, RotateCw, X } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import '@xterm/xterm/css/xterm.css'
import type { PtyPreset, PtyServerMessage } from '@ccm/shared'
import { shortPath } from '../../lib/format'
import { contextPctOf } from '../../lib/provider'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { isMac } from '../../lib/platform'
import { PtyConnection, type PtyStart } from '../../lib/ptyClient'
import { useAgentsStore } from '../../stores/agents'
import { useSettingsStore } from '../../stores/settings'
import { useTerminalsStore } from '../../stores/terminals'
import { useWorkspaceStore, type Pane } from '../../stores/workspace'
import ContextGauge from '../ContextGauge.vue'
import StatusBadge from '../StatusBadge.vue'
import PresetIcon from './PresetIcon.vue'
import SplitMenu from './SplitMenu.vue'
import WorktreeMenu from './WorktreeMenu.vue'

const props = defineProps<{ pane: Pane; visible: boolean; focused: boolean; multi: boolean }>()
const emit = defineEmits<{ split: [preset: PtyPreset] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const { isBusy } = usePaneInfo()
const terminals = useTerminalsStore()
const agents = useAgentsStore()

const host = ref<HTMLElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let webgl: WebglAddon | null = null
let conn: PtyConnection | null = null
let resizeObserver: ResizeObserver | null = null
let restoredOnMount = false

const status = computed(() => {
  switch (props.pane.state) {
    case 'starting':
      return { icon: LoaderCircle, label: t('workspace.state.starting'), cls: 'text-ink-faint', spin: true }
    case 'running':
      return { icon: CircleDot, label: t('workspace.state.running'), cls: 'text-st-done', spin: false }
    case 'exited':
      return { icon: CircleCheck, label: t('workspace.state.exited', { code: props.pane.exitCode ?? 0 }), cls: 'text-st-idle', spin: false }
    default:
      return { icon: CircleAlert, label: props.pane.error ?? t('workspace.state.error'), cls: 'text-st-error', spin: false }
  }
})

const session = computed(() => {
  const term = props.pane.terminalId ? terminals.byId[props.pane.terminalId] : undefined
  return term && term.status !== 'stale' ? term : undefined
})
const mainAgent = computed(() => (session.value ? agents.mainOf(session.value.id) : undefined))
const context = computed(() => {
  const a = mainAgent.value
  return a?.contextTokens && a.contextWindow ? { tokens: a.contextTokens, window: a.contextWindow, pct: contextPctOf(a) } : null
})
const branch = computed(() => session.value?.gitBranch || props.pane.branch)
const wtAnchor = ref<DOMRect | null>(null)
const wtButton = ref<HTMLButtonElement | null>(null)

function toggleWorktrees(): void {
  wtAnchor.value = wtAnchor.value ? null : (wtButton.value?.getBoundingClientRect() ?? null)
}

function closeWorktrees(): void {
  wtAnchor.value = null
  wtButton.value?.focus()
}

const splitAnchor = ref<DOMRect | null>(null)
const splitButton = ref<HTMLButtonElement | null>(null)

function toggleSplit(): void {
  splitAnchor.value = splitAnchor.value ? null : (splitButton.value?.getBoundingClientRect() ?? null)
}

const sessionTitle = computed(() => session.value?.alias || session.value?.title || '')

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function theme(): Terminal['options']['theme'] {
  return {
    background: cssVar('--ccm-well'),
    foreground: cssVar('--ccm-well-ink'),
    cursor: cssVar('--ccm-accent'),
    cursorAccent: cssVar('--ccm-well'),
    selectionBackground: cssVar('--ccm-accent-soft'),
  }
}

// WebGL contexts are scarce (browsers cap ~16) and heavy; only the pane on screen holds one.
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
  if (!props.visible || !fit || !host.value?.offsetWidth) return
  try {
    fit.fit()
  } catch {
    // container not laid out yet
  }
}

async function paste(textOnly: boolean): Promise<void> {
  try {
    // Claude Code reads clipboard images itself on ^V, so forward the raw key when one is there.
    if (!textOnly) {
      const items = await navigator.clipboard.read()
      if (items.some((it) => it.types.some((type) => type.startsWith('image/')))) return conn?.write('\x16')
    }
    const text = await navigator.clipboard.readText()
    if (text) term?.paste(text)
  } catch {
    // clipboard permission denied or empty
  }
}

function onKey(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return true
  // Ink (Claude Code) reads ESC+CR as a newline inside the prompt instead of submit.
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    conn?.write('\x1b\r')
    return false
  }
  if (isMac) return true
  const key = e.key.toLowerCase()
  if (e.ctrlKey && !e.altKey && key === 'c' && term?.hasSelection()) {
    void navigator.clipboard.writeText(term.getSelection())
    term.clearSelection()
    return false
  }
  if (e.ctrlKey && !e.altKey && key === 'v') {
    e.preventDefault()
    void paste(e.shiftKey)
    return false
  }
  return true
}

function onMessage(msg: PtyServerMessage): void {
  const key = props.pane.key
  switch (msg.t) {
    case 'ready':
      // Only folders the user picked go to the recent list; the home default is always one click away.
      if (props.pane.cwd && !msg.replay) workspace.remember(msg.cwd)
      workspace.update(key, { sessionId: msg.id, pid: msg.pid || undefined, cwd: msg.cwd, state: 'running', error: undefined })
      if (term) conn?.resize(term.cols, term.rows)
      if (props.visible && props.focused) term?.focus()
      break
    case 'pid':
      workspace.update(key, { pid: msg.pid })
      break
    case 'branch':
      workspace.update(key, { branch: msg.branch ?? undefined })
      break
    case 'exit':
      workspace.update(key, { state: 'exited', exitCode: msg.code })
      break
    case 'gone':
      // A new app run has a new PTY host: a pane restored from a previous run has nothing to attach to.
      if (restoredOnMount) workspace.remove(key)
      else workspace.update(key, { state: 'gone', error: t('workspace.state.gone') })
      break
    case 'error':
      if (msg.message === 'cwd' && props.pane.cwd) workspace.forget(props.pane.cwd)
      workspace.update(key, { state: 'error', error: t(`workspace.error.${msg.message}`) })
      break
  }
}

async function connect(start: PtyStart): Promise<void> {
  conn?.close()
  conn = new PtyConnection({
    onOutput: (bytes) => term?.write(bytes),
    onMessage,
    onClose: () => {
      if (props.pane.state === 'running' || props.pane.state === 'starting')
        workspace.update(props.pane.key, { state: 'error', error: t('workspace.state.disconnected') })
    },
  })
  try {
    await conn.open(start, term?.cols ?? 80, term?.rows ?? 24)
  } catch {
    workspace.update(props.pane.key, { state: 'error', error: t('workspace.state.unavailable') })
  }
}

function killSession(): void {
  const id = props.pane.sessionId
  if (conn?.isOpen) conn.kill()
  else if (id) void PtyConnection.killById(id)
}

function restart(): void {
  killSession()
  restoredOnMount = false
  term?.reset()
  workspace.update(props.pane.key, { state: 'starting', sessionId: undefined, pid: undefined, terminalId: undefined, branch: undefined, exitCode: undefined, error: undefined })
  void connect({ spawn: { preset: props.pane.preset, cwd: props.pane.cwd, resume: props.pane.resume } })
}

function reconnect(): void {
  if (!props.pane.sessionId) return restart()
  restoredOnMount = false
  term?.reset()
  workspace.update(props.pane.key, { state: 'starting', error: undefined })
  void connect({ attach: props.pane.sessionId })
}

function close(): void {
  workspace.requestClose([props.pane.key], isBusy)
}

onMounted(() => {
  term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 5000,
    smoothScrollDuration: 0,
    theme: theme(),
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  // Graphemes, not unicode11: Vietnamese NFD output from Claude otherwise drifts the cursor.
  term.loadAddon(new UnicodeGraphemesAddon())
  term.unicode.activeVersion = '15-graphemes'
  term.open(host.value!)
  term.attachCustomKeyEventHandler(onKey)
  term.onData((data) => conn?.write(data))
  term.onBinary((data) => conn?.writeBinary(data))
  term.onResize(({ cols, rows }) => conn?.resize(cols, rows))
  term.textarea?.addEventListener('focus', () => workspace.activate(props.pane.key))
  setRenderer(props.visible)
  refit()
  resizeObserver = new ResizeObserver(() => refit())
  resizeObserver.observe(host.value!)

  restoredOnMount = !!props.pane.sessionId
  void connect(props.pane.sessionId ? { attach: props.pane.sessionId } : { spawn: { preset: props.pane.preset, cwd: props.pane.cwd, resume: props.pane.resume } })
})

watch(
  () => props.visible,
  async (visible) => {
    setRenderer(visible)
    if (!visible) return
    await nextTick()
    refit()
    if (props.focused) term?.focus()
  },
)

watch(
  () => props.focused,
  (focused) => {
    if (focused && props.visible) term?.focus()
  },
)

watch(
  () => settings.theme,
  async () => {
    await nextTick()
    if (term) term.options.theme = theme()
  },
)

// Leaving the view only detaches; a pane gone from the store was closed, so its process goes too.
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (!workspace.panes.some((p) => p.key === props.pane.key)) killSession()
  conn?.close()
  webgl?.dispose()
  term?.dispose()
})
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-col gap-1.5" :aria-label="t(`workspace.preset.${pane.preset}`)" @pointerdown="workspace.activate(pane.key)">
    <header class="flex h-7 min-w-0 items-center gap-2 px-1 text-xs">
      <PresetIcon :preset="pane.preset" :size="15" class="shrink-0 text-ink-muted" />
      <span class="shrink-0 font-semibold text-ink">{{ t(`workspace.preset.${pane.preset}`) }}</span>
      <span v-if="pane.cwd" class="min-w-0 shrink truncate text-ink-faint" :title="pane.cwd">{{ shortPath(pane.cwd) }}</span>
      <button
        v-if="pane.cwd && pane.state === 'running'"
        ref="wtButton"
        type="button"
        class="inline-flex h-6 min-w-0 shrink cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-ink-faint hover:bg-fill hover:text-ink aria-expanded:bg-fill aria-expanded:text-ink"
        :title="t('workspace.wt.title')"
        aria-haspopup="dialog"
        :aria-expanded="!!wtAnchor"
        @click="toggleWorktrees"
      >
        <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
        <span v-if="branch" class="max-w-[16ch] truncate">{{ branch }}</span>
        <span v-else class="sr-only">{{ t('workspace.wt.title') }}</span>
      </button>
      <WorktreeMenu v-if="wtAnchor && pane.cwd" :cwd="pane.cwd" :anchor="wtAnchor" :trigger="wtButton" @close="closeWorktrees" />
      <span v-if="session && sessionTitle" class="hidden min-w-0 flex-1 truncate text-ink-muted lg:inline" :title="sessionTitle">{{ sessionTitle }}</span>
      <span class="ml-auto" aria-hidden="true" />
      <ContextGauge v-if="context" class="hidden w-24 shrink-0 sm:block" :tokens="context.tokens" :window="context.window" :pct="context.pct" compact />
      <StatusBadge v-if="session && pane.state === 'running'" :status="session.status" />
      <span v-else class="inline-flex shrink-0 items-center gap-1" :class="status.cls">
        <component :is="status.icon" :size="13" :class="status.spin ? 'ccm-spin' : ''" aria-hidden="true" />
        <span>{{ status.label }}</span>
      </span>
      <button
        v-if="pane.state === 'error' && pane.sessionId"
        type="button"
        class="ccm-btn-plain shrink-0"
        :title="t('workspace.reconnect')"
        :aria-label="t('workspace.reconnect')"
        @click="reconnect"
      >
        <RotateCw :size="14" aria-hidden="true" />
      </button>
      <button v-else type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.restart')" :aria-label="t('workspace.restart')" @click="restart">
        <RotateCw :size="14" aria-hidden="true" />
      </button>
      <button
        ref="splitButton"
        type="button"
        class="ccm-btn-plain shrink-0 aria-expanded:bg-fill"
        :title="t('workspace.splitPane')"
        :aria-label="t('workspace.splitPane')"
        aria-haspopup="menu"
        :aria-expanded="!!splitAnchor"
        @click="toggleSplit"
      >
        <Columns2 :size="14" aria-hidden="true" />
      </button>
      <SplitMenu v-if="splitAnchor" :anchor="splitAnchor" :current="pane.preset" :trigger="splitButton" @pick="(p) => emit('split', p)" @close="splitAnchor = null" />
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.close')" :aria-label="t('workspace.close')" @click="close">
        <X :size="14" aria-hidden="true" />
      </button>
    </header>
    <div
      class="min-h-0 flex-1 overflow-hidden rounded-card bg-well p-2 shadow-card outline-1 -outline-offset-1 transition-[outline-color] duration-150"
      :class="multi && focused ? 'outline-accent' : 'outline-transparent'"
    >
      <div ref="host" class="size-full" />
    </div>
  </section>
</template>
