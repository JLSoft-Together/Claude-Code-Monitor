<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from 'lucide-vue-next'
import { baseName } from '../../lib/format'
import { TOP_PROJECTS, useUsageStore } from '../../stores/usage'
import UsageRankList, { type RankRow } from './UsageRankList.vue'

const emit = defineEmits<{ seeAll: [origin: HTMLElement] }>()

const { t } = useI18n()
const usage = useUsageStore()

const rows = computed<RankRow[]>(() => usage.topProjects.map((r) => ({ id: r.id, label: baseName(r.id), title: r.id, value: r.value, bar: 'bg-accent' })))
const count = computed(() => usage.projectRows.length)

const actionOf = (row: RankRow) => (usage.project === row.id ? t('usageV53.clearProject') : t('usageV53.filterProject', { name: row.label }))

function toggle(id: string): void {
  usage.project = usage.project === id ? null : id
}
</script>

<template>
  <section class="flex min-w-0 flex-col rounded-card bg-surface p-4 shadow-card sm:p-5" aria-labelledby="usage-projects-title">
    <div class="flex min-h-7 flex-wrap items-center justify-between gap-x-3">
      <h3 id="usage-projects-title" class="text-base font-semibold">{{ t('usageV53.topProjects') }}</h3>
      <button
        v-if="count > 0"
        type="button"
        class="ccm-btn-plain -mr-1.5 px-1.5! text-sm text-link"
        aria-haspopup="dialog"
        @click="emit('seeAll', $event.currentTarget as HTMLElement)"
      >
        {{ count > TOP_PROJECTS ? t('usageV53.seeAll', { n: count }) : t('usageV53.details') }}
        <ArrowRight :size="14" aria-hidden="true" />
      </button>
    </div>
    <div class="mt-2 min-h-0 flex-1">
      <Transition name="ccm-fade" mode="out-in">
        <UsageRankList
          :key="usage.selectedDay ?? ''"
          :rows="rows"
          :active="usage.project"
          :label="t('usageV53.topProjects')"
          :empty="usage.selectedDay ? t('usageV53.noRowsDay') : t('usage.noRows')"
          :action-of="actionOf"
          @toggle="toggle"
        />
      </Transition>
    </div>
  </section>
</template>
