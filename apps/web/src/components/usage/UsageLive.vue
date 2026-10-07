<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber, fullNumber } from '../../lib/format'
import { displayTitle } from '../../lib/title'
import { useAgentsStore } from '../../stores/agents'
import { useTerminalsStore } from '../../stores/terminals'
import StatusIcon from '../StatusIcon.vue'

const { t, locale } = useI18n()
const terminals = useTerminalsStore()
const agents = useAgentsStore()

const rows = computed(() =>
  terminals.live.map((term) => {
    const list = agents.byTerminal[term.id] ?? []
    let input = 0
    let output = 0
    let cache = 0
    for (const a of list) {
      input += a.inputTokens ?? 0
      output += a.outputTokens ?? 0
      cache += a.cacheReadTokens ?? 0
    }
    const main = list.find((a) => a.role === 'main')
    return { term, title: displayTitle(term), model: main?.model, agents: list.length, input, output, cache, total: input + output }
  }),
)
</script>

<template>
  <section class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="usage-live-title">
    <h3 id="usage-live-title" class="text-base font-semibold">{{ t('usage.live') }}</h3>
    <p class="mt-0.5 text-xs text-ink-muted">{{ t('usage.liveHint') }}</p>

    <p v-if="rows.length === 0" class="mt-6 text-sm text-ink-muted">{{ t('sessions.empty') }}</p>
    <div v-else class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[560px] text-left text-sm">
        <thead class="text-xs text-ink-muted">
          <tr class="border-b border-line">
            <th scope="col" class="py-2 pr-3 font-medium">{{ t('usage.session') }}</th>
            <th scope="col" class="px-2 py-2 font-medium">{{ t('usage.model') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.liveInput') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.series.output') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.series.cacheRead') }}</th>
            <th scope="col" class="py-2 pl-2 text-right font-medium">{{ t('usage.total') }}</th>
          </tr>
        </thead>
        <TransitionGroup tag="tbody" name="ccm-list" class="relative">
          <tr v-for="row in rows" :key="row.term.id" class="border-b border-line last:border-b-0">
            <th scope="row" class="max-w-[260px] py-2.5 pr-3 font-normal">
              <span class="flex min-w-0 items-center gap-2">
                <StatusIcon :status="row.term.status" :size="14" />
                <span class="truncate font-medium" :title="row.title">{{ row.title }}</span>
                <span v-if="row.agents > 1" class="shrink-0 text-xs text-ink-faint">{{ t('usage.agentCount', { n: row.agents }) }}</span>
              </span>
            </th>
            <td class="px-2 py-2.5 font-mono text-xs text-ink-muted">{{ row.model ?? '—' }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.input, locale)">{{ compactNumber(row.input) }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.output, locale)">{{ compactNumber(row.output) }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.cache, locale)">{{ compactNumber(row.cache) }}</td>
            <td class="py-2.5 pl-2 text-right font-semibold tabular-nums" :title="fullNumber(row.total, locale)">{{ compactNumber(row.total) }}</td>
          </tr>
        </TransitionGroup>
      </table>
    </div>
  </section>
</template>
