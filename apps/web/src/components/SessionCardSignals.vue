<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitMerge, Hourglass, Repeat, Snowflake } from 'lucide-vue-next'
import type { TerminalSession } from '@ccm/shared'
import { cacheState, formatUsd, quietFor } from '../lib/attention'
import { compactNumber, duration, now } from '../lib/format'
import { useBump } from '../composables/useBump'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useAttentionStore } from '../stores/attention'
import { useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ terminal: TerminalSession }>()

const { t } = useI18n()
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
const coldBump = useBump(() => cache.value?.cold)
</script>

<template>
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
</template>
