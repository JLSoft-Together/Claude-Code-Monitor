<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUsageStore } from '../../stores/usage'
import UsageRankList, { type RankRow } from './UsageRankList.vue'

const { t } = useI18n()
const usage = useUsageStore()

const MODEL_BG = ['bg-model-1', 'bg-model-2', 'bg-model-3', 'bg-model-4', 'bg-model-5', 'bg-model-6', 'bg-model-7', 'bg-model-8']
const slotClass = (model: string) => {
  const slot = usage.modelSlot[model]
  return slot ? MODEL_BG[slot - 1]! : 'bg-ink-faint'
}

const rows = computed<RankRow[]>(() =>
  usage.byModel.map((r) => {
    const color = slotClass(r.id)
    return { id: r.id, label: r.id, title: r.id, value: r.value, bar: color, swatch: color }
  }),
)

const actionOf = (row: RankRow) => (usage.model === row.id ? t('usage.clearFilter') : t('usage.filterBy', { name: row.id }))

function toggle(id: string): void {
  usage.model = usage.model === id ? null : id
}
</script>

<template>
  <section class="flex min-w-0 flex-col rounded-card bg-surface p-4 shadow-card sm:p-5" aria-labelledby="usage-models-title">
    <div class="flex min-h-7 items-center">
      <h3 id="usage-models-title" class="text-base font-semibold">{{ t('usageV53.models') }}</h3>
    </div>
    <div class="mt-2 min-h-0 flex-1">
      <Transition name="ccm-fade" mode="out-in">
        <UsageRankList
          :key="usage.selectedDay ?? ''"
          :rows="rows"
          :active="usage.model"
          :label="t('usageV53.models')"
          :empty="usage.selectedDay ? t('usageV53.noRowsDay') : t('usage.noRows')"
          :action-of="actionOf"
          @toggle="toggle"
        />
      </Transition>
    </div>
  </section>
</template>
