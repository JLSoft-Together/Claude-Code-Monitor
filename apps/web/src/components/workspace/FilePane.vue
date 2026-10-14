<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronUp, Code, Copy, Eye, FileText, FileWarning, FolderOpen, Search, SquarePen, TextWrap, X } from 'lucide-vue-next'
import { changedLines, findMatches, grammarFor, isMarkdown, renderLine, splitLines, type CodeToken, type Match } from '../../lib/codeView'
import { joinPath } from '../../lib/fileLinks'
import { tokenize } from '../../lib/highlight'
import { renderMarkdown } from '../../lib/markdown'
import { isMac } from '../../lib/platform'
import AccessPrompt from './AccessPrompt.vue'
import { baseName, dirOf, hasPreview, onPreviewChanged, openExternal, openPath, previewUrl, readFile, revealPath, unwatchRoot, watchRoot, type FileView } from '../../lib/preview'

const props = withDefaults(defineProps<{ path: string; line?: number; active?: boolean }>(), { active: true })
const emit = defineEmits<{ open: [path: string] }>()

const { t } = useI18n()
const FLASH_MS = 1200

const view = shallowRef<FileView | null>(null)
const loading = ref(true)
const lines = shallowRef<string[]>([])
const tokens = shallowRef<CodeToken[][] | null>(null)
const plainBecauseLarge = ref(false)
const imageUrl = ref<string | null>(null)
const wrap = ref(false)
const mdPreview = ref(true)
const targetLine = ref<number | null>(null)
const flash = shallowRef<Set<number>>(new Set())
const copied = ref(false)
const notice = ref<string | null>(null)

const findOpen = ref(false)
const query = ref('')
const matchIndex = ref(0)
const findInput = ref<HTMLInputElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)

const name = computed(() => baseName(props.path))
const markdown = computed(() => view.value?.kind === 'text' && isMarkdown(props.path))
const showSource = computed(() => view.value?.kind === 'text' && !(markdown.value && mdPreview.value))
const matches = computed<Match[]>(() => (findOpen.value && showSource.value ? findMatches(lines.value, query.value) : []))

const html = computed(() => {
  if (!showSource.value) return ''
  const byLine = new Map<number, Array<{ start: number; end: number; current?: boolean }>>()
  matches.value.forEach((m, i) => {
    const list = byLine.get(m.line) ?? []
    list.push({ start: m.start, end: m.end, current: i === matchIndex.value })
    byLine.set(m.line, list)
  })
  const tok = tokens.value
  let out = ''
  for (let i = 0; i < lines.value.length; i++) {
    const lineTokens = tok?.[i] ?? [{ content: lines.value[i]! }]
    const cls = `r${i + 1 === targetLine.value ? ' is-target' : ''}${flash.value.has(i) ? ' is-flash' : ''}`
    out += `<div class="${cls}" data-line="${i + 1}"><span class="n" aria-hidden="true">${i + 1}</span><span class="c">${renderLine(lineTokens, byLine.get(i))}\n</span></div>`
  }
  return out
})

const markdownHtml = computed(() => (markdown.value && mdPreview.value ? renderMarkdown(view.value?.text ?? '') : ''))

let watchedRoot: string | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null
let loadSeq = 0

async function load(opts: { keepScroll?: boolean } = {}): Promise<void> {
  const seq = ++loadSeq
  const prevLines = lines.value
  const prevView = view.value
  const scrollTop = scroller.value?.scrollTop ?? 0
  if (!opts.keepScroll) loading.value = true
  const next = hasPreview ? await readFile(props.path) : null
  if (seq !== loadSeq) return
  loading.value = false
  view.value = next
  if (next?.kind === 'image') imageUrl.value = (await previewUrl(next.path))?.url ?? null
  if (next?.kind !== 'text') {
    lines.value = []
    tokens.value = null
    return
  }
  const text = next.text ?? ''
  const nextLines = splitLines(text)
  lines.value = nextLines
  if (opts.keepScroll && prevView?.kind === 'text') {
    flashLines(changedLines(prevLines, nextLines))
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scrollTop
  }
  const lang = grammarFor(next.lang, next.path)
  if (!opts.keepScroll) tokens.value = null
  const tok = await tokenize(text, lang)
  if (seq !== loadSeq) return
  tokens.value = tok
  plainBecauseLarge.value = !!lang && !tok && text.length > 400_000
  if (opts.keepScroll) {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scrollTop
  }
}

function flashLines(changed: number[]): void {
  if (!changed.length || changed.length > 400) return
  flash.value = new Set(changed)
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = new Set()), FLASH_MS)
}

async function jumpTo(line: number | undefined): Promise<void> {
  if (!line || !showSource.value) return
  targetLine.value = line
  await nextTick()
  scroller.value?.querySelector<HTMLElement>(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' })
}

async function setWatch(dir: string | null): Promise<void> {
  if (watchedRoot === dir) return
  if (watchedRoot) void unwatchRoot(watchedRoot)
  watchedRoot = dir
  if (dir && !(await watchRoot(dir)) && watchedRoot === dir) watchedRoot = null
}

const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  return isMac || /^[A-Za-z]:/.test(a) ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

const offChange = onPreviewChanged((change) => {
  const file = view.value?.path ?? props.path
  if (change.paths.some((p) => samePath(p, file) || samePath(p, props.path))) void load({ keepScroll: true })
})

async function openFind(): Promise<void> {
  findOpen.value = true
  if (markdown.value) mdPreview.value = false
  await nextTick()
  findInput.value?.select()
  findInput.value?.focus()
}

function closeFind(): void {
  findOpen.value = false
  query.value = ''
  root.value?.focus()
}

async function stepMatch(dir: 1 | -1): Promise<void> {
  const total = matches.value.length
  if (!total) return
  matchIndex.value = (matchIndex.value + dir + total) % total
  await nextTick()
  scroller.value?.querySelector('mark.ccm-find-current')?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

watch(query, async () => {
  matchIndex.value = 0
  await nextTick()
  scroller.value?.querySelector('mark.ccm-find-current')?.scrollIntoView({ block: 'center', inline: 'nearest' })
})

function onFindKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    void stepMatch(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeFind()
  }
}

function onWindowKey(e: KeyboardEvent): void {
  if (!props.active || view.value?.kind !== 'text') return
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
  // Only when this pane holds focus, or nothing in particular does (another pane's terminal keeps its own keys).
  const focus = document.activeElement
  if (focus && focus !== document.body && !root.value?.contains(focus)) return
  e.preventDefault()
  void openFind()
}

async function copyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(view.value?.path ?? props.path)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard denied
  }
}

async function openInApp(): Promise<void> {
  const res = await openPath(view.value?.path ?? props.path)
  notice.value = res === 'ok' ? null : res === 'denied' ? t('workspace.viewer.openDenied') : res
}

function onMarkdownClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) void openExternal(href)
  else if (href.startsWith('#')) return
  else if (href) emit('open', joinPath(dirOf(view.value?.path ?? props.path), href.split('#')[0]!))
}

watch(
  () => props.path,
  async () => {
    findOpen.value = false
    targetLine.value = null
    await load()
    void setWatch(view.value && view.value.kind !== 'denied' ? dirOf(view.value.path) : null)
    await jumpTo(props.line)
  },
)
watch(
  () => props.line,
  (line) => void jumpTo(line),
)
watch(showSource, (src) => {
  if (src && targetLine.value) void jumpTo(targetLine.value)
})

onMounted(async () => {
  window.addEventListener('keydown', onWindowKey, true)
  await load()
  if (props.line && markdown.value) mdPreview.value = false
  void setWatch(view.value && view.value.kind !== 'denied' ? dirOf(view.value.path) : null)
  await jumpTo(props.line)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey, true)
  offChange()
  if (flashTimer) clearTimeout(flashTimer)
  void setWatch(null)
})

const lineCount = computed(() => lines.value.length)
</script>

<template>
  <section ref="root" tabindex="-1" class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-well shadow-card outline-none" :aria-label="t('workspace.viewer.title')">
    <div class="ccm-material flex h-9 min-w-0 shrink-0 items-center gap-0.5 border-b border-line px-2" role="toolbar" :aria-label="t('workspace.viewer.toolbar')">
      <FileText :size="15" class="mr-1 shrink-0 text-agent-file" aria-hidden="true" />
      <span class="shrink-0 truncate text-xs font-semibold text-ink" :title="view?.path ?? path">{{ name }}</span>
      <span class="ml-1.5 min-w-0 flex-1 truncate text-2xs text-ink-faint" dir="rtl" :title="view?.path ?? path">
        <bdi>{{ dirOf(view?.path ?? path) }}</bdi>
      </span>
      <span v-if="view?.kind === 'text' && !markdown" class="hidden shrink-0 px-1.5 text-2xs tabular text-ink-faint sm:inline">{{ t('workspace.viewer.lines', lineCount) }}</span>

      <template v-if="markdown">
        <button
          type="button"
          class="ccm-btn-plain shrink-0"
          :aria-pressed="mdPreview"
          :title="mdPreview ? t('workspace.viewer.source') : t('workspace.viewer.preview')"
          :aria-label="t('workspace.viewer.mdMode')"
          @click="mdPreview = !mdPreview"
        >
          <Eye v-if="mdPreview" :size="14" aria-hidden="true" />
          <Code v-else :size="14" aria-hidden="true" />
        </button>
      </template>
      <button
        v-if="view?.kind === 'text'"
        type="button"
        class="ccm-btn-plain shrink-0"
        :aria-pressed="wrap"
        :disabled="!showSource"
        :title="t('workspace.viewer.wrap')"
        :aria-label="t('workspace.viewer.wrap')"
        @click="wrap = !wrap"
      >
        <TextWrap :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="view?.kind === 'text'"
        type="button"
        class="ccm-btn-plain shrink-0"
        :aria-pressed="findOpen"
        :title="`${t('workspace.viewer.find')} (${isMac ? '⌘F' : 'Ctrl+F'})`"
        :aria-label="t('workspace.viewer.find')"
        @click="findOpen ? closeFind() : openFind()"
      >
        <Search :size="14" aria-hidden="true" />
      </button>
      <span class="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      <button type="button" class="ccm-btn-plain shrink-0" :title="copied ? t('workspace.viewer.copied') : t('workspace.viewer.copyPath')" :aria-label="t('workspace.viewer.copyPath')" @click="copyPath">
        <Check v-if="copied" :size="14" class="text-success" aria-hidden="true" />
        <Copy v-else :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ccm-btn-plain shrink-0"
        :title="isMac ? t('workspace.viewer.revealMac') : t('workspace.viewer.reveal')"
        :aria-label="isMac ? t('workspace.viewer.revealMac') : t('workspace.viewer.reveal')"
        @click="revealPath(view?.path ?? path)"
      >
        <FolderOpen :size="14" aria-hidden="true" />
      </button>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.viewer.openEditor')" :aria-label="t('workspace.viewer.openEditor')" @click="openInApp">
        <SquarePen :size="14" aria-hidden="true" />
      </button>
      <slot name="end" />
    </div>

    <Transition name="ccm-fade">
      <div v-if="findOpen && showSource" class="ccm-material flex h-9 shrink-0 items-center gap-1 border-b border-line px-2" role="search">
        <input
          ref="findInput"
          v-model="query"
          type="search"
          class="ccm-field h-6 min-w-0 flex-1"
          :placeholder="t('workspace.viewer.findPlaceholder')"
          :aria-label="t('workspace.viewer.findPlaceholder')"
          @keydown="onFindKey"
        />
        <span class="w-20 shrink-0 text-center text-2xs tabular text-ink-muted" aria-live="polite">
          {{ query ? (matches.length ? t('workspace.viewer.findCount', { current: matchIndex + 1, total: matches.length }) : t('workspace.viewer.findNone')) : '' }}
        </span>
        <button type="button" class="ccm-btn-plain shrink-0" :disabled="!matches.length" :title="t('workspace.viewer.findPrev')" :aria-label="t('workspace.viewer.findPrev')" @click="stepMatch(-1)">
          <ChevronUp :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :disabled="!matches.length" :title="t('workspace.viewer.findNext')" :aria-label="t('workspace.viewer.findNext')" @click="stepMatch(1)">
          <ChevronDown :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.viewer.findClose')" :aria-label="t('workspace.viewer.findClose')" @click="closeFind">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
    </Transition>

    <p v-if="notice" class="shrink-0 border-b border-line bg-st-waiting-soft px-3 py-1.5 text-xs text-ink" role="status">{{ notice }}</p>
    <p v-if="plainBecauseLarge" class="shrink-0 border-b border-well-line px-3 py-1 text-2xs text-well-ink">{{ t('workspace.viewer.plain') }}</p>

    <div ref="scroller" class="ccm-scroll relative min-h-0 flex-1 overflow-auto">
      <div v-if="loading" class="grid size-full place-items-center text-xs text-well-ink">{{ t('workspace.viewer.loading') }}</div>
      <div v-else-if="!hasPreview || !view || (view.kind !== 'text' && view.kind !== 'image')" class="grid size-full place-items-center p-6">
        <div class="flex max-w-sm flex-col items-center gap-2 text-center">
          <FileWarning :size="26" class="text-well-ink" aria-hidden="true" />
          <p class="text-sm text-well-ink">{{ t(`workspace.viewer.kind.${!hasPreview || !view ? 'unavailable' : view.kind}`) }}</p>
          <AccessPrompt v-if="view?.kind === 'denied'" :path="path" well @granted="load()" />
          <button v-if="view && (view.kind === 'binary' || view.kind === 'too-large')" type="button" class="ccm-btn mt-1" @click="openInApp">
            {{ t('workspace.viewer.openEditor') }}
          </button>
        </div>
      </div>
      <div v-else-if="view.kind === 'image'" class="grid min-h-full place-items-center p-6">
        <img v-if="imageUrl" :src="imageUrl" :alt="t('workspace.viewer.image')" class="max-h-full max-w-full object-contain" />
      </div>
      <article v-else-if="!showSource" class="md mx-auto max-w-3xl px-6 py-5" v-html="markdownHtml" @click="onMarkdownClick" />
      <div v-else class="code min-w-full py-2" :class="wrap ? 'is-wrap' : 'w-max'" role="document" v-html="html" />
    </div>
  </section>
</template>

<style scoped>
/* syn-* tokens land in style.css in v21 phase 2; fallbacks are the Xcode Default Dark values from .planning/COLOR-SYSTEM.md. */
.code {
  --shiki-foreground: var(--ccm-syn-var, var(--ccm-well-ink));
  --shiki-background: transparent;
  --shiki-token-keyword: var(--ccm-syn-keyword, #ff7ab2);
  --shiki-token-string: var(--ccm-syn-string, #ff8170);
  --shiki-token-string-expression: var(--ccm-syn-string, #ff8170);
  --shiki-token-constant: var(--ccm-syn-number, #d9c97c);
  --shiki-token-comment: var(--ccm-syn-comment, #7f8c98);
  --shiki-token-function: var(--ccm-syn-func, #67b7a4);
  --shiki-token-parameter: var(--ccm-syn-var, var(--ccm-well-ink));
  --shiki-token-link: var(--ccm-syn-type, #6bdfff);
  --shiki-token-punctuation: var(--ccm-well-ink);
  color: var(--shiki-foreground);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  tab-size: 4;
}
.code :deep(.r) {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  transition: background-color var(--ccm-dur-slow, 300ms) var(--ease-out-quint, ease-out);
}
.code :deep(.n) {
  position: sticky;
  left: 0;
  min-width: 3.5em;
  padding-inline: 0 1em;
  text-align: right;
  color: color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well));
  background: var(--ccm-well);
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.code :deep(.c) {
  padding-right: 1.5em;
  white-space: pre;
}
.code.is-wrap :deep(.c) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.code :deep(.r.is-target) {
  background: color-mix(in srgb, var(--ccm-selection, #3f638b) 45%, transparent);
}
.code :deep(.r.is-target .n) {
  color: var(--ccm-well-ink);
}
.code :deep(.r.is-flash) {
  animation: file-flash 1.2s var(--ease-out-quint, ease-out);
}
.code :deep(mark.ccm-find) {
  border-radius: 2px;
  color: inherit;
  background: color-mix(in srgb, var(--ccm-selection, #3f638b) 70%, transparent);
}
.code :deep(mark.ccm-find-current) {
  background: var(--ccm-waiting-soft);
  box-shadow: 0 0 0 1px var(--ccm-waiting);
}
.code ::selection,
.code :deep(*)::selection {
  background: var(--ccm-selection, #3f638b);
}
@keyframes file-flash {
  from {
    background: var(--ccm-diff-add-soft, rgb(48 209 88 / 0.18));
  }
}
@media (prefers-reduced-motion: reduce) {
  .code :deep(.r.is-flash) {
    animation-duration: 0.01ms;
    background: var(--ccm-diff-add-soft, rgb(48 209 88 / 0.18));
  }
}

/* Rendered Markdown reads as a document on the dark well, same ink as the code view. */
.md {
  color: var(--ccm-well-ink);
  font-size: 14px;
  line-height: 1.6;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: 1.2em 0 0.5em;
  font-weight: 650;
  line-height: 1.25;
}
.md :deep(h1) {
  font-size: 1.6em;
}
.md :deep(h2) {
  font-size: 1.3em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--ccm-well-line);
}
.md :deep(h3) {
  font-size: 1.1em;
}
.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(pre),
.md :deep(blockquote),
.md :deep(table) {
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
  color: var(--ccm-syn-type, #6bdfff);
  text-decoration: underline;
  text-underline-offset: 2px;
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
  color: var(--ccm-syn-comment, #7f8c98);
}
.md :deep(hr) {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--ccm-well-line);
}
.md :deep(table) {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}
.md :deep(th),
.md :deep(td) {
  padding: 0.35em 0.75em;
  border: 1px solid var(--ccm-well-line);
}
.md :deep(.md-img) {
  font-style: italic;
  color: var(--ccm-syn-comment, #7f8c98);
}
.md :deep(::selection) {
  background: var(--ccm-selection, #3f638b);
}
</style>
