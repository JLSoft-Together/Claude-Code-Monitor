<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCountUp } from '../composables/useCountUp'
import { compactNumber } from '../lib/format'

const props = withDefaults(defineProps<{ value: number; withUnit?: boolean }>(), { withUnit: true })
const { t } = useI18n()

// Increases inside this window add up into one growing badge instead of a new badge per transcript line.
const COMBO_MS = 1500
const BIG = 50_000

const shown = useCountUp(toRef(props, 'value'), 700)
const total = computed(() => compactNumber(Math.round(shown.value)))
const label = computed(() => (props.withUnit ? t('terminal.tokens', { total: total.value }) : total.value))

const bump = ref(0)
const delta = ref(0)
let lastAt = 0

watch(
  () => props.value,
  (to, from) => {
    const d = to - from
    if (d <= 0) return
    const at = performance.now()
    delta.value = at - lastAt < COMBO_MS ? delta.value + d : d
    lastAt = at
    bump.value++
  },
)
</script>

<template>
  <span class="relative inline-flex items-baseline tabular-nums">
    <span :key="bump" :class="bump ? 'ccm-token-glow' : ''">{{ label }}</span>
    <span
      v-if="bump"
      :key="`d-${bump}`"
      aria-hidden="true"
      class="ccm-token-delta pointer-events-none absolute right-0 -top-4 inline-flex h-4 items-center rounded-full border px-1.5 text-[10px] leading-none font-semibold whitespace-nowrap shadow-sm"
      :class="delta >= BIG ? 'border-st-working bg-st-working-soft text-st-working' : 'border-accent bg-accent-soft text-accent'"
    >+{{ compactNumber(delta) }}</span>
  </span>
</template>
