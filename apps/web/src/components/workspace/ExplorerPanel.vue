<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { createTargetDirectory, relativeTo, rootName } from '../../lib/explorer/tree'
import { hasExplorer } from '../../lib/preview'
import { useExplorerChanges } from '../../composables/useExplorerChanges'
import { useExplorerStore, type ExplorerView } from '../../stores/explorer'
import CreateEntryDialog from './CreateEntryDialog.vue'
import ExplorerChanges from './ExplorerChanges.vue'
import ExplorerTree from './ExplorerTree.vue'

const props = defineProps<{
  /** Project root of the focused pane; null keeps the last one. */
  root: string | null
  /** Path of the focused file viewer, if any. */
  activePath: string | null
  /** Workspace on screen: the Changes view watches git only then. */
  visible: boolean
}>()
const emit = defineEmits<{ open: [path: string, keep: boolean]; openDiff: [root: string] }>()

const { t } = useI18n()
const explorer = useExplorerStore()

watch(
  () => props.root,
  (r) => explorer.setRoot(r),
  { immediate: true },
)
onMounted(() => explorer.attach())
onBeforeUnmount(() => explorer.detach())

const changesActive = computed(() => props.visible && explorer.view === 'changes')
const changes = useExplorerChanges(toRef(explorer, 'root'), changesActive)

// A plain folder has no Changes view.
watch(changes.isRepo, (repo) => {
  if (!repo && explorer.view === 'changes') explorer.setView('files')
})

const VIEWS: ExplorerView[] = ['files', 'changes']
const tabs = ref<HTMLElement | null>(null)

function onTabKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const next: ExplorerView = explorer.view === 'files' && changes.isRepo.value ? 'changes' : 'files'
  explorer.setView(next)
  tabs.value?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus()
}

const createRequest = ref<{ kind: 'file' | 'directory'; parent: string } | null>(null)
const dialog = computed(() =>
  createRequest.value && explorer.root
    ? { kind: createRequest.value.kind, where: relativeTo(explorer.root, createRequest.value.parent), rootName: rootName(explorer.root) }
    : null,
)

function askCreate(kind: 'file' | 'directory'): void {
  if (!explorer.root) return
  createRequest.value = { kind, parent: createTargetDirectory(explorer.rows, explorer.state.focused, explorer.root) }
}

async function create(name: string): Promise<void> {
  const req = createRequest.value
  createRequest.value = null
  if (!req) return
  const path = await explorer.create(req.parent, name, req.kind)
  if (path && req.kind === 'file') emit('open', path, false)
}

const statusText = computed(() => {
  const s = explorer.status
  if (!s) return null
  const reason = s.reason ? t(`workspace.explorer.name.${s.reason}`) : ''
  return t(`workspace.explorer.status.${s.key}`, { name: s.name, reason })
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-1" :aria-label="t('workspace.explorer.title')" data-explorer>
    <p v-if="!hasExplorer" class="px-2 py-3 text-xs text-ink-muted">{{ t('workspace.explorer.unavailable') }}</p>
    <p v-else-if="!explorer.root" class="px-2 py-3 text-xs text-ink-muted">{{ t('workspace.explorer.noRoot') }}</p>
    <template v-else>
      <div ref="tabs" class="flex shrink-0 rounded-inner bg-fill p-0.5" role="tablist" :aria-label="t('workspace.explorer.views')" @keydown="onTabKey">
        <button
          v-for="v in VIEWS"
          :key="v"
          type="button"
          role="tab"
          :data-view="v"
          :aria-selected="explorer.view === v"
          :tabindex="explorer.view === v ? 0 : -1"
          :disabled="v === 'changes' && !changes.isRepo.value"
          :title="v === 'changes' && !changes.isRepo.value ? t('workspace.explorer.notRepo') : undefined"
          class="flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast) disabled:cursor-default disabled:opacity-50"
          :class="explorer.view === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          @click="explorer.setView(v)"
        >
          {{ t(`workspace.explorer.${v}`) }}
          <span
            v-if="v === 'changes' && changes.totals.value && (changes.totals.value.added || changes.totals.value.removed)"
            class="tabular"
            :aria-label="t('workspace.explorer.changesView.totals', changes.totals.value)"
          >
            <span v-if="changes.totals.value.added" class="text-diff-add">+{{ changes.totals.value.added }}</span>
            <span v-if="changes.totals.value.removed" class="ml-0.5 text-diff-del">−{{ changes.totals.value.removed }}</span>
          </span>
        </button>
      </div>

      <p
        v-if="statusText"
        class="flex shrink-0 items-start gap-1 rounded-inner px-2 py-1 text-xs"
        :class="explorer.status?.failed ? 'bg-st-error-soft text-ink' : 'bg-fill text-ink-muted'"
        role="status"
      >
        <span class="min-w-0 flex-1">{{ statusText }}</span>
        <button type="button" class="shrink-0 cursor-pointer text-ink-faint hover:text-ink" :title="t('workspace.explorer.status.dismiss')" :aria-label="t('workspace.explorer.status.dismiss')" @click="explorer.clearStatus()">
          <X :size="12" aria-hidden="true" />
        </button>
      </p>

      <ExplorerTree v-if="explorer.view === 'files'" :active-path="activePath" @open="(p, keep) => emit('open', p, keep)" @create="askCreate" />
      <ExplorerChanges
        v-else
        :status="changes.status.value"
        :reading="changes.reading.value"
        @open="(p, keep) => emit('open', p, keep)"
        @open-diff="(r) => emit('openDiff', r)"
        @refresh="changes.refresh()"
      />
    </template>
    <CreateEntryDialog :request="dialog" @create="create" @close="createRequest = null" />
  </section>
</template>
