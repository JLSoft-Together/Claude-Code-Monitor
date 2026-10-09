<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellOff, Check, Code, Cpu, FileDiff, FoldVertical, FolderOpen, GitBranch, LoaderCircle, StickyNote, X } from 'lucide-vue-next'
import type { OpenApp, TerminalSession } from '@ccm/shared'
import { formatUsd } from '../lib/attention'
import { compactNumber, duration, fullNumber, now, relativeTime, shortPath } from '../lib/format'
import { modeMeta } from '../lib/mode'
import { openAppKey } from '../lib/platform'
import { effortLabel, modelLabel } from '../lib/model'
import { statusMeta } from '../lib/status'
import { useBump } from '../composables/useBump'
import { useInlineEdit } from '../composables/useInlineEdit'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { SNOOZE_CHOICES, useSnoozeStore } from '../stores/snooze'
import { useUiStore } from '../stores/ui'
import ContextGauge from './ContextGauge.vue'
import SessionCardHeader from './SessionCardHeader.vue'
import SessionCardSignals from './SessionCardSignals.vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{ terminal: TerminalSession }>()

const { t, locale } = useI18n()
const agents = useAgentsStore()
const ui = useUiStore()
const connection = useConnectionStore()
const extras = useExtrasStore()
const snooze = useSnoozeStore()

const meta = computed(() => statusMeta(props.terminal.status))
const ended = computed(() => props.terminal.status === 'stale')
const main = computed(() => agents.mainOf(props.terminal.id))
const subs = computed(() => (agents.byTerminal[props.terminal.id] ?? []).filter((a) => a.role === 'subagent'))
const subsWorking = computed(() => subs.value.filter((a) => a.status === 'working').length)
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)
const title = computed(() => displayTitle(props.terminal))

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
const effortBump = useBump(() => model.value?.effort)
const costBump = useBump(() => cost.value)
const context = computed(() => {
  const m = main.value
  if (ended.value || m?.contextTokens === undefined || !m.contextWindow) return null
  return { tokens: m.contextTokens, window: m.contextWindow }
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
    class="group relative rounded-xl border bg-surface px-4 py-3.5 transition-[border-color,box-shadow] duration-200 hover:border-line-strong"
    :class="[focused ? 'border-accent shadow-[0_0_0_3px_var(--ccm-accent-soft)]' : 'border-line', ended ? 'opacity-70' : '']"
  >
    <span class="absolute inset-y-3.5 left-0 w-[3px] rounded-full transition-colors" :class="meta.bar" aria-hidden="true" />
    <span v-if="flash" :key="flash" class="ccm-flash pointer-events-none absolute inset-0 rounded-xl" :class="meta.text" aria-hidden="true" />

    <SessionCardHeader :terminal="terminal" @note="startNote" />

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
    <SessionCardSignals :terminal="terminal" />

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
