<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellOff, Check, Clock, Code, FileDiff, FoldVertical, FolderOpen, GitBranch, LoaderCircle, StickyNote, X } from 'lucide-vue-next'
import type { OpenApp, TerminalSession } from '@ccm/shared'
import { formatUsd } from '../lib/attention'
import { compactNumber, duration, fullNumber, now, relativeTime, shortPath } from '../lib/format'
import { modeMeta } from '../lib/mode'
import { openAppKey } from '../lib/platform'
import { effortLabel, modelLabel } from '../lib/model'
import { contextPctOf, isCodex } from '../lib/provider'
import { statusMeta } from '../lib/status'
import { nodeMenu, type NodeAction } from '../lib/mapMenu'
import { isMac } from '../lib/platform'
import { isTyping } from '../lib/shortcuts'
import { useAgentActions } from '../composables/useAgentActions'
import { useBump } from '../composables/useBump'
import { useInlineEdit } from '../composables/useInlineEdit'
import { displayTitle } from '../lib/title'
import { waitDisplay } from '../lib/wait'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { SNOOZE_CHOICES, useSnoozeStore } from '../stores/snooze'
import { useUiStore } from '../stores/ui'
import ContextRing from './ContextRing.vue'
import SessionCardHeader from './SessionCardHeader.vue'
import SessionCardSignals from './SessionCardSignals.vue'
import RunBadge from './workspace/RunBadge.vue'
import ProviderBadge from './ProviderBadge.vue'
import StatusBadge from './StatusBadge.vue'
import SubagentCounts from './SubagentCounts.vue'
import TokenCount from './TokenCount.vue'
import ContextMenu from './ui/ContextMenu.vue'

const props = defineProps<{ terminal: TerminalSession }>()

const { t, locale } = useI18n()
const agents = useAgentsStore()
const ui = useUiStore()
const connection = useConnectionStore()
const extras = useExtrasStore()
const snooze = useSnoozeStore()
const actions = useAgentActions((id) => agents.byTerminal[id] ?? [])
const notice = actions.notice

// The map node menu in its card scope; the cursor anchors it, the menu key anchors it on the card.
const menu = ref<{ at: DOMRect; trigger: HTMLElement | null } | null>(null)
const mainId = computed(() => agents.mainOf(props.terminal.id)?.id)
const menuEntries = computed(() =>
  menu.value
    ? nodeMenu(
        {
          ...actions.menuBase(props.terminal.id, mainId.value),
          scope: 'card',
          children: 0,
          collapsed: false,
          picked: 0,
          detailsOpen: !!mainId.value && ui.selectedAgentId === mainId.value,
        },
        t,
        isMac,
      )
    : [],
)
const CARD_KEYS = isMac ? 'Shift+F10 Meta+C' : 'Shift+F10 Control+C'

/** Windows fires a native `contextmenu` after the ContextMenu / Shift+F10 keydown that already opened the menu. */
const KEY_MENU_ECHO_MS = 300
let keyMenuAt = 0

function onContextMenu(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('input, textarea')) return
  e.preventDefault()
  if (menu.value && performance.now() - keyMenuAt < KEY_MENU_ECHO_MS) return
  const el = e.currentTarget as HTMLElement
  menu.value = { at: e.clientX ? new DOMRect(e.clientX, e.clientY, 0, 0) : el.getBoundingClientRect(), trigger: (document.activeElement as HTMLElement | null) ?? el }
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || isTyping(e.target)) return
  const el = e.currentTarget as HTMLElement
  if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault()
    keyMenuAt = performance.now()
    menu.value = { at: el.getBoundingClientRect(), trigger: (document.activeElement as HTMLElement | null) ?? el }
    return
  }
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyC' && mainId.value && !window.getSelection()?.toString()) {
    e.preventDefault()
    actions.copySummary(mainId.value)
  }
}

function showDetails(): void {
  const id = mainId.value
  if (!id) return
  if (ui.selectedAgentId === id) {
    ui.selectAgent(null)
    return
  }
  ui.setView('monitor')
  ui.mapView = 'map'
  ui.focusTerminal(props.terminal.id)
  ui.selectAgent(id)
}

function onPick(id: string): void {
  if (!actions.run(id as NodeAction, props.terminal.id, mainId.value) && id === 'details') showDetails()
}

const meta = computed(() => statusMeta(props.terminal.status))
const ended = computed(() => props.terminal.status === 'stale')
const main = computed(() => agents.mainOf(props.terminal.id))
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)
const title = computed(() => displayTitle(props.terminal))
const codex = computed(() => isCodex(props.terminal))

const flash = ref(0)
watch(
  () => props.terminal.status,
  (next, prev) => {
    if (prev && next !== prev) flash.value++
  },
)

const age = computed(() => {
  const term = props.terminal
  let label: string | null
  let full: string | null
  if (ended.value) {
    label = relativeTime(term.endedAt, locale.value, now.value)
    full = label ? t('terminal.endedAgo', { ago: label }) : null
  } else {
    label = duration(term.startedAt, now.value)
    full = label ? t('terminal.duration', { duration: label }) : null
  }
  const pid = term.processId ? t('terminal.process', { pid: term.processId }) : null
  const parts = [full, pid, term.shell, term.codexVersion ? t('provider.version', { v: term.codexVersion }) : null].filter((p): p is string => !!p)
  if (!parts.length) return null
  return { label: label ?? parts[0], title: parts.join(' · ') }
})

const wait = computed(() => (props.terminal.status === 'waiting' ? waitDisplay(props.terminal.waitingFor, main.value?.currentTool, t) : null))

const detail = computed(() => {
  const term = props.terminal
  if (term.status === 'waiting') {
    const waited = term.statusSince ? duration(term.statusSince, now.value) : null
    const w = wait.value
    if (w && w.reason !== 'other') return waited ? `${w.text} · ${waited}` : w.text
    if (w && waited) return t('terminal.waitingForSince', { reason: w.text, waited })
    if (w) return t('terminal.waitingFor', { reason: w.text })
    if (waited) return t('terminal.waitingSince', { waited })
  }
  if (main.value?.currentTool) return t('terminal.running', { tool: main.value.currentTool })
  if (term.backgroundShell) return t('terminal.backgroundShell')
  return null
})
const detailKey = computed(() => {
  const term = props.terminal
  return [term.status, wait.value?.reason ?? '', main.value?.currentTool ?? '', term.backgroundShell ? 'bg' : ''].join('|')
})

const modelLine = computed(() => {
  const m = main.value
  if (!m?.model) return null
  const label = modelLabel(m.model, m.contextWindow, extras.modelNames) ?? m.model
  const effort = effortLabel(m.effort, t)
  return effort ? t('sessionV53.modelEffort', { model: label, effort }) : label
})

// A Claude session's total stays Claude-only; Codex runs it started are summed separately (other provider, other quota).
function sumTokens(codexAgents: boolean) {
  let input = 0
  let output = 0
  let cache = 0
  let runs = 0
  let any = false
  for (const a of agents.byTerminal[props.terminal.id] ?? []) {
    if (isCodex(a) !== codexAgents) continue
    if (codexAgents) runs++
    if (a.totalTokens === undefined) continue
    any = true
    input += a.inputTokens ?? 0
    output += a.outputTokens ?? 0
    cache += a.cacheReadTokens ?? 0
  }
  if (!any) return null
  return { total: input + output, input, output, cache, runs }
}
const tokens = computed(() => {
  const sum = sumTokens(codex.value)
  if (!sum) return null
  const counts = { input: fullNumber(sum.input, locale.value), output: fullNumber(sum.output, locale.value), cache: fullNumber(sum.cache, locale.value) }
  return { total: sum.total, title: [modelLine.value, t('terminal.tokensTitle', counts)].filter(Boolean).join('\n') }
})
const codexTokens = computed(() => {
  if (codex.value) return null
  const sum = sumTokens(true)
  if (!sum) return null
  const counts = { input: fullNumber(sum.input, locale.value), output: fullNumber(sum.output, locale.value), cache: fullNumber(sum.cache, locale.value) }
  return { label: compactNumber(sum.total, locale.value), title: t('provider.tokensTitle', { n: sum.runs, ...counts }) }
})

const mode = computed(() => modeMeta(props.terminal.permissionMode))
const modeLabel = computed(() => {
  const m = mode.value
  if (!m) return ''
  return m.labelKey ? t(m.labelKey) : (props.terminal.permissionMode ?? '')
})
const branch = computed(() => {
  const b = props.terminal.gitBranch
  if (!b) return null
  return b === 'HEAD' ? t('terminal.detached') : b
})
const cost = computed(() => (props.terminal.costUsd === undefined ? null : formatUsd(props.terminal.costUsd)))

const diff = computed(() => {
  const d = props.terminal.diff
  if (!d || (!d.files && !d.untracked)) return null
  const checked = relativeTime(d.at, locale.value, now.value) ?? ''
  return { ...d, title: t('terminal.diffTitle', { files: d.files, untracked: d.untracked, checked }) }
})

const snoozedUntil = computed(() => {
  const until = snooze.until(props.terminal, now.value)
  return until === null ? null : new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }).format(until)
})

const openApps: { app: OpenApp; icon: typeof FolderOpen }[] = [
  { app: 'explorer', icon: FolderOpen },
  { app: 'vscode', icon: Code },
]
function open(app: OpenApp): void {
  if (!connection.openFolder(props.terminal.id, app)) ui.reportOpenResult(props.terminal.id, app, 'offline')
}
const costBump = useBump(() => cost.value)
const context = computed(() => {
  const m = main.value
  if (ended.value || m?.contextTokens === undefined || !m.contextWindow) return null
  return { tokens: m.contextTokens, window: m.contextWindow, pct: contextPctOf(m) }
})

const { active: noting, draft: noteDraft, failed: noteFailed, input: noteInput, start: beginNote, commit, cancel: cancelNote } = useInlineEdit()

function startNote(): void {
  void beginNote(props.terminal.note ?? '')
}

function commitNote(): void {
  commit((value) => {
    const note = value || null
    return (note ?? undefined) === props.terminal.note || connection.setNote(props.terminal.id, note)
  })
}
</script>

<template>
  <article
    class="group group/card relative rounded-card bg-surface px-4 py-3 shadow-card transition-shadow duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    :class="[focused ? 'ring-2 ring-focus' : '', ended ? 'text-ink-muted' : '']"
    tabindex="0"
    :aria-label="title"
    :aria-keyshortcuts="CARD_KEYS"
    :data-session-card="terminal.id"
    @contextmenu="onContextMenu"
    @keydown="onKey"
  >
    <ContextMenu
      v-if="menu"
      :at="menu.at"
      :entries="menuEntries"
      :label="t('agentMenu.label', { title })"
      :trigger="menu.trigger"
      @pick="onPick"
      @close="menu = null"
    />
    <div class="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center px-3" role="status" aria-live="polite">
      <Transition name="ccm-menu">
        <p
          v-if="notice"
          :key="notice.n"
          class="ccm-menu max-w-full truncate px-3 py-1.5 text-xs"
          :class="notice.failed ? 'text-st-error' : 'text-ink'"
          data-card-notice
        >
          {{ notice.text }}
        </p>
      </Transition>
    </div>
    <span class="absolute inset-y-3 left-0 w-[3px] rounded-full transition-colors" :class="meta.bar" aria-hidden="true" />
    <span v-if="flash" :key="flash" class="ccm-flash pointer-events-none absolute inset-0 rounded-card" :class="meta.text" aria-hidden="true" />

    <SessionCardHeader :terminal="terminal" @note="startNote" />

    <form v-if="noting" class="relative z-10 mt-2 flex items-center gap-1.5" @submit.prevent="commitNote">
      <label :for="`note-${terminal.id}`" class="sr-only">{{ t('terminal.noteLabel') }}</label>
      <input
        :id="`note-${terminal.id}`"
        ref="noteInput"
        v-model="noteDraft"
        maxlength="140"
        :placeholder="t('terminal.notePlaceholder')"
        class="ccm-field min-w-0 flex-1"
        :aria-invalid="noteFailed"
        :aria-describedby="noteFailed ? `note-err-${terminal.id}` : undefined"
        @keydown.esc.prevent="cancelNote"
      />
      <button type="submit" class="ccm-btn ccm-btn-primary w-7 px-0!" :aria-label="t('terminal.noteSave')">
        <Check :size="15" aria-hidden="true" />
      </button>
      <button type="button" class="ccm-btn-plain" :aria-label="t('terminal.renameCancel')" @click="cancelNote">
        <X :size="15" aria-hidden="true" />
      </button>
    </form>
    <p v-if="noting && noteFailed" :id="`note-err-${terminal.id}`" role="alert" class="relative z-10 mt-1 text-2xs text-st-error">
      {{ t('terminal.renameOffline') }}
    </p>
    <button
      v-else-if="!noting && terminal.note"
      type="button"
      class="relative z-10 mt-1.5 flex w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-inner bg-accent-soft/60 px-2 py-1 text-left text-xs text-ink transition-colors hover:bg-accent-soft"
      :title="t('terminal.noteEdit')"
      @click="startNote"
    >
      <StickyNote :size="13" class="mt-px shrink-0 text-accent-ink" aria-hidden="true" />
      <span class="min-w-0 break-words">{{ terminal.note }}</span>
    </button>

    <div class="mt-1.5 flex min-w-0 items-center gap-2">
      <span class="inline-grid shrink-0">
        <Transition name="ccm-fade">
          <StatusBadge :key="terminal.status" class="col-start-1 row-start-1" :status="terminal.status" />
        </Transition>
      </span>
      <span class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">
        <Transition name="ccm-fade">
          <span
            v-if="detail"
            :key="detailKey"
            class="col-start-1 row-start-1 inline-flex min-w-0 items-center gap-1 text-xs text-ink-muted"
            :title="detail"
          >
            <component :is="wait.icon" v-if="wait && wait.reason !== 'other'" :size="13" class="shrink-0" aria-hidden="true" />
            <span class="truncate tabular-nums">{{ detail }}</span>
          </span>
        </Transition>
      </span>
      <RunBadge v-if="terminal.cwd && !ended" :dir="terminal.cwd" live-only class="relative z-10 shrink-0" />
    </div>
    <div v-if="terminal.status === 'waiting' && !ended" class="relative z-10 mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <template v-if="snoozedUntil">
        <span class="inline-flex items-center gap-1 text-ink-muted"><BellOff :size="13" aria-hidden="true" />{{ t('snooze.until', { at: snoozedUntil }) }}</span>
        <button type="button" class="cursor-pointer rounded px-1 font-medium text-link hover:underline" @click="snooze.clear(terminal.id)">{{ t('snooze.undo') }}</button>
      </template>
      <template v-else>
        <span class="inline-flex items-center gap-1 text-ink-faint"><BellOff :size="13" aria-hidden="true" />{{ t('snooze.label') }}</span>
        <button
          v-for="n in SNOOZE_CHOICES"
          :key="n"
          type="button"
          class="ccm-btn h-6! px-2! text-xs"
          :aria-label="t('snooze.action', { title, n })"
          @click="snooze.snooze(terminal, n)"
        >
          {{ t('snooze.minutes', { n }) }}
        </button>
      </template>
    </div>
    <SessionCardSignals :terminal="terminal" />

    <Transition name="ccm-fade">
      <div v-if="mode || branch || diff" class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs" data-card-git>
        <span
          v-if="mode"
          class="inline-flex shrink-0 items-center gap-1 rounded-inner px-1.5 py-px text-2xs font-medium"
          :class="mode.cls"
          :title="t('mode.title', { mode: modeLabel })"
        >
          <component :is="mode.icon" :size="12" aria-hidden="true" />{{ modeLabel }}
        </span>
        <span v-if="branch" class="inline-flex min-w-0 max-w-full items-center gap-1 text-ink-muted" :title="t('terminal.branch', { branch })">
          <GitBranch :size="13" class="shrink-0" aria-hidden="true" />
          <span class="truncate font-mono text-2xs">{{ branch }}</span>
        </span>
        <span v-if="diff" class="inline-flex min-w-0 max-w-full items-center gap-1.5 tabular-nums" :title="diff.title">
          <FileDiff :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <span class="sr-only">{{ t('terminal.diffLabel') }}</span>
          <span class="font-medium text-diff-add">+{{ fullNumber(diff.insertions, locale) }}</span>
          <span class="font-medium text-diff-del">−{{ fullNumber(diff.deletions, locale) }}</span>
          <span class="truncate text-ink-muted">{{ t('terminal.diffFiles', { n: diff.files }) }}<template v-if="diff.untracked">, {{ t('terminal.diffNew', { n: diff.untracked }) }}</template></span>
        </span>
      </div>
    </Transition>

    <div v-if="terminal.cwd || age" class="mt-1.5 flex min-w-0 items-center gap-2 text-2xs text-ink-faint" data-card-place>
      <span v-if="terminal.cwd" class="min-w-0 flex-1 truncate font-mono" :title="terminal.cwd">
        <span class="sr-only">{{ t('terminal.directory') }}: </span>{{ shortPath(terminal.cwd) }}
      </span>
      <span v-if="age" class="ms-auto inline-flex shrink-0 items-center gap-1 tabular-nums" :title="age.title" data-card-age>
        <Clock :size="12" class="shrink-0" aria-hidden="true" />
        <span aria-hidden="true">{{ age.label }}</span>
        <span class="sr-only">{{ age.title }}</span>
      </span>
      <span v-if="terminal.cwd" class="relative z-10 -my-1 -me-1.5 flex shrink-0 items-center">
        <button
          v-for="o in openApps"
          :key="o.app"
          type="button"
          class="ccm-btn-plain disabled:cursor-wait!"
          :aria-label="t('open.action', { app: t(`open.app.${openAppKey(o.app)}`), title })"
          :title="t('open.title', { app: t(`open.app.${openAppKey(o.app)}`) })"
          :disabled="ui.opening?.terminalId === terminal.id && ui.opening.app === o.app"
          @click="open(o.app)"
        >
          <LoaderCircle v-if="ui.opening?.terminalId === terminal.id && ui.opening.app === o.app" :size="14" class="animate-spin" aria-hidden="true" />
          <component :is="o.icon" v-else :size="14" aria-hidden="true" />
        </button>
      </span>
    </div>

    <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-xs text-ink-muted">
      <SubagentCounts :terminal-id="terminal.id" />
      <span v-if="terminal.compactions" class="inline-flex items-center gap-1" :title="t('terminal.compactionsTitle')">
        <FoldVertical :size="13" aria-hidden="true" />{{ t('terminal.compactions', { n: terminal.compactions }) }}
      </span>
      <span v-if="tokens || cost || codexTokens || context" class="ml-auto inline-flex items-center gap-2.5 tabular-nums">
        <span v-if="codexTokens" class="inline-flex items-center gap-1 text-agent-codex" :title="codexTokens.title">
          <ProviderBadge variant="icon" />{{ codexTokens.label }}
        </span>
        <span v-if="cost" :key="costBump" class="text-ink-muted" :class="costBump ? 'ccm-tick' : ''" :title="t('terminal.costTitle')">{{ cost }}</span>
        <Transition name="ccm-fade">
          <ContextRing v-if="context" data-card-context :tokens="context.tokens" :window="context.window" :pct="context.pct" :model="modelLine" />
        </Transition>
        <TokenCount v-if="tokens" class="font-medium text-ink" :title="tokens.title" :value="tokens.total" />
      </span>
    </div>
  </article>
</template>
