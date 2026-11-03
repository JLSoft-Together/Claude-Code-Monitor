<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Fish, Hexagon } from 'lucide-vue-next'
import { codexMode, type BadgeProvider } from '../lib/provider'

/** full = "Codex · exec", short = "Codex" (mode in the tooltip), icon = glyph only (labelled for screen readers). */
const props = withDefaults(defineProps<{ mode?: string; variant?: 'full' | 'short' | 'icon'; provider?: BadgeProvider }>(), {
  mode: undefined,
  variant: 'full',
  provider: 'codex',
})
const { t } = useI18n()

const deepseek = computed(() => props.provider === 'deepseek')
const known = computed(() => (deepseek.value ? null : codexMode(props.mode)))
const modeLabel = computed(() => (deepseek.value ? null : known.value ? t(`provider.mode.${known.value}`) : (props.mode ?? null)))
const label = computed(() => t(deepseek.value ? 'provider.deepseek' : 'provider.codex'))
const title = computed(() => (deepseek.value ? t('provider.deepseekTitle') : known.value ? t(`provider.modeTitle.${known.value}`) : t('provider.codexTitle')))
const icon = computed(() => (deepseek.value ? Fish : Hexagon))
// DeepSeek has no agent-* colour token yet (as PresetIcon): neutral ink on the fill surface.
const ink = computed(() => (deepseek.value ? 'text-ink' : 'text-agent-codex'))
const chip = computed(() => (deepseek.value ? 'bg-fill text-ink' : 'bg-agent-codex/10 text-agent-codex'))
</script>

<template>
  <span v-if="variant === 'icon'" class="inline-flex shrink-0 items-center" :class="ink" role="img" :aria-label="label" :title="title">
    <component :is="icon" :size="12" :stroke-width="2.25" aria-hidden="true" />
  </span>
  <span v-else class="inline-flex shrink-0 items-center gap-1 rounded-inner px-1.5 py-px text-2xs font-medium" :class="chip" :title="title">
    <component :is="icon" :size="11" :stroke-width="2.25" aria-hidden="true" />{{ label }}<span v-if="variant === 'full' && modeLabel" class="font-normal text-ink-faint">· {{ modeLabel }}</span>
  </span>
</template>
