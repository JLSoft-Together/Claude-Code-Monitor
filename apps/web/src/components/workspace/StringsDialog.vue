<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, Languages, Lock, Pencil, Plus, RefreshCw, Search, Send, TriangleAlert, X } from 'lucide-vue-next'
import { joinPath } from '../../lib/fileLinks'
import { baseName, fileWrite, i18nScan, readFile, type I18nSet } from '../../lib/preview'
import { handoffPaneFor } from '../../lib/runUi'
import { buildRows, fillPrompt, filterRows, missingCounts, parseSource, setSourceString, type Cell, type LocaleSource, type Row } from '../../lib/strings/table'
import type { ReadOnlyReason } from '../../lib/strings/types'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import TextCompareDialog from './TextCompareDialog.vue'

const props = defineProps<{ root: string | null; focus?: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const ui = useUiStore()

interface Column extends LocaleSource {
  readOnly: ReadOnlyReason | 'too-large' | 'unreadable' | null
}

const ROW_PAGE = 300
const sets = shallowRef<I18nSet[]>([])
const scanFailed = ref(false)
const loading = ref(false)
const setIndex = ref(0)
const columns = shallowRef<Column[]>([])
const query = ref('')
const missingOnly = ref(false)
const shownMax = ref(ROW_PAGE)
const targets = ref(new Set<number>())
const editing = ref<{ row: string; col: number; value: string } | null>(null)
const pending = ref<{ col: number; key: string; before: string; after: string } | null>(null)
const writing = ref(false)
const notice = ref<{ text: string; warn: boolean } | null>(null)
const card = ref<HTMLElement | null>(null)
let gen = 0

const set = computed(() => sets.value[setIndex.value] ?? null)
const rows = computed<Row[]>(() => (set.value ? buildRows(set.value.kind, columns.value) : []))
const shown = computed(() => filterRows(rows.value, { missingOnly: missingOnly.value, query: query.value }))
const counts = computed(() => missingCounts(rows.value, columns.value.length))
const total = computed(() => counts.value.reduce((a, b) => a + b, 0))

const relOf = (abs: string): string => {
  const r = props.root ?? ''
  const a = abs.replace(/\\/g, '/')
  const b = r.replace(/\\/g, '/').replace(/\/$/, '')
  return a.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? a.slice(b.length + 1) : a
}

function pickSet(list: I18nSet[]): number {
  if (!props.focus) return 0
  const rel = relOf(props.focus)
  if (/(^|\/)l10n\.yaml$/i.test(rel)) return Math.max(0, list.findIndex((s) => s.kind === 'flutter'))
  const i = list.findIndex((s) => [s.base.files[0], ...s.locales.map((l) => l.files[0])].includes(rel) || rel === s.dir || rel.startsWith(`${s.dir}/`) || (s.dir.startsWith(`${rel}/`) && rel !== ''))
  return Math.max(0, i)
}

async function readColumn(locale: string, rel: string, kind: I18nSet['kind'], error?: 'invalid' | 'too-large'): Promise<Column> {
  const path = props.root ? joinPath(props.root, rel) : rel
  const empty = { locale, path, rel, mtimeMs: 0, text: '', doc: { entries: new Map(), order: [], writable: false } }
  if (error === 'too-large') return { ...empty, readOnly: 'too-large' }
  const view = await readFile(path)
  if (!view || view.kind !== 'text' || view.text === undefined || view.invalidUtf8) return { ...empty, readOnly: view?.kind === 'too-large' ? 'too-large' : 'unreadable' }
  const doc = parseSource(kind, view.text)
  return { locale, path, rel, mtimeMs: view.mtimeMs, text: view.text, doc, readOnly: doc.writable ? null : (doc.reason ?? 'invalid') }
}

async function loadSet(): Promise<void> {
  const s = set.value
  const my = ++gen
  if (!s) {
    columns.value = []
    return
  }
  loading.value = true
  const cols = await Promise.all([
    readColumn(s.base.locale, s.base.files[0] ?? '', s.kind, s.base.error),
    ...s.locales.map((l) => readColumn(l.locale, l.files[0] ?? '', s.kind, l.error)),
  ])
  if (my !== gen) return
  columns.value = cols
  targets.value = new Set(cols.map((_, i) => i).filter((i) => i > 0))
  loading.value = false
}

async function load(): Promise<void> {
  if (!props.root) return
  loading.value = true
  const res = await i18nScan(props.root)
  scanFailed.value = !res.ok
  sets.value = res.ok ? res.sets : []
  if (setIndex.value >= sets.value.length || !columns.value.length) setIndex.value = pickSet(sets.value)
  await loadSet()
  loading.value = false
}

onMounted(async () => {
  await load()
  await nextTick()
  card.value?.focus()
})

async function changeSet(i: number): Promise<void> {
  setIndex.value = i
  editing.value = null
  shownMax.value = ROW_PAGE
  await loadSet()
}

function say(text: string, warn = false): void {
  notice.value = { text, warn }
}

const cellTitle = (c: Cell): string => {
  if (c.mismatch) return t('stringsTable.mismatch', { base: c.mismatch.base.join(' ') || t('stringsTable.none'), here: c.mismatch.here.join(' ') || t('stringsTable.none') })
  if (c.entry?.why) return t(`stringsTable.why.${c.entry.why}`)
  if (c.state === 'fixed') return t('stringsTable.fixedHint')
  return c.entry?.value ?? ''
}

function startEdit(row: Row, col: number): void {
  const c = row.cells[col]
  if (!c?.editable) return
  editing.value = { row: row.key, col, value: c.entry?.value ?? '' }
  void nextTick(() => card.value?.querySelector<HTMLTextAreaElement>('[data-strings-editor]')?.focus())
}

function review(): void {
  const e = editing.value
  const s = set.value
  const col = e ? columns.value[e.col] : null
  if (!e || !s || !col) return
  const r = setSourceString(s.kind, col.text, e.row, e.value)
  if (!r.ok) {
    say(t(`stringsTable.refused.${r.error}`), true)
    return
  }
  if (r.text === col.text) {
    editing.value = null
    return
  }
  pending.value = { col: e.col, key: e.row, before: col.text, after: r.text }
}

async function write(): Promise<void> {
  const p = pending.value
  const col = p ? columns.value[p.col] : null
  if (!p || !col || writing.value) return
  writing.value = true
  const res = await fileWrite(col.path, p.after, col.mtimeMs)
  writing.value = false
  pending.value = null
  if (!res.ok) {
    say(t(`stringsTable.writeError.${res.error}`), true)
    if (res.error === 'conflict') await loadSet()
    return
  }
  editing.value = null
  const next = [...columns.value]
  const doc = parseSource(set.value!.kind, p.after)
  next[p.col] = { ...col, text: p.after, mtimeMs: res.mtimeMs, doc, readOnly: doc.writable ? null : (doc.reason ?? 'invalid') }
  columns.value = next
  say(t('stringsTable.saved', { key: p.key, file: col.rel }))
  // The editor that had focus is gone; without this Esc no longer reaches the dialog.
  void nextTick(() => card.value?.focus())
}

function onEditorKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    editing.value = null
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    review()
  }
}

function toggleTarget(i: number): void {
  const next = new Set(targets.value)
  if (!next.delete(i)) next.add(i)
  targets.value = next
}

function fill(): void {
  const s = set.value
  if (!s) return
  const text = fillPrompt(s.kind, columns.value, rows.value, [...targets.value].sort((a, b) => a - b))
  if (!text) return say(t('stringsTable.nothingMissing'))
  const pane = handoffPaneFor(workspace.panes, props.root)
  if (!pane) return say(t('stringsTable.noAgent'), true)
  workspace.insertInto(pane.key, text)
  if (ui.view !== 'workspace') ui.setView('workspace')
  say(t('stringsTable.filled', { name: pane.title ?? baseName(pane.cwd ?? '') }))
}

function openAt(col: number, line: number): void {
  const c = columns.value[col]
  if (!c || !props.root) return
  emit('close')
  workspace.openFile(c.path, line, { cwd: props.root })
}

function keyAt(r: Row): { col: number; line: number } | null {
  const i = r.cells.findIndex((c) => !!c.entry)
  return i < 0 ? null : { col: i, line: r.cells[i]!.entry!.line }
}
const openTitle = (r: Row): string => {
  const k = keyAt(r)
  return k ? t('stringsTable.openAt', { file: columns.value[k.col]?.rel ?? '', line: k.line }) : r.key
}
function openKey(r: Row): void {
  const k = keyAt(r)
  if (k) openAt(k.col, k.line)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented && !pending.value) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-strings-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(90vh,900px)] w-[min(96vw,1280px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('stringsTable.title')"
        data-strings-table
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Languages :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 shrink truncate text-sm font-semibold text-ink" :title="root ?? undefined">
            {{ root ? t('stringsTable.titleOf', { name: baseName(root) }) : t('stringsTable.title') }}
          </h2>
          <select
            v-if="sets.length > 1"
            class="ccm-field h-7 max-w-64 min-w-0 shrink text-xs"
            :aria-label="t('stringsTable.set')"
            :value="setIndex"
            data-strings-set
            @change="changeSet(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="(s, i) in sets" :key="`${s.kind}:${s.dir}`" :value="i">{{ t(`stringsTable.kind.${s.kind}`) }} · {{ s.dir || '.' }}</option>
          </select>
          <span v-else-if="set" class="min-w-0 shrink truncate text-2xs text-ink-faint">{{ t(`stringsTable.kind.${set.kind}`) }} · {{ set.dir || '.' }}</span>
          <span v-if="columns.length" class="tabular inline-flex shrink-0 items-center gap-1 text-2xs" :class="total ? 'text-warning' : 'text-ink-faint'" data-strings-total>
            <CircleAlert v-if="total" :size="12" aria-hidden="true" />{{ t('stringsTable.missingCount', { n: total }, total) }}
          </span>
          <span class="flex-1" />
          <button v-if="root" type="button" class="ccm-btn-plain shrink-0" :title="t('stringsTable.refresh')" :aria-label="t('stringsTable.refresh')" :disabled="loading" data-strings-refresh @click="load()">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('stringsTable.close')" :aria-label="t('stringsTable.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <div v-if="columns.length" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          <label class="relative flex min-w-40 flex-1 items-center">
            <Search :size="13" class="pointer-events-none absolute left-2 text-ink-faint" aria-hidden="true" />
            <input v-model="query" type="search" class="ccm-field h-7 w-full pl-7 text-xs" :placeholder="t('stringsTable.search')" :aria-label="t('stringsTable.search')" data-strings-search />
          </label>
          <label class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted" :title="t('stringsTable.missingOnlyHint')">
            <input v-model="missingOnly" type="checkbox" class="accent-(--ccm-accent)" data-strings-missing-only />
            {{ t('stringsTable.missingOnly') }}
          </label>
          <button type="button" class="ccm-btn shrink-0" :title="t('stringsTable.fillHint')" :disabled="!targets.size" data-strings-fill @click="fill">
            <Send :size="13" aria-hidden="true" />{{ t('stringsTable.fill') }}
          </button>
        </div>

        <p v-if="!root" class="p-4 text-xs text-ink-muted">{{ t('stringsTable.noProject') }}</p>
        <div v-else-if="loading && !columns.length" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('stringsTable.loading') }}</div>
        <p v-else-if="scanFailed" class="p-4 text-xs text-warning" role="status">{{ t('stringsTable.error') }}</p>
        <p v-else-if="!sets.length" class="p-4 text-xs text-ink-muted" data-strings-empty>{{ t('stringsTable.empty') }}</p>
        <div v-else class="ccm-scroll min-h-0 flex-1 overflow-auto overscroll-contain">
          <table class="w-max min-w-full border-separate border-spacing-0 text-xs">
            <thead class="sticky top-0 z-10 bg-surface">
              <tr>
                <th class="sticky left-0 z-20 w-56 min-w-56 border-r border-b border-line bg-surface px-2 py-1.5 text-left font-medium text-ink-muted">{{ t('stringsTable.key') }}</th>
                <th v-for="(c, i) in columns" :key="c.rel" class="w-72 min-w-56 border-b border-line px-2 py-1 text-left align-top font-normal" :data-strings-col="c.locale">
                  <div class="flex items-center gap-1.5">
                    <input
                      v-if="i > 0"
                      type="checkbox"
                      class="accent-(--ccm-accent)"
                      :checked="targets.has(i)"
                      :aria-label="t('stringsTable.target', { locale: c.locale })"
                      :title="t('stringsTable.target', { locale: c.locale })"
                      data-strings-target
                      @change="toggleTarget(i)"
                    />
                    <span class="font-mono font-medium text-ink">{{ c.locale }}</span>
                    <span v-if="i === 0" class="rounded-full bg-fill px-1.5 text-2xs text-ink-muted">{{ t('stringsTable.base') }}</span>
                    <span v-if="counts[i]" class="tabular inline-flex items-center gap-0.5 text-2xs text-warning"><CircleAlert :size="11" aria-hidden="true" />{{ counts[i] }}</span>
                    <span v-if="c.readOnly" class="inline-flex items-center gap-0.5 text-2xs text-ink-muted" :title="t(`stringsTable.reason.${c.readOnly}`)" data-strings-readonly>
                      <Lock :size="11" aria-hidden="true" />{{ t('stringsTable.readOnly') }}
                    </span>
                  </div>
                  <div class="truncate text-2xs text-ink-faint" :title="c.rel">{{ c.rel }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in shown.slice(0, shownMax)" :key="r.key" class="group" :data-strings-row="r.key">
                <th class="sticky left-0 z-[1] border-r border-b border-line bg-surface px-2 py-1 text-left align-top font-normal">
                  <button type="button" class="block w-full cursor-pointer truncate text-left font-mono text-ink" :title="openTitle(r)" @click="openKey(r)">{{ r.key }}</button>
                  <div v-if="r.kind !== 'string' || r.fixed || r.extra" class="text-2xs text-ink-faint">
                    {{ r.kind !== 'string' ? r.kind : '' }}{{ r.fixed ? t('stringsTable.fixed') : '' }}{{ r.extra ? t('stringsTable.extra') : '' }}
                  </div>
                </th>
                <td
                  v-for="(c, i) in r.cells"
                  :key="i"
                  class="relative max-w-80 border-b border-line px-2 py-1 align-top"
                  :data-strings-cell="c.state"
                  :data-strings-mismatch="c.mismatch ? '' : undefined"
                >
                  <div v-if="editing && editing.row === r.key && editing.col === i" class="flex flex-col gap-1">
                    <textarea v-model="editing.value" rows="3" class="ccm-field w-full resize-y text-xs" :title="t('stringsTable.editHint')" data-strings-editor @keydown="onEditorKey" />
                    <div class="flex justify-end gap-1">
                      <button type="button" class="ccm-btn-plain text-2xs" @click="editing = null">{{ t('stringsTable.cancel') }}</button>
                      <button type="button" class="ccm-btn-primary text-2xs" data-strings-save @click="review">{{ t('stringsTable.save') }}</button>
                    </div>
                  </div>
                  <template v-else>
                    <span v-if="c.state === 'missing'" class="inline-flex items-center gap-1 text-warning"><CircleAlert :size="12" aria-hidden="true" />{{ t('stringsTable.missing') }}</span>
                    <span v-else-if="c.state === 'fixed'" class="text-ink-faint" :title="t('stringsTable.fixedHint')">{{ t('stringsTable.fixed') }}</span>
                    <span v-else-if="c.state === 'absent'" class="text-ink-faint">—</span>
                    <button
                      v-else
                      type="button"
                      class="line-clamp-3 w-full cursor-pointer text-left break-words whitespace-pre-wrap text-ink"
                      :class="c.entry?.editable ? '' : 'text-ink-muted'"
                      :title="cellTitle(c)"
                      @click="c.editable ? startEdit(r, i) : c.entry && openAt(i, c.entry.line)"
                    >
                      <TriangleAlert v-if="c.mismatch" :size="12" class="mr-0.5 inline text-warning" :aria-label="cellTitle(c)" />{{ c.entry?.value }}
                    </button>
                    <button
                      v-if="c.editable"
                      type="button"
                      class="ccm-btn-plain absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      :title="c.state === 'missing' ? t('stringsTable.add') : t('stringsTable.edit')"
                      :aria-label="c.state === 'missing' ? t('stringsTable.add') : t('stringsTable.edit')"
                      data-strings-edit
                      @click="startEdit(r, i)"
                    >
                      <Plus v-if="c.state === 'missing'" :size="12" aria-hidden="true" />
                      <Pencil v-else :size="12" aria-hidden="true" />
                    </button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="columns.length === 1" class="px-3 py-2 text-2xs text-ink-faint">{{ t('stringsTable.onlyBase') }}</p>
          <button v-if="shown.length > shownMax" type="button" class="ccm-btn-plain m-2 text-xs" data-strings-more @click="shownMax += ROW_PAGE">
            {{ t('stringsTable.more', { n: Math.min(ROW_PAGE, shown.length - shownMax) }) }}
          </button>
        </div>

        <footer v-if="root" class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="notice" class="min-w-0 flex-1 truncate" :class="notice.warn ? 'text-warning' : 'text-ink-muted'" role="status" data-strings-notice>{{ notice.text }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint">{{ t('stringsTable.editHint') }}</span>
        </footer>
      </div>
    </div>
    <TextCompareDialog
      v-if="pending"
      :title="t('stringsTable.diffTitle', { key: pending.key, file: baseName(columns[pending.col]?.rel ?? '') })"
      :subtitle="columns[pending.col]?.rel"
      :a="pending.before"
      :b="pending.after"
      :labels="{ a: t('stringsTable.diffBefore'), b: t('stringsTable.diffAfter') }"
      :grammar="set?.kind === 'android' ? 'xml' : 'json'"
      :primary="t('stringsTable.write')"
      :loading="writing"
      @primary="write"
      @close="pending = null"
    />
  </Teleport>
</template>
