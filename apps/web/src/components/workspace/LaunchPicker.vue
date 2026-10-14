<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Asterisk, FileText, Folder, FolderOpen, GitCompare, Globe, Hexagon, House, SquareTerminal, Star, X } from 'lucide-vue-next'
import type { PtyPreset } from '@ccm/shared'
import { desktop } from '../../lib/desktop'
import { devUrlLabel, lastDevUrl } from '../../lib/devServer'
import { shortPath } from '../../lib/format'
import { hasChanges, hasPreview } from '../../lib/preview'
import { dirKey, useFavoritesStore } from '../../stores/favorites'
import { useTerminalsStore } from '../../stores/terminals'
import { useWorkspaceStore } from '../../stores/workspace'
import SegmentedControl from '../ui/SegmentedControl.vue'

/** `cwd`: folder of the focused pane, for Changes and the remembered dev server URL. */
const props = defineProps<{ cwd?: string }>()
const emit = defineEmits<{ launch: [cwd: string | undefined]; browser: [url: string]; openFile: []; changes: [] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const favorites = useFavoritesStore()
const terminals = useTerminalsStore()

const PER_SECTION = 8
const root = ref<HTMLElement | null>(null)
const browsing = ref(false)
let unmounted = false
onBeforeUnmount(() => (unmounted = true))

const presetOptions = computed(() => [
  { value: 'claude' as PtyPreset, label: t('workspace.preset.claude'), icon: Asterisk, iconClass: 'text-agent-claude' },
  { value: 'codex' as PtyPreset, label: t('workspace.preset.codex'), icon: Hexagon, iconClass: 'text-agent-codex' },
  { value: 'shell' as PtyPreset, label: t('workspace.preset.shell'), icon: SquareTerminal, iconClass: 'text-agent-shell' },
])

const devUrl = computed(() => (props.cwd && hasPreview ? lastDevUrl(props.cwd) : null))

interface Row {
  dir: string
  label: string
}

const baseName = (dir: string): string => dir.split(/[\\/]+/).filter(Boolean).pop() ?? dir

const sections = computed(() => {
  const seen = new Set<string>()
  const take = (rows: Row[]): Row[] =>
    rows
      .filter((r) => {
        const key = dirKey(r.dir)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, PER_SECTION)
  return [
    { id: 'recent', icon: Folder, rows: take(workspace.recentDirs.map((dir) => ({ dir, label: baseName(dir) }))) },
    { id: 'favorites', icon: Star, rows: take(favorites.list.map((f) => ({ dir: f.dir, label: f.label || baseName(f.dir) }))) },
    { id: 'sessions', icon: Folder, rows: take(terminals.live.filter((s) => s.cwd).map((s) => ({ dir: s.cwd!, label: baseName(s.cwd!) }))) },
  ].filter((s) => s.rows.length)
})

async function browse(): Promise<void> {
  if (browsing.value || !desktop) return
  browsing.value = true
  try {
    const dir = await desktop.pickFolder(workspace.recentDirs[0])
    // The popover may have closed while the native dialog was up.
    if (dir && !unmounted) emit('launch', dir)
  } finally {
    browsing.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  // Arrows inside the segmented control switch the agent (it handles them itself); Tab reaches the list.
  if ((e.target as HTMLElement).closest('[role="radiogroup"]')) return
  const rows = [...(root.value?.querySelectorAll<HTMLElement>('[data-launch-row]') ?? [])]
  const at = rows.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  if (at < 0) rows[step > 0 ? 0 : rows.length - 1]?.focus()
  else rows[(at + step + rows.length) % rows.length]?.focus()
}

function focusFirst(): void {
  root.value?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus()
}

const ROW =
  'group/row flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'

defineExpose({ focusFirst })
</script>

<template>
  <div ref="root" class="flex min-h-0 flex-col gap-2" @keydown="onKey">
    <SegmentedControl v-model="workspace.preset" :options="presetOptions" :label="t('workspace.launch.agent')" fill />

    <div class="ccm-scroll -mx-1 max-h-[min(52vh,420px)] min-h-0 overflow-y-auto px-1">
      <section v-for="s in sections" :key="s.id" class="pt-1.5" :aria-labelledby="`launch-${s.id}`">
        <h3 :id="`launch-${s.id}`" class="px-2 pb-1 text-2xs font-semibold text-ink-faint">{{ t(`workspace.launch.${s.id}`) }}</h3>
        <ul class="flex flex-col">
          <li v-for="r in s.rows" :key="r.dir" class="group relative">
            <button
              type="button"
              data-launch-row
              class="group/row flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
              :title="r.dir"
              @click="emit('launch', r.dir)"
              @keydown.delete="s.id === 'recent' && workspace.forget(r.dir)"
            >
              <component :is="s.icon" :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />
              <span class="shrink-0 truncate font-medium">{{ r.label }}</span>
              <span class="min-w-0 truncate text-xs text-ink-faint group-focus-visible/row:text-on-accent">{{ shortPath(r.dir) }}</span>
            </button>
            <button
              v-if="s.id === 'recent'"
              type="button"
              class="absolute top-1.5 right-1.5 hidden size-5 cursor-pointer items-center justify-center rounded-[5px] text-ink-faint group-hover:inline-flex hover:bg-fill-strong hover:text-ink"
              :title="t('workspace.launch.forget')"
              :aria-label="`${t('workspace.launch.forget')}: ${r.label}`"
              tabindex="-1"
              @click="workspace.forget(r.dir)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>
      <p v-if="!sections.length" class="px-2 py-3 text-xs text-ink-faint">{{ t('workspace.launch.noFolders') }}</p>
    </div>

    <div v-if="hasPreview" class="flex flex-col border-t border-line pt-1.5">
      <button v-if="devUrl" type="button" data-launch-row :class="ROW" :title="devUrl" @click="emit('browser', devUrl)">
        <Globe :size="14" class="shrink-0 text-agent-browser group-focus-visible/row:text-on-accent" aria-hidden="true" />
        <span class="truncate">{{ t('workspace.open.devUrl', { host: devUrlLabel(devUrl) }) }}</span>
      </button>
      <button type="button" data-launch-row :class="ROW" data-launch="browser" @click="emit('browser', '')">
        <Globe :size="14" class="shrink-0 text-agent-browser group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.open.browser') }}
      </button>
      <button type="button" data-launch-row :class="ROW" data-launch="file" @click="emit('openFile')">
        <FileText :size="14" class="shrink-0 text-agent-file group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.open.openFile') }}
      </button>
      <button
        v-if="hasChanges && cwd"
        type="button"
        data-launch-row
        data-launch="changes"
        :class="ROW"
        :title="cwd"
        @click="emit('changes')"
      >
        <GitCompare :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.open.changes') }}
      </button>
    </div>

    <div class="flex flex-col border-t border-line pt-1.5">
      <button
        type="button"
        data-launch-row
        class="group/row flex h-8 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
        :disabled="browsing"
        @click="browse"
      >
        <FolderOpen :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.launch.browse') }}
      </button>
      <button
        type="button"
        data-launch-row
        class="group/row flex h-8 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
        @click="emit('launch', undefined)"
      >
        <House :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.launch.home') }}
      </button>
    </div>
  </div>
</template>
