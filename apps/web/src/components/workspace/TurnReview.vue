<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, FileWarning, LoaderCircle, RotateCcw, X } from 'lucide-vue-next'
import { absoluteIn, dirOfRel } from '../../lib/changesView'
import { grammarFor } from '../../lib/codeView'
import { parseUnifiedDiff, type DiffFile } from '../../lib/diff'
import { blockPatch, viewBlocks } from '../../lib/diffBlocks'
import { readDiffOpts } from '../../lib/diffOpts'
import { baseName, cpDiff, cpFileDiff, cpRestore, cpRevertHunk, type Checkpoint, type CheckpointFile } from '../../lib/preview'
import DiffView from './DiffView.vue'

const props = defineProps<{ root: string; before: Checkpoint; after: Checkpoint; title: string }>()
const emit = defineEmits<{ close: []; open: [path: string, keep: boolean] }>()
const { t } = useI18n()

const opts = readDiffOpts()
const card = ref<HTMLElement | null>(null)
const files = shallowRef<CheckpointFile[]>([])
const loading = ref(true)
const selected = ref<string | null>(null)
const diffFile = shallowRef<DiffFile | null>(null)
const diffState = ref<'idle' | 'loading' | 'large' | 'binary' | 'empty' | 'error'>('idle')
const current = ref(0)
const busy = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)
/** Per file: reviewed (kept) or undone, shown as a mark in the list. */
const marks = ref(new Map<string, 'kept' | 'undone'>())

const blocks = computed(() => (diffFile.value ? viewBlocks(diffFile.value, opts.highlight) : []))
const lang = computed(() => (selected.value ? grammarFor(undefined, selected.value) : null))
const sel = computed(() => files.value.find((f) => f.path === selected.value) ?? null)

const errorText = (error: string, detail?: string) => t(`workspace.checkpoints.error.${error}`, { detail: detail ?? '' })

async function load(): Promise<void> {
  const res = await cpDiff(props.root, props.before.id, props.after.id)
  loading.value = false
  files.value = res.ok ? res.files : []
  if (!res.ok) notice.value = { ok: false, text: errorText(res.error, res.detail) }
  if (files.value[0]) await pick(files.value[0].path)
}

async function pick(path: string): Promise<void> {
  selected.value = path
  current.value = 0
  diffFile.value = null
  diffState.value = 'loading'
  const res = await cpFileDiff(props.root, props.before.id, props.after.id, path)
  if (selected.value !== path) return
  if (!res.ok) {
    diffState.value = 'error'
    notice.value = { ok: false, text: errorText(res.error, res.detail) }
    return
  }
  if (res.tooLarge) return void (diffState.value = 'large')
  const parsed = parseUnifiedDiff(res.text)[0] ?? null
  if (!parsed) return void (diffState.value = /^Binary files /m.test(res.text) ? 'binary' : 'empty')
  diffFile.value = parsed
  diffState.value = 'idle'
}

function setMark(path: string, mark: 'kept' | 'undone'): void {
  const next = new Map(marks.value)
  next.set(path, mark)
  marks.value = next
}

async function undoBlock(index: number): Promise<void> {
  const file = diffFile.value
  const block = blocks.value[index]
  const path = selected.value
  if (!file || !block || !path || busy.value) return
  busy.value = true
  const res = await cpRevertHunk(props.root, path, blockPatch(file, block))
  busy.value = false
  notice.value = res.ok ? { ok: true, text: t('workspace.turnReview.undone') } : { ok: false, text: res.error === 'stale' ? t('workspace.turnReview.stale') : errorText(res.error, res.detail) }
  if (res.ok) setMark(path, 'undone')
}

async function undoFile(): Promise<void> {
  const path = selected.value
  if (!path || busy.value) return
  busy.value = true
  const res = await cpRestore(props.root, props.before.id, [path])
  busy.value = false
  if (res.ok) {
    setMark(path, 'undone')
    notice.value = { ok: true, text: t('workspace.turnReview.fileUndone', { name: baseName(path) }) }
  } else if (res.error !== 'cancelled') notice.value = { ok: false, text: errorText(res.error, res.detail) }
}

function keep(): void {
  const path = selected.value
  if (!path) return
  setMark(path, 'kept')
  const i = files.value.findIndex((f) => f.path === path)
  const nextFile = files.value.slice(i + 1).find((f) => !marks.value.has(f.path))
  if (nextFile) void pick(nextFile.path)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

const STATUS_CLASS = { A: 'text-diff-add', D: 'text-diff-del', M: 'text-diff-mod' } as const

onMounted(async () => {
  await nextTick()
  card.value?.focus()
  await load()
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-6" data-turn-review-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(86vh,900px)] w-[min(92vw,1280px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.turnReview.title', { title })"
        data-turn-review
      >
        <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">{{ t('workspace.turnReview.title', { title }) }}</span>
          <LoaderCircle v-if="loading || busy" :size="13" class="ccm-spin shrink-0 text-ink-faint" aria-hidden="true" />
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ t('workspace.turnReview.files', { n: files.length }, files.length) }}</span>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.turnReview.close')" :aria-label="t('workspace.turnReview.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>
        <div class="flex min-h-0 flex-1">
          <ul class="ccm-scroll w-64 shrink-0 overflow-y-auto border-r border-line py-1" :aria-label="t('workspace.turnReview.fileList')">
            <li v-for="f in files" :key="f.path">
              <button
                type="button"
                class="flex h-[26px] w-full min-w-0 cursor-pointer items-center gap-1.5 px-2 text-left text-xs hover:bg-fill"
                :class="selected === f.path ? 'bg-fill text-ink' : 'text-ink-muted'"
                :aria-current="selected === f.path || undefined"
                :data-turn-file="f.path"
                @click="pick(f.path)"
              >
                <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="STATUS_CLASS[f.status]" :title="t(`workspace.checkpoints.status.${f.status}`)">{{ f.status }}</span>
                <span class="min-w-0 flex-1 truncate">{{ baseName(f.path) }}<span v-if="dirOfRel(f.path)" class="ml-1.5 text-ink-faint">{{ dirOfRel(f.path) }}</span></span>
                <Check v-if="marks.get(f.path) === 'kept'" :size="12" class="shrink-0 text-success" :aria-label="t('workspace.turnReview.kept')" />
                <RotateCcw v-else-if="marks.get(f.path) === 'undone'" :size="12" class="shrink-0 text-diff-del" :aria-label="t('workspace.turnReview.undoneMark')" />
              </button>
            </li>
            <li v-if="!loading && !files.length" class="px-3 py-2 text-2xs text-ink-faint">{{ t('workspace.checkpoints.same') }}</li>
          </ul>
          <div class="flex min-w-0 flex-1 flex-col">
            <div v-if="sel" class="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-xs">
              <button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left text-ink hover:underline" :disabled="sel.status === 'D'" @click="emit('open', absoluteIn(root, sel.path), false)">{{ sel.path }}</button>
              <button type="button" class="ccm-btn h-6 gap-1 text-2xs" :disabled="busy" data-turn-keep @click="keep">
                <Check :size="12" aria-hidden="true" />{{ t('workspace.turnReview.keep') }}
              </button>
              <button type="button" class="ccm-btn h-6 gap-1 text-2xs" :disabled="busy" data-turn-undo-file @click="undoFile">
                <RotateCcw :size="12" aria-hidden="true" />{{ t('workspace.turnReview.undoFile') }}
              </button>
            </div>
            <p v-if="notice" class="shrink-0 border-b border-line px-3 py-1 text-2xs" :class="notice.ok ? 'text-ink-muted' : 'text-st-error'" role="status">{{ notice.text }}</p>
            <div class="ccm-scroll min-h-0 flex-1 overflow-auto">
              <div v-if="diffState === 'loading'" class="grid h-full place-items-center text-xs text-ink-faint">{{ t('workspace.viewer.loading') }}</div>
              <div v-else-if="diffState !== 'idle' && diffState !== 'error'" class="grid h-full place-items-center p-6 text-center text-xs text-ink-muted">
                <span class="flex flex-col items-center gap-2"><FileWarning :size="22" aria-hidden="true" />{{ t(`workspace.turnReview.state.${diffState}`) }}</span>
              </div>
              <DiffView
                v-else-if="diffFile"
                :file="diffFile"
                :blocks="blocks"
                layout="inline"
                :lang="lang"
                :collapse="true"
                :context="3"
                :highlight="opts.highlight"
                :can-revert="!busy"
                :current="current"
                :sides="{ left: t('workspace.turnReview.before'), right: t('workspace.turnReview.after') }"
                @revert="undoBlock"
                @focus-block="(i: number) => (current = i)"
              />
            </div>
          </div>
        </div>
        <footer class="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2 text-2xs text-ink-faint">
          <span class="min-w-0 flex-1">{{ t('workspace.turnReview.hint') }}</span>
          <button type="button" class="ccm-btn ccm-btn-primary h-7 text-xs" @click="emit('close')">{{ t('workspace.turnReview.done') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
