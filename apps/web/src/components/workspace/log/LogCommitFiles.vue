<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Folder } from 'lucide-vue-next'
import type { CommitDetail, CommitFile } from '@ccm/shared'
import { changesTree } from '../../../lib/changesTree'
import { KIND_CLASS } from '../../../lib/changesView'
import type { ChangeEntry } from '../../../lib/preview'

const props = defineProps<{ detail: CommitDetail | null; loading: boolean; selectedPath: string | null }>()
const emit = defineEmits<{ select: [path: string]; open: [file: CommitFile]; menu: [file: CommitFile, x: number, y: number] }>()
const { t } = useI18n()
const LETTER: Record<CommitFile['kind'], string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', typechange: 'T' }
const ENTRY_KIND: Record<CommitFile['kind'], ChangeEntry['kind']> = { added: 'added', modified: 'modified', deleted: 'deleted', renamed: 'renamed', copied: 'added', typechange: 'modified' }
const collapsed = ref<Set<string>>(new Set())
const files = computed(() => (props.detail?.ok ? props.detail.files : []))
const byPath = computed(() => new Map(files.value.map((f) => [f.path, f])))
const asEntry = (f: CommitFile): ChangeEntry => ({ path: f.path, origPath: f.origPath, x: '.', y: '.', kind: ENTRY_KIND[f.kind], staged: false, added: f.added, removed: f.removed, binary: f.binary })
const rows = computed(() => changesTree(files.value.map(asEntry), collapsed.value))

function toggle(path: string): void {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-col">
    <p class="flex h-7 shrink-0 items-center gap-1 border-b border-line px-2 text-2xs font-semibold text-ink-faint">
      <template v-if="detail?.ok">{{ t('workspace.log.details.files', { n: files.length }, files.length) }}</template>
    </p>
    <p v-if="loading && !detail" class="p-3 text-xs text-ink-faint">{{ t('workspace.log.details.loading') }}</p>
    <p v-else-if="detail?.ok && !files.length" class="p-3 text-xs text-ink-faint">{{ t('workspace.log.details.noFiles') }}</p>
    <div v-else class="ccm-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-0.5" role="tree" :aria-label="t('workspace.log.details.files', { n: files.length }, files.length)" data-log-files>
      <template v-for="r in rows" :key="r.kind === 'dir' ? `d:${r.path}` : `f:${r.entry.path}`">
        <div
          v-if="r.kind === 'dir'"
          role="treeitem"
          :aria-level="r.depth + 1"
          :aria-expanded="r.expanded"
          tabindex="-1"
          class="flex h-[22px] min-w-0 cursor-pointer items-center gap-1 pr-2 text-xs text-ink hover:bg-fill"
          :style="{ paddingLeft: `${6 + r.depth * 14}px` }"
          :title="r.path"
          @click="toggle(r.path)"
        >
          <ChevronRight :size="12" class="shrink-0 text-ink-faint transition-transform" :class="r.expanded ? 'rotate-90' : ''" aria-hidden="true" />
          <Folder :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ r.name }}</span>
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ r.count }}</span>
        </div>
        <div
          v-else
          role="treeitem"
          :aria-level="r.depth + 1"
          :aria-selected="r.entry.path === selectedPath"
          tabindex="0"
          class="flex h-[22px] min-w-0 cursor-pointer items-center gap-1.5 pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
          :class="r.entry.path === selectedPath ? 'bg-selection' : 'hover:bg-fill'"
          :style="{ paddingLeft: `${20 + r.depth * 14}px` }"
          :title="byPath.get(r.entry.path)?.origPath ? `${byPath.get(r.entry.path)!.origPath} → ${r.entry.path}` : r.entry.path"
          :data-log-file="r.entry.path"
          @click="emit('select', r.entry.path)"
          @dblclick="emit('open', byPath.get(r.entry.path)!)"
          @keydown.enter.prevent="emit('open', byPath.get(r.entry.path)!)"
          @contextmenu.prevent="emit('select', r.entry.path), emit('menu', byPath.get(r.entry.path)!, $event.clientX, $event.clientY)"
        >
          <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="KIND_CLASS[r.entry.kind]" aria-hidden="true">{{ LETTER[byPath.get(r.entry.path)!.kind] }}</span>
          <span class="sr-only">{{ t(`workspace.log.kind.${byPath.get(r.entry.path)!.kind}`) }}:</span>
          <span class="min-w-0 flex-1 truncate" :class="KIND_CLASS[r.entry.kind]">{{ r.entry.path.slice(r.entry.path.lastIndexOf('/') + 1) }}</span>
          <span v-if="r.entry.added || r.entry.removed" class="shrink-0 text-2xs tabular">
            <span class="text-diff-add">+{{ r.entry.added ?? 0 }}</span> <span class="text-diff-del">−{{ r.entry.removed ?? 0 }}</span>
          </span>
        </div>
      </template>
      <p v-if="detail?.ok && detail.truncated" class="px-2 py-1 text-2xs text-ink-faint">{{ t('workspace.log.details.truncated', { n: files.length }) }}</p>
    </div>
  </div>
</template>
