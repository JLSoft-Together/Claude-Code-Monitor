<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CornerDownLeft, Eye, LoaderCircle, NotebookPen, Pencil, X } from 'lucide-vue-next'
import { grammarFor } from '../../lib/codeView'
import { joinPath } from '../../lib/fileLinks'
import { renderMarkdown } from '../../lib/markdown'
import { linkNoteTokens, notePathIn } from '../../lib/noteLinks'
import { baseName, notesRead, notesWrite, openExternal, type NoteError } from '../../lib/preview'
import { useWorkspaceStore, workCwd } from '../../stores/workspace'

const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'))

const props = defineProps<{ root: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()

const SAVE_MS = 600
const MODE_KEY = 'ccm.notes.mode'
type Mode = 'edit' | 'preview'
const readMode = (): Mode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'preview' ? 'preview' : 'edit'
  } catch {
    return 'edit'
  }
}

const mode = ref<Mode>(readMode())
const loaded = ref(false)
const text = ref('')
const savedText = ref('')
const saving = ref(false)
const error = ref<NoteError | null>(null)
const editor = ref<{ text: () => string; focus: () => void } | null>(null)
const article = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

const grammar = grammarFor(undefined, 'notes.md')
const target = (() => {
  if (!workspace.activeKey) return null
  const r = workspace.resolveAgentPane(workspace.activeKey)
  return 'pane' in r ? r.pane : null
})()
const targetLabel = target ? (target.title ?? workCwd(target) ?? target.preset) : null

onMounted(async () => {
  if (!props.root) return
  const res = await notesRead(props.root)
  if (res.ok) text.value = savedText.value = res.text
  else error.value = res.error
  loaded.value = true
  await nextTick()
  if (mode.value === 'edit') editor.value?.focus()
  else card.value?.focus()
})

async function save(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  if (!props.root || !loaded.value || text.value === savedText.value) return
  const next = text.value
  saving.value = true
  const res = await notesWrite(props.root, next)
  saving.value = false
  if (res.ok) {
    savedText.value = next
    error.value = null
  } else error.value = res.error
}

function onChange(): void {
  text.value = editor.value?.text() ?? text.value
  clearTimeout(timer)
  timer = setTimeout(() => void save(), SAVE_MS)
}

function setMode(next: Mode): void {
  if (mode.value === 'edit') text.value = editor.value?.text() ?? text.value
  mode.value = next
  try {
    localStorage.setItem(MODE_KEY, next)
  } catch {
    // storage unavailable
  }
  if (next === 'preview') void save()
}

const html = computed(() => (mode.value === 'preview' ? renderMarkdown(text.value) : ''))
watch(html, () => void nextTick(() => article.value && linkNoteTokens(article.value)), { flush: 'post' })

function onArticleClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a || !props.root) return
  e.preventDefault()
  const notePath = a.dataset.notePath
  if (notePath) {
    const line = Number(a.dataset.noteLine) || undefined
    void close().then(() => workspace.openFile(notePathIn(props.root!, notePath), line, { cwd: props.root! }))
    return
  }
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) void openExternal(href)
  else if (href && !href.startsWith('#')) void close().then(() => workspace.openFile(joinPath(props.root!, href.split('#')[0]!), undefined, { cwd: props.root! }))
}

async function close(): Promise<void> {
  if (mode.value === 'edit') text.value = editor.value?.text() ?? text.value
  emit('close')
  await save()
}

async function fill(): Promise<void> {
  const note = (mode.value === 'edit' ? (editor.value?.text() ?? text.value) : text.value).trim()
  if (!target || !note) return
  await close()
  workspace.insertInto(target.key, note)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    void close()
  }
}

onBeforeUnmount(() => {
  if (timer) void save()
})

const status = computed(() => {
  if (error.value) return { kind: 'error' as const, text: t(`workspace.notes.error.${error.value}`) }
  if (saving.value) return { kind: 'busy' as const, text: t('workspace.notes.saving') }
  if (loaded.value && text.value === savedText.value && savedText.value) return { kind: 'ok' as const, text: t('workspace.notes.saved') }
  return null
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-notes-layer @pointerdown.self="close()" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,680px)] w-[min(94vw,820px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.notes.title')"
        data-notes
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <NotebookPen :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 truncate text-sm font-semibold text-ink" :title="root ?? undefined">
            {{ root ? t('workspace.notes.titleOf', { name: baseName(root) }) : t('workspace.notes.title') }}
          </h2>
          <span class="flex-1" />
          <span v-if="status" class="flex shrink-0 items-center gap-1 text-2xs" :class="status.kind === 'error' ? 'text-st-error' : status.kind === 'ok' ? 'text-success' : 'text-ink-muted'" role="status" data-notes-status>
            <LoaderCircle v-if="status.kind === 'busy'" :size="12" class="ccm-spin" aria-hidden="true" />
            <Check v-else-if="status.kind === 'ok'" :size="12" aria-hidden="true" />{{ status.text }}
          </span>
          <div v-if="root" class="flex shrink-0 rounded-inner bg-fill p-0.5" role="group" :aria-label="t('workspace.notes.mode')">
            <button
              v-for="m in (['edit', 'preview'] as const)"
              :key="m"
              type="button"
              class="flex h-6 cursor-pointer items-center gap-1 rounded-[5px] px-2 text-2xs font-medium"
              :class="mode === m ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
              :aria-pressed="mode === m"
              :data-notes-mode="m"
              @click="setMode(m)"
            >
              <component :is="m === 'edit' ? Pencil : Eye" :size="12" aria-hidden="true" />{{ t(`workspace.notes.${m}`) }}
            </button>
          </div>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.notes.close')" :aria-label="t('workspace.notes.close')" @click="close()">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p v-if="!root" class="p-4 text-xs text-ink-muted">{{ t('workspace.notes.noProject') }}</p>
        <div v-else-if="!loaded" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('workspace.notes.loading') }}</div>
        <div v-else class="flex min-h-0 flex-1 bg-well">
          <CodeEditor v-if="mode === 'edit'" ref="editor" :doc="text" :base="text" :grammar="grammar" wrap @change="onChange" @save="save()" />
          <div v-else class="ccm-scroll min-h-0 flex-1 overflow-auto">
            <article v-if="text.trim()" ref="article" class="md mx-auto max-w-3xl px-6 py-5" data-code-zoom data-notes-preview @click="onArticleClick" v-html="html" />
            <p v-else class="px-6 py-5 text-xs text-well-ink">{{ t('workspace.notes.empty') }}</p>
          </div>
        </div>

        <footer v-if="root" class="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3">
          <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint" :title="targetLabel ?? undefined">{{
            targetLabel ? t('workspace.notes.into', { pane: targetLabel }) : t('workspace.notes.noTarget')
          }}</span>
          <button type="button" class="ccm-btn ccm-btn-primary h-7 shrink-0 gap-1" :disabled="!target || !loaded || !text.trim()" data-notes-fill @click="fill()">
            <CornerDownLeft :size="13" aria-hidden="true" />{{ t('workspace.notes.fill') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.md {
  color: var(--ccm-well-ink);
  font-size: calc(var(--ccm-code-size, 13px) + 1px);
  line-height: 1.6;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: 1.1em 0 0.5em;
  font-weight: 650;
  line-height: 1.25;
}
.md :deep(h1) {
  font-size: 1.5em;
}
.md :deep(h2) {
  font-size: 1.25em;
}
.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(pre),
.md :deep(blockquote) {
  margin: 0 0 0.9em;
}
.md :deep(ul) {
  list-style: disc;
  padding-left: 1.4em;
}
.md :deep(ol) {
  list-style: decimal;
  padding-left: 1.6em;
}
.md :deep(a) {
  color: var(--ccm-syn-type);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--ccm-well-line);
}
.md :deep(pre) {
  padding: 0.75em 1em;
  overflow-x: auto;
  border-radius: var(--radius-inner);
  background: var(--ccm-well-line);
}
.md :deep(pre code) {
  padding: 0;
  background: none;
}
.md :deep(blockquote) {
  padding-left: 1em;
  border-left: 3px solid var(--ccm-well-line);
  color: var(--ccm-syn-comment);
}
</style>
