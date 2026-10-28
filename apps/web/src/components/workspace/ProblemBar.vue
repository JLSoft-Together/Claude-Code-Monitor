<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, CircleX, TriangleAlert } from 'lucide-vue-next'
import type { FileProblems } from '../../lib/problems'
import { isMac } from '../../lib/platform'

const props = defineProps<{ problems: FileProblems; index: number; stale: boolean }>()
const emit = defineEmits<{ step: [dir: 1 | -1] }>()
const { t } = useI18n()

const current = computed(() => props.problems.items[props.index] ?? null)
const prevKey = isMac ? '⇧F8' : 'Shift+F8'
</script>

<template>
  <div class="flex shrink-0 items-center gap-2 border-b border-line bg-fill px-3 py-1 text-2xs" role="status" data-file-problems>
    <span class="inline-flex shrink-0 items-center gap-2 font-medium">
      <span v-if="problems.errors" class="inline-flex items-center gap-1 text-st-error"><CircleX :size="13" aria-hidden="true" />{{ t('workspace.problems.errors', { n: problems.errors }, problems.errors) }}</span>
      <span v-if="problems.warnings" class="inline-flex items-center gap-1 text-warning"><TriangleAlert :size="13" aria-hidden="true" />{{ t('workspace.problems.warnings', { n: problems.warnings }, problems.warnings) }}</span>
    </span>
    <span v-if="current" class="min-w-0 flex-1 truncate text-ink-muted" :title="current.message">
      <span class="tabular-nums text-ink-faint">{{ t('workspace.problems.at', { line: current.line }) }}</span> {{ current.message }}
    </span>
    <span v-else class="min-w-0 flex-1 truncate text-ink-faint">{{ t('workspace.problems.from', { check: problems.label }) }}</span>
    <span v-if="stale" class="shrink-0 text-ink-faint" :title="t('workspace.problems.staleTitle')">{{ t('workspace.problems.stale') }}</span>
    <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.problems.prev')" :title="`${t('workspace.problems.prev')} (${prevKey})`" @click="emit('step', -1)">
      <ChevronUp :size="14" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.problems.next')" :title="`${t('workspace.problems.next')} (F8)`" data-problem-next @click="emit('step', 1)">
      <ChevronDown :size="14" aria-hidden="true" />
    </button>
  </div>
</template>
