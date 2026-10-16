<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber, formatCost } from '../../lib/format'
import { pinLeaving } from '../../lib/motion'
import { useUsageStore } from '../../stores/usage'
import CountNum from '../CountNum.vue'

export interface RankRow {
  id: string
  label: string
  title: string
  value: number
  bar: string
  swatch?: string
}

const props = defineProps<{ rows: RankRow[]; active: string | null; label: string; empty: string; actionOf: (row: RankRow) => string }>()
const emit = defineEmits<{ toggle: [id: string] }>()

const { t, locale } = useI18n()
const usage = useUsageStore()

const max = computed(() => Math.max(0, ...props.rows.map((r) => r.value)))
const total = computed(() => usage.heroTotal)
const fmt = computed(() => (usage.metric === 'cost' ? (v: number) => formatCost(v, locale.value) : (v: number) => compactNumber(v)))
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))

function share(v: number): string {
  if (total.value <= 0) return '—'
  const k = v / total.value
  return k > 0 && k < 0.01 ? `<${percent.value.format(0.01)}` : percent.value.format(k)
}

const scale = (v: number) => (max.value > 0 ? Math.max(0.01, v / max.value) : 0)
</script>

<template>
  <p v-if="!rows.length" class="py-6 text-sm text-ink-muted">{{ empty }}</p>
  <TransitionGroup v-else tag="ul" name="ccm-list" class="relative flex flex-col" :aria-label="label" @before-leave="pinLeaving">
    <li v-for="(row, i) in rows" :key="row.id">
      <button
        type="button"
        class="grid h-8 w-full cursor-pointer grid-cols-[minmax(0,1fr)_minmax(2.5rem,1.1fr)_5rem_2.75rem] items-center gap-x-3 rounded-inner px-2 text-left transition-colors duration-(--ccm-dur-fast)"
        :class="active === row.id ? 'bg-accent-soft' : 'hover:bg-fill'"
        :aria-pressed="active === row.id"
        :title="`${row.title}\n${actionOf(row)}`"
        @click="emit('toggle', row.id)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <span v-if="row.swatch" class="size-2.5 shrink-0 rounded-sm" :class="row.swatch" aria-hidden="true" />
          <span class="truncate text-sm" :class="active === row.id ? 'font-medium text-accent-ink' : 'text-ink'">{{ row.label }}</span>
        </span>
        <span class="block h-1.5 min-w-0" aria-hidden="true">
          <span class="ccm-grow-x block h-full" :style="{ animationDelay: `${Math.min(i * 30, 300)}ms` }">
            <span
              class="block h-full origin-left rounded-full transition-transform duration-(--ccm-dur-slow) ease-out-quint"
              :class="row.bar"
              :style="{ transform: `scaleX(${scale(row.value)})` }"
            />
          </span>
        </span>
        <span class="truncate text-right text-sm font-medium text-ink tabular">
          <CountNum :key="usage.metric" :value="row.value" :format="fmt" />
        </span>
        <span class="text-right text-xs text-ink-faint tabular" :title="t('usageV53.shareOf')">{{ share(row.value) }}</span>
      </button>
    </li>
  </TransitionGroup>
</template>
