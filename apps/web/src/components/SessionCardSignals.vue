<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Cpu, FoldVertical, GitMerge, Hourglass, Repeat, ShieldAlert, ShieldX, Snowflake } from 'lucide-vue-next'
import type { TerminalSession } from '@ccm/shared'
import { cacheState, formatUsd, quietFor } from '../lib/attention'
import { clockTime, compactNumber, duration, now } from '../lib/format'
import { ruleText } from '../lib/sensitive'
import SensitiveActions from './SensitiveActions.vue'
import { useBump } from '../composables/useBump'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useAttentionStore } from '../stores/attention'
import { useResourcesStore } from '../stores/resources'
import { useSensitiveStore } from '../stores/sensitive'
import { formatBytes, formatCpu } from '../lib/resources'
import { useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ terminal: TerminalSession }>()

const { t, locale } = useI18n()
const resources = useResourcesStore()
const sensitive = useSensitiveStore()
const agents = useAgentsStore()
const attention = useAttentionStore()
const settings = useSettingsStore()
const terminals = useTerminalsStore()
const ui = useUiStore()

const ended = computed(() => props.terminal.status === 'stale')
const main = computed(() => agents.mainOf(props.terminal.id))

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
const compacting = computed(() => {
  const since = props.terminal.compactingSince
  if (!since || ended.value) return null
  const key = props.terminal.compactTrigger === 'auto' ? 'terminal.compactingAuto' : 'terminal.compacting'
  return t(key, { for: duration(since, now.value) ?? '' })
})
const denied = computed(() => {
  const n = props.terminal.deniedCount
  if (!n || ended.value) return null
  const tools = props.terminal.deniedTools?.join(', ') || t('activity.unknownTool')
  return { label: t('terminal.denied', { n }), title: t('terminal.deniedTitle', { tools }) }
})
// Monitor has no Activity panel since d8b4c84, so the hits (with Open file / Open diff / Ignore) unfold under the badge.
const sensitiveHits = computed(() => (sensitive.bySession.get(props.terminal.id) ?? []).slice(0, 10))
const sensitiveCount = computed(() => sensitive.bySession.get(props.terminal.id)?.length ?? 0)
const sensitiveOpen = ref(false)
const coldBump = useBump(() => cache.value?.cold)
const usage = computed(() => {
  const r = ended.value ? undefined : resources.bySession.get(props.terminal.id)
  if (!r || r.ramBytes === null) return null
  return { label: t('resources.card', { ram: formatBytes(r.ramBytes, locale.value), cpu: formatCpu(r.cpuPct, locale.value) }), forgotten: r.forgotten }
})
</script>

<template>
  <p v-if="quiet" class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-warning" :title="t('terminal.quietTitle')">
    <Hourglass :size="13" class="ccm-pulse shrink-0" aria-hidden="true" /><span class="truncate">{{ quiet }}</span>
  </p>
  <p
    v-if="cache?.cold"
    class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-warning transition-colors duration-300"
    :title="cache.title"
  >
    <Snowflake :key="coldBump" :size="13" class="shrink-0" :class="coldBump ? 'ccm-pop' : ''" aria-hidden="true" /><span class="truncate">{{ cache.label }}</span>
  </p>
  <p v-if="compacting" class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-muted" :title="t('terminal.compactingTitle')" data-card-compacting>
    <FoldVertical :size="13" class="ccm-pulse shrink-0" aria-hidden="true" /><span class="truncate tabular-nums">{{ compacting }}</span>
  </p>
  <p v-if="denied" class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-warning" :title="denied.title" data-card-denied>
    <ShieldX :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ denied.label }}</span>
  </p>
  <button
    v-if="sensitiveCount"
    type="button"
    class="ccm-enter relative z-10 mt-1.5 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded text-left text-xs text-warning hover:underline"
    :title="t('sensitive.badgeTitle')"
    :aria-expanded="sensitiveOpen"
    data-card-sensitive
    @click="sensitiveOpen = !sensitiveOpen"
  >
    <ShieldAlert :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ t('sensitive.badge', { n: sensitiveCount }, sensitiveCount) }}</span>
    <ChevronDown :size="12" class="shrink-0 transition-transform duration-(--ccm-dur-fast)" :class="sensitiveOpen ? 'rotate-180' : ''" aria-hidden="true" />
  </button>
  <ul v-if="sensitiveCount && sensitiveOpen" class="relative z-10 mt-1 flex flex-col divide-y divide-line rounded-inner bg-fill px-2" data-card-sensitive-list>
    <li v-for="e in sensitiveHits" :key="e.id" class="grid min-w-0 grid-cols-[auto_1fr] gap-x-2 py-1.5 text-xs">
      <ShieldAlert :size="13" class="mt-0.5 text-warning" aria-hidden="true" data-activity-sensitive />
      <div class="min-w-0">
        <p class="flex min-w-0 items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate text-ink">{{ ruleText(e.data?.rule, t) }}</span>
          <time :datetime="e.at" class="shrink-0 font-mono text-2xs text-ink-faint tabular">{{ clockTime(e.at, locale) }}</time>
        </p>
        <p v-if="e.data?.tool || e.data?.path" class="truncate text-2xs text-ink-faint" :title="e.data?.path">{{ [e.data?.tool, e.data?.path].filter(Boolean).join(' · ') }}</p>
        <SensitiveActions :event="e" />
      </div>
    </li>
  </ul>
  <p v-if="loop" class="ccm-enter mt-1.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-warning" :title="loop.title">
    <Repeat :size="13" class="ccm-pulse shrink-0" aria-hidden="true" /><span class="truncate">{{ loop.label }}</span>
  </p>
  <button
    v-if="conflict"
    type="button"
    class="ccm-enter relative z-10 mt-1.5 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded text-left text-xs transition-colors duration-300 hover:underline"
    :class="conflict.hot ? 'font-medium text-warning' : 'text-ink-muted'"
    :title="t('terminal.conflictTitle')"
    @click="conflict.first && ui.focusTerminal(conflict.first)"
  >
    <GitMerge :size="13" class="shrink-0" :class="conflict.hot ? 'ccm-pulse' : ''" aria-hidden="true" /><span class="truncate">{{ conflict.label }}</span>
  </button>
  <p
    v-if="usage"
    :class="usage.forgotten ? 'mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted' : 'sr-only'"
    :title="t('resources.cardTitle')"
    data-card-resources
  >
    <Cpu v-if="usage.forgotten" :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate tabular">{{ usage.label }}</span>
    <span v-if="usage.forgotten" class="inline-flex shrink-0 items-center gap-1 text-warning"><Hourglass :size="12" aria-hidden="true" />{{ t('resources.state.forgotten') }}</span>
  </p>
</template>
