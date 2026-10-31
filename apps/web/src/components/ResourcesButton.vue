<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cpu, Hourglass } from 'lucide-vue-next'
import { useResourcesStore } from '../stores/resources'

/** `bar`: header / toolbar icon button; `rail`: 36 px square of the workspace rail column. */
const props = withDefaults(defineProps<{ variant?: 'bar' | 'rail' }>(), { variant: 'bar' })

const { t } = useI18n()
const res = useResourcesStore()
const n = computed(() => res.forgotten)
const label = computed(() => (n.value ? t('resources.openForgotten', { n: n.value }, n.value) : t('resources.open')))
</script>

<template>
  <button
    type="button"
    class="relative"
    :class="
      props.variant === 'rail'
        ? 'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted transition-colors duration-(--ccm-dur-fast) hover:bg-fill hover:text-ink'
        : 'ccm-btn-plain text-xs font-medium'
    "
    :aria-label="label"
    :title="label"
    aria-haspopup="dialog"
    :aria-expanded="res.open"
    data-resources-button
    @click="res.show()"
  >
    <Cpu :size="props.variant === 'rail' ? 16 : 15" aria-hidden="true" />
    <span v-if="n" class="absolute -top-1 -right-1 inline-flex rounded-full bg-surface" aria-hidden="true" data-resources-badge>
      <span class="inline-flex h-4 min-w-4 items-center justify-center gap-px rounded-full bg-warning-soft px-0.5 text-2xs leading-none text-warning tabular">
        <Hourglass :size="8" />{{ n > 99 ? '99+' : n }}
      </span>
    </span>
  </button>
</template>
