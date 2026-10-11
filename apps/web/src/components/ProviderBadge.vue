<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Hexagon } from 'lucide-vue-next'
import { codexMode } from '../lib/provider'

/** full = "Codex · exec", short = "Codex" (mode in the tooltip), icon = glyph only (labelled for screen readers). */
const props = withDefaults(defineProps<{ mode?: string; variant?: 'full' | 'short' | 'icon' }>(), { mode: undefined, variant: 'full' })
const { t } = useI18n()

const known = computed(() => codexMode(props.mode))
const modeLabel = computed(() => (known.value ? t(`provider.mode.${known.value}`) : (props.mode ?? null)))
const title = computed(() => (known.value ? t(`provider.modeTitle.${known.value}`) : t('provider.codexTitle')))
</script>

<template>
  <span v-if="variant === 'icon'" class="inline-flex shrink-0 items-center text-codex" role="img" :aria-label="t('provider.codex')" :title="title">
    <Hexagon :size="12" :stroke-width="2.25" aria-hidden="true" />
  </span>
  <span
    v-else
    class="inline-flex shrink-0 items-center gap-1 rounded-md border border-codex/40 px-1.5 py-px text-2xs font-medium text-codex"
    :title="title"
  >
    <Hexagon :size="11" :stroke-width="2.25" aria-hidden="true" />{{ t('provider.codex') }}<span v-if="variant === 'full' && modeLabel" class="font-normal text-ink-faint">· {{ modeLabel }}</span>
  </span>
</template>
