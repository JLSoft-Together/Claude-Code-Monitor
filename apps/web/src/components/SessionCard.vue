<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from 'lucide-vue-next'
import type { TerminalSession } from '@ccm/shared'
import { compactNumber, duration, fullNumber, now, relativeTime, shortPath } from '../lib/format'
import { statusMeta } from '../lib/status'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useUiStore } from '../stores/ui'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{ terminal: TerminalSession }>()

const { t, locale } = useI18n()
const agents = useAgentsStore()
const ui = useUiStore()
const connection = useConnectionStore()

const meta = computed(() => statusMeta(props.terminal.status))
const ended = computed(() => props.terminal.status === 'stale')
const main = computed(() => agents.mainOf(props.terminal.id))
const subs = computed(() => (agents.byTerminal[props.terminal.id] ?? []).filter((a) => a.role === 'subagent'))
const subsWorking = computed(() => subs.value.filter((a) => a.status === 'working').length)
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)

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
  if (term.status === 'waiting' && term.waitingFor) return t('terminal.waitingFor', { reason: term.waitingFor })
  if (main.value?.currentTool) return t('terminal.running', { tool: main.value.currentTool })
  if (term.backgroundShell) return t('terminal.backgroundShell')
  return null
})

const tokens = computed(() => {
  const m = main.value
  if (m?.totalTokens === undefined) return null
  return {
    label: t('terminal.tokens', { total: compactNumber(m.totalTokens, locale.value) }),
    title: t('terminal.tokensTitle', {
      input: fullNumber(m.inputTokens, locale.value),
      output: fullNumber(m.outputTokens, locale.value),
      cache: fullNumber(m.cacheReadTokens, locale.value),
    }),
  }
})

const versionWarning = computed(() => {
  const supported = connection.supportedClaudeVersion
  const actual = props.terminal.claudeVersion
  if (!supported || !actual || supported === actual) return null
  return t('connection.versionMismatch', { supported, actual })
})
</script>

<template>
  <button
    type="button"
    class="group ccm-enter relative block w-full cursor-pointer rounded-lg border bg-surface px-3.5 py-3 text-left transition-colors hover:border-line-strong"
    :class="[focused ? 'border-accent' : 'border-line', ended ? 'opacity-70' : '']"
    :aria-label="t('terminal.focus', { title: terminal.title })"
    :aria-pressed="focused"
    @click="ui.focusTerminal(terminal.id)"
  >
    <span
      class="absolute inset-y-3 left-0 w-0.5 rounded-full"
      :class="meta.bar"
      aria-hidden="true"
    />
    <div class="flex items-start gap-2">
      <h3 class="min-w-0 flex-1 truncate text-sm font-semibold" :title="terminal.title">{{ terminal.title }}</h3>
      <span
        v-if="terminal.kind"
        class="shrink-0 rounded border border-line px-1.5 py-px font-mono text-2xs text-ink-muted"
        :title="t('terminal.kind')"
      >
        {{ terminal.kind }}
      </span>
      <span v-if="versionWarning" class="shrink-0 text-st-waiting" :title="versionWarning" role="img" :aria-label="versionWarning">
        <TriangleAlert :size="14" aria-hidden="true" />
      </span>
    </div>

    <div class="mt-1.5 flex min-w-0 items-center gap-2">
      <StatusBadge :status="terminal.status" />
      <span v-if="detail" class="min-w-0 truncate text-xs text-ink-muted" :title="detail">· {{ detail }}</span>
    </div>

    <dl class="mt-2.5 space-y-1 font-mono text-2xs text-ink-muted">
      <div v-if="terminal.cwd" class="flex min-w-0 gap-2">
        <dt class="sr-only">{{ t('terminal.directory') }}</dt>
        <dd class="min-w-0 truncate" :title="terminal.cwd">{{ shortPath(terminal.cwd) }}</dd>
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 tabular">
        <dd v-if="terminal.processId">{{ t('terminal.process', { pid: terminal.processId }) }}</dd>
        <dd v-if="terminal.shell">{{ terminal.shell }}</dd>
        <dd v-if="timeLine">{{ timeLine }}</dd>
      </div>
    </dl>

    <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-xs text-ink-muted">
      <span>
        {{ t('terminal.subagentCount', subs.length) }}<template v-if="subsWorking > 0">
          · <span class="text-st-working">{{ t('terminal.subagentWorking', { count: subsWorking }) }}</span></template
        >
      </span>
      <span v-if="tokens" class="ml-auto font-mono text-2xs tabular" :title="tokens.title">{{ tokens.label }}</span>
    </div>
  </button>
</template>
