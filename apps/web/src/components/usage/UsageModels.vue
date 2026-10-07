<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber, formatCost, fullNumber } from '../../lib/format'
import { useUsageStore } from '../../stores/usage'

const { t, locale } = useI18n()
const usage = useUsageStore()

const max = computed(() => Math.max(0, ...usage.byModel.map((r) => r.value)))
const fmt = (v: number) => (usage.metric === 'cost' ? formatCost(v, locale.value) : compactNumber(v))
const slotColor = (model: string) => {
  const slot = usage.modelSlot[model]
  return slot ? `var(--ccm-cat-${slot})` : 'var(--ccm-ink-faint)'
}

function toggle(model: string): void {
  usage.model = usage.model === model ? null : model
}
</script>

<template>
  <section class="min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="usage-models-title">
    <h3 id="usage-models-title" class="text-base font-semibold">{{ t('usage.byModel') }}</h3>
    <p class="mt-0.5 text-xs text-ink-muted">{{ t('usage.byModelHint') }}</p>

    <p v-if="usage.byModel.length === 0" class="mt-6 text-sm text-ink-muted">{{ t('usage.noRows') }}</p>
    <div v-else class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[620px] text-left text-sm">
        <thead class="text-xs text-ink-muted">
          <tr class="border-b border-line">
            <th scope="col" class="py-2 pr-3 font-medium">{{ t('usage.model') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.series.input') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.series.output') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.series.cacheWrite') }}</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">{{ t('usage.series.cacheRead') }}</th>
            <th scope="col" class="py-2 pl-2 text-right font-medium">{{ t('usage.cost') }}</th>
          </tr>
        </thead>
        <TransitionGroup tag="tbody" name="ccm-list" class="relative">
          <tr v-for="row in usage.byModel" :key="row.id" class="border-b border-line last:border-b-0">
            <th scope="row" class="py-2.5 pr-3 font-normal">
              <button
                type="button"
                class="group flex w-full min-w-[180px] cursor-pointer flex-col gap-1.5 text-left"
                :aria-pressed="usage.model === row.id"
                :title="usage.model === row.id ? t('usage.clearFilter') : t('usage.filterBy', { name: row.id })"
                @click="toggle(row.id)"
              >
                <span class="flex items-center gap-2">
                  <span class="size-2.5 shrink-0 rounded-sm" :style="{ background: slotColor(row.id) }" aria-hidden="true" />
                  <span class="truncate font-medium group-hover:underline" :class="usage.model === row.id ? 'text-accent' : 'text-ink'">{{ row.id }}</span>
                  <span class="ml-auto text-xs text-ink-muted tabular-nums">{{ fmt(row.value) }}</span>
                </span>
                <span class="block h-1.5 w-full rounded-full bg-raised" aria-hidden="true">
                  <span
                    class="ccm-grow-x block h-full rounded-full transition-[width] duration-500"
                    :style="{ width: `${max > 0 ? Math.max(1, (row.value / max) * 100) : 0}%`, background: slotColor(row.id) }"
                  />
                </span>
              </button>
            </th>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.input, locale)">{{ compactNumber(row.input) }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.output, locale)">{{ compactNumber(row.output) }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.cacheWrite, locale)">{{ compactNumber(row.cacheWrite) }}</td>
            <td class="px-2 py-2.5 text-right tabular-nums" :title="fullNumber(row.cacheRead, locale)">{{ compactNumber(row.cacheRead) }}</td>
            <td class="py-2.5 pl-2 text-right font-medium tabular-nums">
              {{ row.unpriced > 0 && row.cost === 0 ? '—' : formatCost(row.cost, locale) }}
            </td>
          </tr>
        </TransitionGroup>
      </table>
    </div>
  </section>
</template>
