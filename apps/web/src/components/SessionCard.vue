<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, BellOff, Check, Code, Cpu, FileDiff, FoldVertical, FolderOpen, GitBranch, GitMerge, Hourglass, LoaderCircle, Pencil, Pin, Repeat, RotateCcw, Snowflake, Star, StickyNote, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import type { OpenApp, TerminalSession } from '@ccm/shared'
import { cacheState, formatUsd, quietFor } from '../lib/attention'
import { compactNumber, duration, fullNumber, now, relativeTime, shortPath } from '../lib/format'
import { modeMeta } from '../lib/mode'
import { openAppKey } from '../lib/platform'
import { effortLabel, modelLabel } from '../lib/model'
import { statusMeta } from '../lib/status'
import { useBump } from '../composables/useBump'
import { displayTitle, isAutoNamed } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useAttentionStore } from '../stores/attention'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useFavoritesStore } from '../stores/favorites'
import { useSettingsStore } from '../stores/settings'
import { SNOOZE_CHOICES, useSnoozeStore } from '../stores/snooze'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import ContextGauge from './ContextGauge.vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{ terminal: TerminalSession }>()

const { t, locale } = useI18n()
const agents = useAgentsStore()
const ui = useUiStore()
const connection = useConnectionStore()
const favorites = useFavoritesStore()
const extras = useExtrasStore()
const settings = useSettingsStore()
const attention = useAttentionStore()
const terminals = useTerminalsStore()
const snooze = useSnoozeStore()

const meta = computed(() => statusMeta(props.terminal.status))
const ended = computed(() => props.terminal.status === 'stale')
const main = computed(() => agents.mainOf(props.terminal.id))
const subs = computed(() => (agents.byTerminal[props.terminal.id] ?? []).filter((a) => a.role === 'subagent'))
const subsWorking = computed(() => subs.value.filter((a) => a.status === 'working').length)
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)
const title = computed(() => displayTitle(props.terminal))
const autoNamed = computed(() => isAutoNamed(props.terminal))

const flash = ref(0)
watch(
  () => props.terminal.status,
  (next, prev) => {
    if (prev && next !== prev) flash.value++
  },
)

const timeLine = computed(() => {
  if (ended.value) {
    const ago = relativeTime(props.terminal.endedAt, locale.value, now.value)
    return ago ? t('terminal.endedAgo', { ago }) : null
  }
  const d = duration(props.terminal.startedAt, now.value)
  return d ? t('terminal.duration', { duration: d }) : null
})

const detail = computed(() => {
  const term = props.terminal
  if (term.status === 'waiting') {
    const waited = term.statusSince ? duration(term.statusSince, now.value) : null
    if (term.waitingFor && waited) return t('terminal.waitingForSince', { reason: term.waitingFor, waited })
    if (term.waitingFor) return t('terminal.waitingFor', { reason: term.waitingFor })
    if (waited) return t('terminal.waitingSince', { waited })
  }
  if (main.value?.currentTool) return t('terminal.running', { tool: main.value.currentTool })
  if (term.backgroundShell) return t('terminal.backgroundShell')
  return null
})

const tokens = computed(() => {
  let input = 0
  let output = 0
  let cache = 0
  let any = false
  for (const a of agents.byTerminal[props.terminal.id] ?? []) {
    if (a.totalTokens === undefined) continue
    any = true
    input += a.inputTokens ?? 0
    output += a.outputTokens ?? 0
    cache += a.cacheReadTokens ?? 0
  }
  if (!any) return null
  return {
    label: t('terminal.tokens', { total: compactNumber(input + output) }),
    title: t('terminal.tokensTitle', {
      input: fullNumber(input, locale.value),
      output: fullNumber(output, locale.value),
      cache: fullNumber(cache, locale.value),
    }),
  }
})

const starred = computed(() => favorites.has(props.terminal.cwd))
const starLabel = computed(() => t(starred.value ? 'favorites.unstar' : 'favorites.star'))
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
const model = computed(() => {
  const m = main.value
  if (!m?.model) return null
  const effort = effortLabel(m.effort, t)
  return {
    label: modelLabel(m.model, m.contextWindow, extras.modelNames),
    effort,
    title: effort ? t('agent.modelEffortTitle', { model: m.model, effort }) : t('agent.modelTitle', { model: m.model }),
  }
})
const pinned = computed(() => settings.pinned.has(props.terminal.id))
const pinLabel = computed(() => t(pinned.value ? 'terminal.unpin' : 'terminal.pin'))
const quiet = computed(() => {
  const ms = quietFor(props.terminal, now.value, settings.stuckMinutes)
  return ms === null ? null : t('terminal.quiet', { quiet: duration(props.terminal.lastActivityAt, now.value) ?? '' })
})
const cache = computed(() => {
  const c = cacheState(main.value, props.terminal, now.value)
  if (!c) return null
  const tokens = compactNumber(c.tokens)
  if (!c.expired) {
    const left = duration(new Date(now.value).toISOString(), c.expiresAt) ?? ''
    return { cold: false, label: t('terminal.cacheWarm', { left }), title: t('terminal.cacheWarmTitle', { tokens }) }
  }
  const cost = c.extraCost !== null ? formatUsd(c.extraCost) : null
  return {
    cold: true,
    label: cost ? t('terminal.cacheColdCost', { cost }) : t('terminal.cacheCold'),
    title: t('terminal.cacheColdTitle', { tokens }),
  }
})
const loop = computed(() => {
  const l = attention.loops.get(props.terminal.id)
  if (!l || ended.value) return null
  const tool = l.tool ?? t('activity.unknownTool')
  return { label: t('terminal.loop', { n: l.failures, tool }), title: t('terminal.loopTitle', { n: l.failures, calls: l.calls, tool }) }
})
const conflict = computed(() => {
  const c = attention.conflicts.get(props.terminal.id)
  if (!c) return null
  const names = c.others.map((id) => displayTitle(terminals.byId[id]) || id)
  return { hot: c.hot, first: c.others[0], label: t(c.hot ? 'terminal.conflictHot' : 'terminal.conflict', { names: names.join(', ') }) }
})
const jumping = computed(() => ui.focusingWindow === props.terminal.id)
const jumpError = computed(() => (ui.windowResult?.terminalId === props.terminal.id && ui.windowResult.result !== 'ok' ? ui.windowResult : null))
const canJump = computed(() => !ended.value && !!props.terminal.processId)
function jump(): void {
  if (!connection.focusWindow(props.terminal.id)) ui.reportWindowResult(props.terminal.id, 'offline')
}
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
const openError = computed(() => (ui.openResult?.terminalId === props.terminal.id ? ui.openResult : null))
function open(app: OpenApp): void {
  if (!connection.openFolder(props.terminal.id, app)) ui.reportOpenResult(props.terminal.id, app, 'offline')
}
const pinBump = useBump(() => pinned.value)
const starBump = useBump(() => starred.value)
const effortBump = useBump(() => model.value?.effort)
const coldBump = useBump(() => cache.value?.cold)
const costBump = useBump(() => cost.value)
const context = computed(() => {
  const m = main.value
  if (ended.value || m?.contextTokens === undefined || !m.contextWindow) return null
  return { tokens: m.contextTokens, window: m.contextWindow }
})

const versionWarning = computed(() => {
  const supported = connection.supportedClaudeVersion
  const actual = props.terminal.claudeVersion
  if (!supported || !actual || supported === actual) return null
  return t('connection.versionMismatch', { supported, actual })
})

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
const saveFailed = ref(false)

async function startEdit(): Promise<void> {
  draft.value = title.value
  saveFailed.value = false
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function commit(): void {
  if (!editing.value) return
  const value = draft.value.trim()
  const alias = value && value !== props.terminal.title ? value : null
  if ((alias ?? undefined) !== props.terminal.alias && !connection.setAlias(props.terminal.id, alias)) {
    saveFailed.value = true
    return
  }
  editing.value = false
}

function cancel(): void {
  editing.value = false
  saveFailed.value = false
}

const noting = ref(false)
const noteDraft = ref('')
const noteInput = ref<HTMLInputElement | null>(null)
const noteFailed = ref(false)

async function startNote(): Promise<void> {
  noteDraft.value = props.terminal.note ?? ''
  noteFailed.value = false
  noting.value = true
  await nextTick()
  noteInput.value?.focus()
}

function commitNote(): void {
  if (!noting.value) return
  const note = noteDraft.value.trim() || null
  if ((note ?? undefined) !== props.terminal.note && !connection.setNote(props.terminal.id, note)) {
    noteFailed.value = true
    return
  }
  noting.value = false
}

function cancelNote(): void {
  noting.value = false
  noteFailed.value = false
}

function clearAlias(): void {
  connection.setAlias(props.terminal.id, null)
}
</script>

<template>
  <article
    class="group relative rounded-xl border bg-surface px-4 py-3.5 transition-[border-color,box-shadow] duration-200 hover:border-line-strong"
    :class="[focused ? 'border-accent shadow-[0_0_0_3px_var(--ccm-accent-soft)]' : 'border-line', ended ? 'opacity-70' : '']"
  >
    <span class="absolute inset-y-3.5 left-0 w-[3px] rounded-full transition-colors" :class="meta.bar" aria-hidden="true" />
    <span v-if="flash" :key="flash" class="ccm-flash pointer-events-none absolute inset-0 rounded-xl" :class="meta.text" aria-hidden="true" />

    <form v-if="editing" class="relative z-10 flex items-center gap-1.5" @submit.prevent="commit">
      <label :for="`alias-${terminal.id}`" class="sr-only">{{ t('terminal.renameLabel') }}</label>
      <input
        :id="`alias-${terminal.id}`"
        ref="input"
        v-model="draft"
        maxlength="80"
        class="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2.5 text-sm font-semibold text-ink outline-none"
        :aria-invalid="saveFailed"
        :aria-describedby="saveFailed ? `alias-err-${terminal.id}` : undefined"
        @keydown.esc.prevent="cancel"
      />
      <button type="submit" class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg bg-accent text-on-accent" :aria-label="t('terminal.renameSave')">
        <Check :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink" :aria-label="t('terminal.renameCancel')" @click="cancel">
        <X :size="16" aria-hidden="true" />
      </button>
    </form>
    <p v-if="editing && saveFailed" :id="`alias-err-${terminal.id}`" role="alert" class="relative z-10 mt-1 text-2xs text-st-error">
      {{ t('terminal.renameOffline') }}
    </p>

    <div v-if="!editing" class="flex items-start gap-2">
      <button
        type="button"
        class="min-w-0 flex-1 cursor-pointer truncate text-left text-base font-semibold after:absolute after:inset-0 after:rounded-xl after:content-['']"
        :title="title"
        :aria-label="t('terminal.focus', { title })"
        :aria-pressed="focused"
        @click="ui.focusTerminal(terminal.id)"
      >
        {{ title }}
      </button>
      <span
        v-if="terminal.kind && terminal.kind !== 'interactive'"
        class="shrink-0 rounded-md border border-line px-1.5 py-px font-mono text-2xs text-ink-muted"
        :title="t('terminal.kind')"
      >
        {{ terminal.kind }}
      </span>
      <span v-if="versionWarning" class="shrink-0 pt-1 text-st-waiting" :title="versionWarning" role="img" :aria-label="versionWarning">
        <TriangleAlert :size="15" aria-hidden="true" />
      </span>
      <button
        v-if="terminal.alias"
        type="button"
        class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
        :aria-label="t('terminal.renameReset', { title: terminal.title })"
        :title="t('terminal.renameReset', { title: terminal.title })"
        @click="clearAlias"
      >
        <RotateCcw :size="15" aria-hidden="true" />
      </button>
      <button
        v-if="canJump"
        type="button"
        class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-accent disabled:cursor-wait"
        :aria-label="t('terminal.jump', { title })"
        :title="t('terminal.jumpTitle')"
        :disabled="jumping"
        @click="jump"
      >
        <LoaderCircle v-if="jumping" :size="15" class="animate-spin" aria-hidden="true" />
        <AppWindow v-else :size="15" aria-hidden="true" />
      </button>
      <button
        v-if="!ended"
        type="button"
        class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised"
        :class="pinned ? 'text-accent' : 'text-ink-faint hover:text-ink'"
        :aria-label="pinLabel"
        :aria-pressed="pinned"
        :title="pinLabel"
        @click="settings.togglePin(terminal.id)"
      >
        <Pin :key="pinBump" :size="15" :fill="pinned ? 'currentColor' : 'none'" :class="pinBump ? 'ccm-pop' : ''" aria-hidden="true" />
      </button>
      <button
        v-if="terminal.cwd"
        type="button"
        class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised"
        :class="starred ? 'text-st-waiting' : 'text-ink-faint hover:text-ink'"
        :aria-label="starLabel"
        :aria-pressed="starred"
        :title="starLabel"
        @click="connection.toggleFavorite(terminal.id)"
      >
        <Star :key="starBump" :size="15" :fill="starred ? 'currentColor' : 'none'" :class="starBump ? 'ccm-pop' : ''" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised hover:text-ink"
        :class="terminal.note ? 'text-accent' : 'text-ink-faint'"
        :aria-label="t(terminal.note ? 'terminal.noteEdit' : 'terminal.noteAdd')"
        :title="t(terminal.note ? 'terminal.noteEdit' : 'terminal.noteAdd')"
        @click="startNote"
      >
        <StickyNote :size="15" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="relative z-10 -my-1 -mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
        :aria-label="t('terminal.rename')"
        :title="t('terminal.rename')"
        @click="startEdit"
      >
        <Pencil :size="15" aria-hidden="true" />
      </button>
      <button
        v-if="ended"
        type="button"
        class="relative z-10 -my-1 -mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-st-error"
        :aria-label="t('terminal.dismiss', { title })"
        :title="t('terminal.dismiss', { title })"
        @click="connection.dismissEnded(terminal.id)"
      >
        <Trash2 :size="15" aria-hidden="true" />
      </button>
    </div>
    <p v-if="jumpError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
      {{ t(`terminal.jumpError.${jumpError.result}`) }}
    </p>
    <p v-if="openError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
      {{ t(`open.error.${openError.result}`, { app: t(`open.app.${openAppKey(openError.app)}`) }) }}
    </p>
    <p v-if="!editing && terminal.alias" class="mt-0.5 truncate text-2xs text-ink-faint" :title="terminal.title">
      {{ t('terminal.originalName', { title: terminal.title }) }}
    </p>
    <p v-else-if="!editing && autoNamed" class="mt-0.5 truncate text-2xs text-ink-faint" :title="t('terminal.nameHintLong')">
      {{ t('terminal.nameHint') }}
    </p>

    <form v-if="noting" class="relative z-10 mt-2 flex items-center gap-1.5" @submit.prevent="commitNote">
      <label :for="`note-${terminal.id}`" class="sr-only">{{ t('terminal.noteLabel') }}</label>
      <input
        :id="`note-${terminal.id}`"
        ref="noteInput"
        v-model="noteDraft"
        maxlength="140"
        :placeholder="t('terminal.notePlaceholder')"
        class="h-8 min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2.5 text-xs text-ink outline-none"
        :aria-invalid="noteFailed"
        :aria-describedby="noteFailed ? `note-err-${terminal.id}` : undefined"
        @keydown.esc.prevent="cancelNote"
      />
      <button type="submit" class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg bg-accent text-on-accent" :aria-label="t('terminal.noteSave')">
        <Check :size="15" aria-hidden="true" />
      </button>
      <button type="button" class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink" :aria-label="t('terminal.renameCancel')" @click="cancelNote">
        <X :size="15" aria-hidden="true" />
      </button>
    </form>
    <p v-if="noting && noteFailed" :id="`note-err-${terminal.id}`" role="alert" class="relative z-10 mt-1 text-2xs text-st-error">
      {{ t('terminal.renameOffline') }}
    </p>
    <button
      v-else-if="!noting && terminal.note"
      type="button"
      class="relative z-10 mt-2 flex w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-md border-l-2 border-accent bg-accent-soft/60 px-2 py-1 text-left text-xs text-ink transition-colors hover:bg-accent-soft"
      :title="t('terminal.noteEdit')"
      @click="startNote"
    >
      <StickyNote :size="13" class="mt-px shrink-0 text-accent" aria-hidden="true" />
      <span class="min-w-0 break-words">{{ terminal.note }}</span>
    </button>

    <div class="mt-2 flex min-w-0 items-center gap-2">
      <StatusBadge :status="terminal.status" />
      <span v-if="detail" class="min-w-0 truncate text-xs text-ink-muted" :title="detail">{{ detail }}</span>
    </div>
    <div v-if="terminal.status === 'waiting' && !ended" class="relative z-10 mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <template v-if="snoozedUntil">
        <span class="inline-flex items-center gap-1 text-ink-muted"><BellOff :size="13" aria-hidden="true" />{{ t('snooze.until', { at: snoozedUntil }) }}</span>
        <button type="button" class="cursor-pointer rounded px-1 font-medium text-accent hover:underline" @click="snooze.clear(terminal.id)">{{ t('snooze.undo') }}</button>
      </template>
      <template v-else>
        <span class="inline-flex items-center gap-1 text-ink-faint"><BellOff :size="13" aria-hidden="true" />{{ t('snooze.label') }}</span>
        <button
          v-for="n in SNOOZE_CHOICES"
          :key="n"
          type="button"
          class="inline-flex h-7 cursor-pointer items-center rounded-md border border-line px-2 text-ink-muted transition-colors hover:border-st-waiting hover:text-ink"
          :aria-label="t('snooze.action', { title, n })"
          @click="snooze.snooze(terminal, n)"
        >
          {{ t('snooze.minutes', { n }) }}
        </button>
      </template>
    </div>
    <p v-if="quiet" class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-st-waiting" :title="t('terminal.quietTitle')">
      <Hourglass :size="13" class="ccm-pulse shrink-0" aria-hidden="true" /><span class="truncate">{{ quiet }}</span>
    </p>
    <p
      v-if="cache"
      class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs transition-colors duration-300"
      :class="cache.cold ? 'font-medium text-st-waiting' : 'text-ink-muted'"
      :title="cache.title"
    >
      <Snowflake :key="coldBump" :size="13" class="shrink-0" :class="coldBump ? 'ccm-pop' : ''" aria-hidden="true" /><span class="truncate">{{ cache.label }}</span>
    </p>
    <p v-if="loop" class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-st-error" :title="loop.title">
      <Repeat :size="13" class="ccm-pulse shrink-0" aria-hidden="true" /><span class="truncate">{{ loop.label }}</span>
    </p>
    <button
      v-if="conflict"
      type="button"
      class="ccm-enter relative z-10 mt-1.5 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded text-left text-xs transition-colors duration-300 hover:underline"
      :class="conflict.hot ? 'font-medium text-st-waiting' : 'text-ink-muted'"
      :title="t('terminal.conflictTitle')"
      @click="conflict.first && ui.focusTerminal(conflict.first)"
    >
      <GitMerge :size="13" class="shrink-0" :class="conflict.hot ? 'ccm-pulse' : ''" aria-hidden="true" /><span class="truncate">{{ conflict.label }}</span>
    </button>

    <div v-if="mode || branch || model" class="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-2xs">
      <span
        v-if="mode"
        class="inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-medium"
        :class="mode.cls"
        :title="t('mode.title', { mode: modeLabel })"
      >
        <component :is="mode.icon" :size="12" aria-hidden="true" />{{ modeLabel }}
      </span>
      <span
        v-if="model"
        class="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px font-medium text-ink-muted"
        :title="model.title"
      >
        <Cpu :size="12" aria-hidden="true" />{{ model.label }}<span v-if="model.effort" :key="effortBump" class="text-ink-faint" :class="effortBump ? 'ccm-tick' : ''">· {{ model.effort }}</span>
      </span>
      <span v-if="branch" class="inline-flex min-w-0 max-w-full items-center gap-1 text-ink-muted" :title="t('terminal.branch', { branch })">
        <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate font-mono">{{ branch }}</span>
      </span>
    </div>

    <p v-if="diff" class="mt-2 flex min-w-0 items-center gap-1.5 text-xs tabular" :title="diff.title">
      <FileDiff :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
      <span class="sr-only">{{ t('terminal.diffLabel') }}</span>
      <span class="font-medium text-st-done">+{{ fullNumber(diff.insertions, locale) }}</span>
      <span class="font-medium text-st-error">−{{ fullNumber(diff.deletions, locale) }}</span>
      <span class="truncate text-ink-muted">{{ t('terminal.diffFiles', { n: diff.files }) }}<template v-if="diff.untracked">, {{ t('terminal.diffNew', { n: diff.untracked }) }}</template></span>
    </p>

    <ContextGauge v-if="context" class="mt-3" :tokens="context.tokens" :window="context.window" />

    <dl class="mt-3 space-y-1 text-xs text-ink-muted">
      <div v-if="terminal.cwd" class="flex min-w-0 items-center gap-2">
        <dt class="sr-only">{{ t('terminal.directory') }}</dt>
        <dd class="min-w-0 flex-1 truncate font-mono text-2xs" :title="terminal.cwd">{{ shortPath(terminal.cwd) }}</dd>
        <dd class="relative z-10 -my-1 flex shrink-0 items-center">
          <button
            v-for="o in openApps"
            :key="o.app"
            type="button"
            class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink disabled:cursor-wait"
            :aria-label="t('open.action', { app: t(`open.app.${openAppKey(o.app)}`), title })"
            :title="t('open.title', { app: t(`open.app.${openAppKey(o.app)}`) })"
            :disabled="ui.opening?.terminalId === terminal.id && ui.opening.app === o.app"
            @click="open(o.app)"
          >
            <LoaderCircle v-if="ui.opening?.terminalId === terminal.id && ui.opening.app === o.app" :size="14" class="animate-spin" aria-hidden="true" />
            <component :is="o.icon" v-else :size="14" aria-hidden="true" />
          </button>
        </dd>
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 tabular">
        <dd v-if="terminal.processId">{{ t('terminal.process', { pid: terminal.processId }) }}</dd>
        <dd v-if="terminal.shell">{{ terminal.shell }}</dd>
        <dd v-if="timeLine">{{ timeLine }}</dd>
      </div>
    </dl>

    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-xs text-ink-muted">
      <span>
        {{ t('terminal.subagentCount', subs.length) }}<template v-if="subsWorking > 0">
          · <span class="text-st-working">{{ t('terminal.subagentWorking', { count: subsWorking }) }}</span></template
        >
      </span>
      <span v-if="terminal.compactions" class="inline-flex items-center gap-1" :title="t('terminal.compactionsTitle')">
        <FoldVertical :size="13" aria-hidden="true" />{{ t('terminal.compactions', { n: terminal.compactions }) }}
      </span>
      <span v-if="tokens || cost" class="ml-auto inline-flex items-center gap-2 tabular">
        <span v-if="cost" :key="costBump" class="text-ink-muted" :class="costBump ? 'ccm-tick' : ''" :title="t('terminal.costTitle')">{{ cost }}</span>
        <span v-if="tokens" class="font-medium text-ink" :title="tokens.title">{{ tokens.label }}</span>
      </span>
    </div>
  </article>
</template>
