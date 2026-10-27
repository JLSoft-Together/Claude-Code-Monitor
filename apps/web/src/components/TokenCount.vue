<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { compactNumber } from '../lib/format'

const props = withDefaults(defineProps<{ value: number; withUnit?: boolean; delta?: 'above' | 'side' }>(), { withUnit: true, delta: 'above' })
const { t } = useI18n()

// Increases inside this window add up into one growing badge instead of a new badge per transcript line.
const COMBO_MS = 1500
const BIG = 50_000

const total = computed(() => compactNumber(Math.round(props.value)))
const label = computed(() => (props.withUnit ? t('terminal.tokens', { total: total.value }) : total.value))

const burst = ref(0)
const delta = ref(0)
let lastAt = -Infinity

watch(
  () => props.value,
  (to, from) => {
    const d = to - from
    if (d <= 0) return
    const at = performance.now()
    if (at - lastAt < COMBO_MS) delta.value += d
    else {
      delta.value = d
      burst.value++
    }
    lastAt = at
  },
)
</script>

<template>
  <span class="relative inline-flex items-baseline tabular-nums">
    <span>{{ label }}</span>
    <span
      v-if="burst"
      :key="`d-${burst}`"
      aria-hidden="true"
      class="ccm-token-delta pointer-events-none absolute inline-flex h-4 items-center rounded-inner px-1.5 text-[10px] leading-none font-semibold whitespace-nowrap bg-accent-soft text-accent-ink shadow-control"
      :class="[props.delta === 'side' ? 'top-1/2 left-full ml-2 -translate-y-1/2' : 'right-0 -top-4', delta >= BIG ? 'ring-1 ring-accent-ink' : '']"
    >+{{ compactNumber(delta) }}</span>
  </span>
</template>
