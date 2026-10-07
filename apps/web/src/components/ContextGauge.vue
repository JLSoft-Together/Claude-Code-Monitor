<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Gauge, OctagonAlert, TriangleAlert } from 'lucide-vue-next'
import { contextLevel, type ContextLevel } from '@ccm/shared'
import { compactNumber, fullNumber } from '../lib/format'

const props = withDefaults(defineProps<{ tokens: number; window: number; compact?: boolean }>(), { compact: false })

const { t, locale } = useI18n()

const LEVEL: Record<ContextLevel, { bar: string; text: string; icon: typeof Gauge }> = {
  ok: { bar: 'bg-st-idle', text: 'text-ink-muted', icon: Gauge },
  notice: { bar: 'bg-accent', text: 'text-accent', icon: Gauge },
  warning: { bar: 'bg-st-waiting', text: 'text-st-waiting', icon: TriangleAlert },
  critical: { bar: 'bg-st-error', text: 'text-st-error', icon: OctagonAlert },
}

const pct = computed(() => Math.min(100, (props.tokens / props.window) * 100))
const level = computed(() => contextLevel(pct.value))
const view = computed(() => LEVEL[level.value])
const pctLabel = computed(() => `${Math.round(pct.value)}%`)
const amount = computed(() => `${compactNumber(props.tokens, locale.value)} / ${compactNumber(props.window, locale.value)}`)
const tooltip = computed(() =>
  t('context.tooltip', {
    pct: pctLabel.value,
    used: fullNumber(props.tokens, locale.value),
    window: fullNumber(props.window, locale.value),
  }),
)
</script>

<template>
  <div class="min-w-0" :title="tooltip">
    <div class="flex items-center gap-1.5 text-xs tabular" :class="view.text">
      <component :is="view.icon" :size="compact ? 13 : 14" aria-hidden="true" class="shrink-0" />
      <span class="font-medium">{{ t('context.label', { pct: pctLabel }) }}</span>
      <span v-if="!compact" class="ml-auto truncate text-ink-faint">≈ {{ amount }}</span>
      <span class="sr-only">{{ t(`context.level.${level}`) }}</span>
    </div>
    <div
      class="mt-1 h-1 overflow-hidden rounded-full bg-raised"
      role="meter"
      :aria-valuenow="Math.round(pct)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="t('context.meter')"
    >
      <div
        class="h-full origin-left rounded-full transition-transform duration-500 ease-out-quint motion-reduce:transition-none"
        :class="view.bar"
        :style="{ transform: `scaleX(${pct / 100})` }"
      />
    </div>
  </div>
</template>
