<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileWarning, GitBranch, GitCompare, RotateCw, SquareArrowOutUpRight, Undo2 } from 'lucide-vue-next'
import { absoluteIn, dirOfRel, groupChanges, KIND_CLASS, KIND_LETTER, samePath } from '../../lib/changesView'
import { grammarFor } from '../../lib/codeView'
import { firstChangedLine, hunkPatch, parseUnifiedDiff, type DiffFile } from '../../lib/diff'
import { isMac } from '../../lib/platform'
import {
  baseName,
  changesDiff,
  changesDiscard,
  changesStatus,
  changesUnwatch,
  changesWatch,
  hasChanges,
  onChangesUpdated,
  type ChangeEntry,
  type ChangesError,
} from '../../lib/preview'
import DiffView from './DiffView.vue'
import DiscardConfirm from './DiscardConfirm.vue'

const props = withDefaults(defineProps<{ cwd: string; active?: boolean }>(), { active: true })
const emit = defineEmits<{
  /** Absolute path + first changed line (new side). */
  open: [path: string, line?: number]
  /** Number of changed files, for the tab label "Changes (N)". */
  count: [n: number]
  /** Repo toplevel once known (the tab is keyed per worktree root). */
  root: [root: string]
}>()

const { t } = useI18n()
const LAYOUT_KEY = 'ccm.workspace.diffLayout'
const repoRoot = ref<string | null>(null)
const branch = ref<string | null>(null)
const entries = shallowRef<ChangeEntry[]>([])
const truncated = ref(false)
const statusError = ref<ChangesError | null>(null)
const loading = ref(true)
const selected = ref<string | null>(null)
const diffFile = shallowRef<DiffFile | null>(null)
const diffState = ref<'idle' | 'loading' | 'binary' | 'too-large' | 'empty' | 'error'>('idle')
const diffError = ref<ChangesError | null>(null)
const notice = ref<string | null>(null)
const currentHunk = ref(0)
const layout = ref<'inline' | 'split'>(readLayout())
const pending = ref<{ entry: ChangeEntry; hunk?: number } | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const diffView = ref<InstanceType<typeof DiffView> | null>(null)
let statusSeq = 0
let diffSeq = 0
let watched: string | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function readLayout(): 'inline' | 'split' {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'split' ? 'split' : 'inline'
  } catch {
    return 'inline'
  }
}

watch(layout, (v) => {
  try {
    localStorage.setItem(LAYOUT_KEY, v)
  } catch {
    // storage unavailable
  }
})

const groups = computed(() => groupChanges(entries.value))
const ordered = computed(() => groups.value.flatMap((g) => g.items))
const selectedEntry = computed(() => entries.value.find((e) => e.path === selected.value) ?? null)
const canDiscardHunks = computed(() => selectedEntry.value?.kind === 'modified' && !!diffFile.value?.hunks.length)

const absolute = (rel: string): string => absoluteIn(repoRoot.value ?? props.cwd, rel)

async function loadStatus(): Promise<void> {
  const run = ++statusSeq
  const res = await changesStatus(repoRoot.value ?? props.cwd)
  if (run !== statusSeq) return
  loading.value = false
  if (!res.ok) {
    statusError.value = res.error
    entries.value = []
    emit('count', 0)
    return
  }
  statusError.value = null
  if (repoRoot.value !== res.root) {
    repoRoot.value = res.root
    emit('root', res.root)
    void setWatch(res.root)
  }
  branch.value = res.branch
  entries.value = res.entries
  truncated.value = res.truncated
  emit('count', res.entries.length)
  if (!selected.value || !res.entries.some((e) => e.path === selected.value)) selected.value = ordered.value[0]?.path ?? null
  else void loadDiff(true)
}

async function loadDiff(keepPosition = false): Promise<void> {
  const run = ++diffSeq
  const entry = selectedEntry.value
  if (!entry || !repoRoot.value) {
    diffFile.value = null
    diffState.value = 'idle'
    return
  }
  if (!keepPosition) {
    diffState.value = 'loading'
    currentHunk.value = 0
  }
  const res = await changesDiff(repoRoot.value, entry.path)
  if (run !== diffSeq) return
  if (!res.ok) {
    diffError.value = res.error
    diffState.value = 'error'
    diffFile.value = null
    return
  }
  if (res.binary || res.tooLarge) {
    diffState.value = res.binary ? 'binary' : 'too-large'
    diffFile.value = null
    return
  }
  const file = parseUnifiedDiff(res.text)[0] ?? null
  diffFile.value = file
  diffState.value = file?.hunks.length ? 'idle' : 'empty'
  if (currentHunk.value >= (file?.hunks.length ?? 0)) currentHunk.value = 0
}

watch(selected, () => void loadDiff())

async function setWatch(root: string | null): Promise<void> {
  if (watched === root) return
  if (watched) void changesUnwatch(watched)
  watched = root
  if (root && !(await changesWatch(root)) && watched === root) watched = null
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void loadStatus()
  }, 250)
}

const offUpdated = onChangesUpdated((c) => {
  if (repoRoot.value && samePath(c.root, repoRoot.value)) scheduleRefresh()
})

function onWindowFocus(): void {
  if (props.active) scheduleRefresh()
}

function select(path: string, focus = false): void {
  selected.value = path
  if (focus) void nextTick(() => listEl.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}

function stepFile(dir: 1 | -1): void {
  const list = ordered.value
  if (!list.length) return
  const at = list.findIndex((e) => e.path === selected.value)
  const next = list[Math.max(0, Math.min(list.length - 1, at + dir))]
  if (next) select(next.path, true)
}

function stepHunk(dir: 1 | -1): void {
  const total = diffFile.value?.hunks.length ?? 0
  if (!total) return
  currentHunk.value = Math.max(0, Math.min(total - 1, currentHunk.value + dir))
  void diffView.value?.scrollToHunk(currentHunk.value)
}

function onKey(e: KeyboardEvent): void {
  if (pending.value || e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const key = e.key
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    // Arrows keep scrolling the diff when focus is there.
    if (!listEl.value?.contains(target) && target !== rootEl.value) return
    e.preventDefault()
    stepFile(key === 'ArrowDown' ? 1 : -1)
  } else if (key === 'j' || key === 'J' || key === 'k' || key === 'K') {
    e.preventDefault()
    stepHunk(key.toLowerCase() === 'j' ? 1 : -1)
  } else if (key === 'Home' || key === 'End') {
    if (!listEl.value?.contains(target)) return
    e.preventDefault()
    const list = ordered.value
    const pick = key === 'Home' ? list[0] : list[list.length - 1]
    if (pick) select(pick.path, true)
  }
}

function openSelected(): void {
  const entry = selectedEntry.value
  if (!entry || entry.kind === 'deleted') return
  emit('open', absolute(entry.path), diffFile.value ? firstChangedLine(diffFile.value) : undefined)
}

const trashName = computed(() => t(`workspace.changes.trash.${isMac ? 'mac' : 'win'}`))

const confirmText = computed(() => {
  const p = pending.value
  if (!p) return null
  const name = baseName(p.entry.path)
  const out: string[] = []
  let preview: string[] = []
  if (p.hunk !== undefined) {
    const h = diffFile.value?.hunks[p.hunk]
    const added = h?.lines.filter((l) => l.type === 'add').length ?? 0
    const removed = h?.lines.filter((l) => l.type === 'del').length ?? 0
    out.push(t('workspace.changes.confirm.lines', { added, removed }))
    preview = (h?.lines ?? []).filter((l) => l.type === 'add' || l.type === 'del').slice(0, 12).map((l) => `${l.type === 'add' ? '+' : '−'} ${l.text}`)
    out.push(t('workspace.changes.confirm.noUndo'))
    return { title: t('workspace.changes.confirm.titleHunk', { name }), lines: out, preview }
  }
  const e = p.entry
  if (e.kind === 'untracked') out.push(t('workspace.changes.confirm.untracked', { trash: trashName.value }))
  else if (e.kind === 'added') out.push(t('workspace.changes.confirm.added', { trash: trashName.value }))
  else if (e.kind === 'renamed') out.push(t('workspace.changes.confirm.renamed', { name, orig: baseName(e.origPath ?? ''), trash: trashName.value }))
  else if (e.kind === 'deleted') out.push(t('workspace.changes.confirm.deleted'))
  if (e.kind === 'modified' || e.kind === 'renamed' || e.kind === 'added' || e.kind === 'untracked') {
    if (e.added !== undefined || e.removed !== undefined) out.push(t('workspace.changes.confirm.lines', { added: e.added ?? 0, removed: e.removed ?? 0 }))
  }
  if (e.staged) out.push(t('workspace.changes.confirm.staged'))
  if (e.kind === 'modified') out.push(t('workspace.changes.confirm.noUndo'))
  return { title: t('workspace.changes.confirm.titleFile', { name }), lines: out, preview }
})

function askDiscard(hunk?: number): void {
  const entry = selectedEntry.value
  if (!entry || entry.kind === 'conflict') return
  pending.value = { entry, hunk }
}

async function confirmDiscard(): Promise<void> {
  const p = pending.value
  const root = repoRoot.value
  pending.value = null
  if (!p || !root) return
  const file = diffFile.value
  const hunk = p.hunk !== undefined && file ? file.hunks[p.hunk] : undefined
  const res = await changesDiscard(root, p.entry.path, hunk && file ? hunkPatch(file, hunk) : undefined)
  if (res.ok) notice.value = null
  else if (res.error === 'failed') notice.value = t('workspace.changes.discardFailed', { detail: res.detail ?? '' })
  else notice.value = t(`workspace.changes.error.${res.error}`)
  await loadStatus()
}

watch(
  () => props.active,
  (active) => {
    if (active) scheduleRefresh()
  },
)

watch(
  () => props.cwd,
  () => {
    repoRoot.value = null
    selected.value = null
    loading.value = true
    void loadStatus()
  },
)

onMounted(() => {
  window.addEventListener('focus', onWindowFocus)
  if (hasChanges) void loadStatus()
  else loading.value = false
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
  offUpdated()
  if (refreshTimer) clearTimeout(refreshTimer)
  void setWatch(null)
})

const lang = computed(() => (selectedEntry.value ? grammarFor(undefined, selectedEntry.value.path) : null))
const countsLabel = (e: ChangeEntry): string => t('workspace.changes.counts', { added: e.added ?? 0, removed: e.removed ?? 0 })
</script>

<template>
  <section
    ref="rootEl"
    tabindex="-1"
    class="@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card outline-none"
    :aria-label="t('workspace.changes.title')"
    @keydown="onKey"
  >
    <div class="ccm-material flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2" role="toolbar" :aria-label="t('workspace.changes.toolbar')">
      <GitCompare :size="15" class="mr-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span class="shrink-0 text-xs font-semibold text-ink">{{ t('workspace.changes.title') }}</span>
      <span v-if="entries.length" class="shrink-0 rounded-full bg-fill px-1.5 text-2xs tabular text-ink-muted">{{ entries.length }}</span>
      <span v-if="branch" class="ml-1 hidden min-w-0 items-center gap-1 truncate text-2xs text-ink-faint @md:inline-flex" :title="repoRoot ?? cwd">
        <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ branch }}</span>
      </span>
      <span class="min-w-0 flex-1" />
      <div class="flex shrink-0 rounded-inner bg-fill p-0.5" role="radiogroup" :aria-label="t('workspace.changes.layout')">
        <button
          v-for="v in ['inline', 'split'] as const"
          :key="v"
          type="button"
          role="radio"
          :aria-checked="layout === v"
          class="h-6 cursor-pointer rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast)"
          :class="layout === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          @click="layout = v"
        >
          {{ t(`workspace.changes.${v}`) }}
        </button>
      </div>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.changes.refresh')" :aria-label="t('workspace.changes.refresh')" @click="loadStatus">
        <RotateCw :size="14" aria-hidden="true" />
      </button>
      <slot name="end" />
    </div>

    <p v-if="notice" class="flex shrink-0 items-center gap-1.5 border-b border-line bg-st-waiting-soft px-3 py-1.5 text-xs text-ink" role="status">
      <FileWarning :size="13" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate" :title="notice">{{ notice }}</span>
    </p>

    <div v-if="!hasChanges || statusError" class="grid min-h-0 flex-1 place-items-center p-6">
      <div class="flex max-w-sm flex-col items-center gap-2 text-center">
        <FileWarning :size="26" class="text-ink-faint" aria-hidden="true" />
        <p class="text-sm text-ink-muted">{{ !hasChanges ? t('workspace.changes.unavailable') : t(`workspace.changes.error.${statusError}`) }}</p>
      </div>
    </div>
    <div v-else-if="loading" class="grid min-h-0 flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('workspace.changes.loading') }}</div>
    <div v-else-if="!entries.length" class="grid min-h-0 flex-1 place-items-center p-6">
      <div class="flex max-w-sm flex-col items-center gap-1.5 text-center">
        <GitCompare :size="26" class="text-ink-faint" aria-hidden="true" />
        <p class="text-sm font-medium text-ink">{{ t('workspace.changes.empty') }}</p>
        <p class="text-xs text-ink-muted">{{ t('workspace.changes.emptyHint') }}</p>
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col @2xl:flex-row">
      <div
        ref="listEl"
        class="ccm-scroll max-h-[38%] shrink-0 overflow-y-auto border-b border-line py-1 @2xl:max-h-none @2xl:w-64 @2xl:border-r @2xl:border-b-0"
        role="listbox"
        :aria-label="t('workspace.changes.files')"
      >
        <div v-for="g in groups" :key="g.key" role="group" :aria-labelledby="`chg-${g.key}`">
          <p :id="`chg-${g.key}`" class="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-2xs font-semibold text-ink-faint">
            {{ t(`workspace.changes.groups.${g.key}`) }}
            <span class="tabular font-normal">{{ g.items.length }}</span>
          </p>
          <div
            v-for="e in g.items"
            :key="e.path"
            role="option"
            :aria-selected="e.path === selected"
            :tabindex="e.path === selected ? 0 : -1"
            class="mx-1 flex h-7 cursor-pointer items-center gap-2 rounded-inner px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus"
            :class="e.path === selected ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
            :title="e.origPath ? `${t('workspace.changes.renamedFrom', { path: e.origPath })}\n${e.path}` : e.path"
            @click="select(e.path)"
            @dblclick="openSelected"
          >
            <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="e.path === selected ? 'text-accent-ink' : KIND_CLASS[e.kind]" aria-hidden="true">{{
              KIND_LETTER[e.kind]
            }}</span>
            <span class="sr-only">{{ t(`workspace.changes.kind.${e.kind}`) }}{{ e.staged ? `, ${t('workspace.changes.staged')}` : '' }}:</span>
            <span class="min-w-0 flex-1 truncate">
              <span class="font-medium">{{ baseName(e.path) }}</span>
              <span v-if="dirOfRel(e.path)" class="ml-1.5" :class="e.path === selected ? 'text-accent-ink' : 'text-ink-faint'" dir="rtl"
                ><bdi>{{ dirOfRel(e.path) }}</bdi></span
              >
            </span>
            <span v-if="!e.binary && (e.added || e.removed)" class="shrink-0 text-2xs tabular" :aria-label="countsLabel(e)">
              <span v-if="e.added" class="text-diff-add">+{{ e.added }}</span>
              <span v-if="e.removed" class="ml-1 text-diff-del">−{{ e.removed }}</span>
            </span>
          </div>
        </div>
        <p v-if="truncated" class="px-3 py-2 text-2xs text-ink-faint">{{ t('workspace.changes.truncated', { n: entries.length }) }}</p>
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-well">
        <div v-if="selectedEntry" class="flex h-8 min-w-0 shrink-0 items-center gap-1 border-b border-well-line px-2 text-well-ink">
          <span class="min-w-0 flex-1 truncate font-mono text-2xs" :title="absolute(selectedEntry.path)">
            <template v-if="selectedEntry.origPath">{{ selectedEntry.origPath }} → </template>{{ selectedEntry.path }}
          </span>
          <span class="hidden shrink-0 text-2xs text-well-ink @lg:inline">{{ t('workspace.changes.keysHint') }}</span>
          <button
            v-if="selectedEntry.kind !== 'deleted'"
            type="button"
            class="well-btn ccm-btn-plain shrink-0 gap-1 text-2xs"
            :title="t('workspace.changes.openFile')"
            @click="openSelected"
          >
            <SquareArrowOutUpRight :size="13" aria-hidden="true" />
            <span class="hidden @md:inline">{{ t('workspace.changes.openFile') }}</span>
            <span class="sr-only @md:hidden">{{ t('workspace.changes.openFile') }}</span>
          </button>
          <button
            v-if="selectedEntry.kind !== 'conflict'"
            type="button"
            class="well-btn well-danger ccm-btn-plain shrink-0 gap-1 text-2xs"
            :title="t('workspace.changes.discardFile')"
            @click="askDiscard()"
          >
            <Undo2 :size="13" aria-hidden="true" />
            <span class="hidden @md:inline">{{ t('workspace.changes.discardFile') }}</span>
            <span class="sr-only @md:hidden">{{ t('workspace.changes.discardFile') }}</span>
          </button>
        </div>
        <div class="ccm-scroll min-h-0 flex-1 overflow-auto">
          <div v-if="!selectedEntry" class="grid size-full place-items-center p-6 text-sm text-well-ink">{{ t('workspace.changes.selectFile') }}</div>
          <div v-else-if="diffState === 'loading'" class="grid size-full place-items-center text-xs text-well-ink" role="status">{{ t('workspace.changes.loading') }}</div>
          <div v-else-if="diffState !== 'idle' || !diffFile" class="grid size-full place-items-center p-6 text-center text-sm text-well-ink">
            {{
              diffState === 'binary'
                ? t('workspace.changes.binary')
                : diffState === 'too-large'
                  ? t('workspace.changes.tooLarge')
                  : diffState === 'error' && diffError
                    ? t(`workspace.changes.error.${diffError}`)
                    : t('workspace.changes.noDiff')
            }}
          </div>
          <DiffView
            v-else
            ref="diffView"
            :file="diffFile"
            :layout="layout"
            :lang="lang"
            :can-discard-hunks="canDiscardHunks"
            :current-hunk="currentHunk"
            @discard-hunk="askDiscard"
            @focus-hunk="(i) => (currentHunk = i)"
          />
        </div>
      </div>
    </div>

    <DiscardConfirm
      v-if="pending && confirmText"
      :title="confirmText.title"
      :lines="confirmText.lines"
      :preview="confirmText.preview"
      @confirm="confirmDiscard"
      @cancel="pending = null"
    />
  </section>
</template>

<style scoped>
/* Buttons on the dark well keep well ink; hover tints stay inside the well. */
.well-btn {
  min-height: 24px;
  color: var(--ccm-well-ink);
}
.well-btn:hover:not(:disabled) {
  background: var(--ccm-well-line);
  color: var(--ccm-well-ink);
}
.well-danger:hover:not(:disabled) {
  color: var(--ccm-diff-del-well, #ff6961);
}
</style>
