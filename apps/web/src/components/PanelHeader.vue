<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from 'lucide-vue-next'
import { useUiStore, type Panel } from '../stores/ui'

const props = defineProps<{
  panel: Panel
  title: string
  titleId: string
  bodyId: string
  meta?: string
  /** Breakpoint from which the collapsed panel becomes a vertical rail beside the map. */
  rail: 'lg' | 'xl'
}>()

const { t } = useI18n()
const ui = useUiStore()
const collapsed = computed(() => ui.isCollapsed(props.panel))

// Literal class strings so Tailwind can see them.
const RAIL = {
  lg: {
    heading: 'lg:mb-0 lg:h-full',
    button: 'lg:h-full lg:justify-start lg:rounded-xl lg:border lg:border-line lg:bg-surface lg:px-0 lg:py-3 lg:[writing-mode:vertical-rl]',
    chevron: '-rotate-90',
  },
  xl: {
    heading: 'xl:mb-0 xl:h-full',
    button: 'xl:h-full xl:justify-start xl:rounded-xl xl:border xl:border-line xl:bg-surface xl:px-0 xl:py-3 xl:[writing-mode:vertical-rl]',
    chevron: '-rotate-90 xl:rotate-90',
  },
} as const
</script>

<template>
  <h2 :id="titleId" class="text-sm font-semibold text-ink" :class="collapsed ? RAIL[rail].heading : 'mb-3'">
    <button
      type="button"
      class="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-0.5 py-1 text-left transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      :class="collapsed ? RAIL[rail].button : ''"
      :aria-expanded="!collapsed"
      :aria-controls="bodyId"
      :title="collapsed ? t('panel.expand') : t('panel.collapse')"
      @click="ui.togglePanel(panel)"
    >
      <ChevronDown
        :size="16"
        aria-hidden="true"
        class="shrink-0 text-ink-faint transition-transform duration-200 group-hover:text-accent motion-reduce:transition-none"
        :class="collapsed ? RAIL[rail].chevron : ''"
      />
      <span>{{ title }}</span>
      <span v-if="meta" class="ms-auto text-xs font-normal text-ink-faint tabular">{{ meta }}</span>
    </button>
  </h2>
</template>
