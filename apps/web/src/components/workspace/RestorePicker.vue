<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { History, X } from 'lucide-vue-next'
import type { LastProject } from '../../stores/workspace'

const props = defineProps<{ projects: LastProject[]; tabs: number; agents: number }>()
const emit = defineEmits<{ restore: [run: Set<string> | undefined]; dismiss: [] }>()

const { t } = useI18n()

const picked = ref<Set<string>>(new Set())
const pickable = computed(() => props.projects.length > 1)
const allPicked = computed(() => props.projects.every((p) => picked.value.has(p.key)))
const runCount = computed(() => props.projects.filter((p) => picked.value.has(p.key)).reduce((n, p) => n + p.sessions, 0))

function nameOf(p: LastProject): string {
  if (!p.cwd) return t('workspace.restorePick.home')
  const parts = p.cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p.cwd
}

function toggle(key: string): void {
  const next = new Set(picked.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  picked.value = next
}

function toggleAll(): void {
  picked.value = allPicked.value ? new Set() : new Set(props.projects.map((p) => p.key))
}

function restore(): void {
  emit('restore', pickable.value ? new Set(picked.value) : undefined)
}
</script>

<template>
  <section class="flex flex-col gap-2 rounded-control bg-surface p-3 shadow-card" :aria-label="t('workspace.restore.title')" data-restore-picker>
    <div class="flex items-center gap-3">
      <History :size="18" class="shrink-0 text-accent-ink" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-ink">{{ t('workspace.restore.title') }}</p>
        <p class="text-xs text-ink-muted">
          {{ t('workspace.restore.summary', { tabs }, tabs) }}
          <template v-if="agents"> · {{ t('workspace.restore.agents', { n: agents }, agents) }}</template>
        </p>
      </div>
      <button v-if="!pickable" type="button" class="ccm-btn ccm-btn-primary shrink-0" @click="restore">{{ t('workspace.restore.action') }}</button>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.restore.dismiss')" :aria-label="t('workspace.restore.dismiss')" @click="emit('dismiss')">
        <X :size="14" aria-hidden="true" />
      </button>
    </div>
    <template v-if="pickable">
      <p class="text-xs text-ink-muted">{{ t('workspace.restorePick.hint') }}</p>
      <ul class="flex flex-col">
        <li v-for="p in projects" :key="p.key">
          <label class="flex cursor-pointer items-center gap-2 rounded-inner px-1.5 py-1 text-sm hover:bg-fill" :title="p.cwd">
            <input type="checkbox" class="size-4 cursor-pointer accent-accent" :checked="picked.has(p.key)" data-restore-project @change="toggle(p.key)" />
            <span class="min-w-0 flex-1 truncate" :class="picked.has(p.key) ? 'text-ink' : 'text-ink-muted'">{{ nameOf(p) }}</span>
            <span class="shrink-0 text-xs tabular-nums text-ink-faint">{{ t('workspace.restorePick.sessions', { n: p.sessions }, p.sessions) }}</span>
          </label>
        </li>
      </ul>
      <div class="flex items-center gap-2">
        <button type="button" class="ccm-btn-plain px-2! text-xs" @click="toggleAll">{{ allPicked ? t('workspace.restorePick.none') : t('workspace.restorePick.all') }}</button>
        <button type="button" class="ccm-btn ccm-btn-primary ms-auto" data-restore-run @click="restore">
          {{ runCount ? t('workspace.restorePick.run', { n: runCount }, runCount) : t('workspace.restorePick.layoutOnly') }}
        </button>
      </div>
    </template>
  </section>
</template>
