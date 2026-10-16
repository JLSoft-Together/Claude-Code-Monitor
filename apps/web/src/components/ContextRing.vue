<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { OctagonAlert, TriangleAlert } from 'lucide-vue-next'
import { contextLevel, contextRawPct, contextUsedPct, type ContextLevel } from '@ccm/shared'
import { useBump } from '../composables/useBump'
import { compactNumber, fullNumber } from '../lib/format'

const props = withDefaults(defineProps<{ tokens: number; window: number; pct?: number; model?: string | null }>(), { pct: undefined, model: null })

const { t, locale } = useI18n()

const LEVEL: Record<ContextLevel, { text: string; arc: string; icon: typeof TriangleAlert | null }> = {
  ok: { text: 'text-ink-muted', arc: 'stroke-accent', icon: null },
  notice: { text: 'text-accent-ink', arc: 'stroke-accent', icon: null },
  warning: { text: 'text-warning', arc: 'stroke-warning', icon: TriangleAlert },
  critical: { text: 'text-st-error', arc: 'stroke-st-error', icon: OctagonAlert },
}

const pct = computed(() => Math.min(100, Math.max(0, props.pct ?? contextUsedPct(props.tokens, props.window))))
const rounded = computed(() => Math.round(pct.value))
const level = computed(() => contextLevel(pct.value))
const view = computed(() => LEVEL[level.value])
const pctLabel = computed(() => `${rounded.value}%`)
const bump = useBump(() => rounded.value)

const tooltip = computed(() =>
  [
    props.model,
    t('sessionV53.contextAmount', {
      pct: pctLabel.value,
      used: compactNumber(props.tokens, locale.value),
      window: compactNumber(props.window, locale.value),
    }),
    t('context.tooltip', {
      pct: pctLabel.value,
      used: fullNumber(props.tokens, locale.value),
      window: fullNumber(props.window, locale.value),
      raw: `${Math.round(contextRawPct(props.tokens, props.window))}%`,
    }),
  ]
    .filter(Boolean)
    .join('\n'),
)
const valueText = computed(() =>
  [t('context.label', { pct: pctLabel.value }), t(`context.level.${level.value}`), props.model].filter(Boolean).join(', '),
)
</script>

<template>
  <span
    class="inline-flex items-center gap-1 tabular-nums transition-colors duration-(--ccm-dur-base)"
    :class="view.text"
    :title="tooltip"
    role="meter"
    :aria-label="t('context.meter')"
    :aria-valuenow="rounded"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuetext="valueText"
  >
    <span class="grid size-[13px] shrink-0 place-items-center" aria-hidden="true">
      <Transition name="ccm-fade">
        <svg v-if="!view.icon" key="ring" class="col-start-1 row-start-1 size-[13px] -rotate-90" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke-width="2" class="stroke-fill-strong" />
          <circle
            cx="7"
            cy="7"
            r="5.5"
            fill="none"
            stroke-width="2"
            stroke-linecap="round"
            pathLength="100"
            stroke-dasharray="100"
            class="transition-[stroke-dashoffset,stroke] duration-(--ccm-dur-slow) ease-out-quint"
            :class="view.arc"
            :style="{ strokeDashoffset: 100 - pct }"
          />
        </svg>
        <component :is="view.icon" v-else :key="level" :size="13" class="col-start-1 row-start-1" />
      </Transition>
    </span>
    <span :key="bump" class="font-medium" :class="bump ? 'ccm-tick' : ''">{{ pctLabel }}</span>
  </span>
</template>
