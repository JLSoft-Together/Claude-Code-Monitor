<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AndroidModule, RunProject } from '@ccm/shared'
import { projectMark } from '../../lib/runUi'

/** Android / Flutter mark (Explorer rows, Run pane): glyph + "?" when not runnable or guessed, the label read out, reason in the tooltip. */
const props = defineProps<{ project: RunProject; module?: AndroidModule }>()

const { t } = useI18n()

// Flutter: simple-icons 13.21.0 (CC0). Android: a plain robot-head glyph drawn for this mark.
const FLUTTER = 'M14.314 0L2.3 12 6 15.7 21.684.013h-7.357zm.014 11.072L7.857 17.53l6.47 6.47H21.7l-6.46-6.468 6.46-6.46h-7.37z'
const ANDROID = 'M3 18a9 9 0 0 1 18 0zM7.2 8.6 5.6 5.9l.9-.5 1.6 2.8zm9.6 0 1.6-2.8-.9-.5-1.6 2.8zM8.5 14.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2zm7 0a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2z'

const mark = computed(() => projectMark(props.project))
const unsure = computed(() => (props.module ? props.module.guessed : mark.value.unsure))
const label = computed(() => {
  if (props.module) return t('run.project.appModule', { path: props.module.path })
  return t('run.project.mark', { kind: t(`run.project.kind.${mark.value.kind}`), label: t(`run.project.${mark.value.label}`) })
})
const title = computed(() => {
  const reason = props.module ? (props.module.guessed ? 'guessed' : null) : mark.value.reason
  const parts = [label.value, reason ? t(`run.project.reason.${reason}`) : '']
  return parts.filter(Boolean).join(' — ')
})
</script>

<template>
  <span
    class="relative inline-flex size-[15px] shrink-0 items-center justify-center rounded-[4px]"
    :class="unsure ? 'text-ink-faint' : mark.kind === 'flutter' ? 'text-accent-ink' : 'text-success'"
    :title="title"
    :data-run-mark="mark.kind"
    :data-run-mark-unsure="unsure ? '' : undefined"
  >
    <svg viewBox="0 0 24 24" class="size-3" fill="currentColor" aria-hidden="true"><path :d="mark.kind === 'flutter' ? FLUTTER : ANDROID" /></svg>
    <span v-if="unsure" class="absolute -right-0.5 -bottom-1 text-[9px] leading-none font-bold text-ink-muted" aria-hidden="true">?</span>
    <span class="sr-only">, {{ label }}{{ unsure ? ` (${t('run.project.unsure')})` : '' }}</span>
  </span>
</template>
