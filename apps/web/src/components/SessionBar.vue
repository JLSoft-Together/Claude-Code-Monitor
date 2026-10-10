<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Keyboard } from 'lucide-vue-next'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import KeyHint from './KeyHint.vue'
import MetricsStrip from './MetricsStrip.vue'
import SessionSummary from './SessionSummary.vue'
import SessionTabs from './SessionTabs.vue'

const { t } = useI18n()
const ui = useUiStore()
const terminals = useTerminalsStore()

const top = computed(() => ui.barDock === 'top')
const terminal = computed(() => (ui.sessionTab ? terminals.byId[ui.sessionTab] : undefined))
// The chevron points where the summary row goes when it collapses.
const collapseIcon = computed(() => (ui.barMin === top.value ? ChevronDown : ChevronUp))
</script>

<template>
  <section
    :aria-label="t('bar.label')"
    class="flex shrink-0 bg-surface"
    :class="top ? 'flex-col border-b border-line' : 'flex-col-reverse border-t border-line'"
  >
    <div class="flex min-w-0 items-center gap-2 px-3">
      <SessionTabs class="min-w-0 flex-1" />
      <div class="flex shrink-0 items-center gap-0.5 border-l border-line pl-2" role="toolbar" :aria-label="t('bar.label')">
        <button
          type="button"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="t('keys.title')"
          :title="t('keys.title')"
          aria-keyshortcuts="?"
          @click="ui.shortcutsOpen = true"
        >
          <Keyboard :size="16" aria-hidden="true" /><KeyHint keys="?" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-label="top ? t('bar.dockBottom') : t('bar.dockTop')"
          :title="top ? t('bar.dockBottom') : t('bar.dockTop')"
          aria-keyshortcuts="Shift+B"
          @click="ui.toggleBarDock()"
        >
          <component :is="top ? ArrowDownToLine : ArrowUpToLine" :size="16" aria-hidden="true" /><KeyHint keys="⇧B" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          :aria-expanded="!ui.barMin"
          :aria-label="ui.barMin ? t('bar.expand') : t('bar.collapse')"
          :title="ui.barMin ? t('bar.expand') : t('bar.collapse')"
          aria-keyshortcuts="B"
          @click="ui.toggleBar()"
        >
          <component :is="collapseIcon" :size="16" aria-hidden="true" /><KeyHint keys="B" />
        </button>
      </div>
    </div>
    <div v-if="!ui.barMin" class="flex min-h-11 min-w-0 items-center border-line px-3 py-1" :class="top ? 'border-t' : 'border-b'">
      <SessionSummary v-if="terminal" :terminal="terminal" />
      <MetricsStrip v-else compact class="flex-1" />
    </div>
  </section>
</template>
