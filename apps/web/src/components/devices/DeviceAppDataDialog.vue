<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, CircleAlert, Database, FileCog, LoaderCircle, Pencil, Play, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-vue-next'
import type { AppDataErrorCode, AppDataFile, AppDbRows, AppDbTable, PrefEntry } from '@ccm/shared'
import { cellText, isBlob, prefFromInput, prefInput, prefShown, prefValid, ROWS_PAGE, schemaPrompt } from '../../lib/appData'
import { appDataDbClose, appDataDbOpen, appDataDbQuery, appDataDbRows, appDataList, appDataPrefsRead, appDataPrefsRestore, appDataPrefsWrite } from '../../lib/devices'
import { isPackageName } from '../../lib/deviceUiTest'
import { relativeTime } from '../../lib/format'
import { retireOverlay } from '../../lib/motion'
import { useDeviceHandoff } from '../../composables/useDeviceHandoff'

const props = defineProps<{ open: boolean; deviceId: string | null; deviceName: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, te, locale } = useI18n()
const handoff = useDeviceHandoff(() => null)
const PKG_KEY = 'ccm.devices.appDataPkg'

type Ok<T> = Extract<T, { ok: true }>
type Failure = { code: AppDataErrorCode; detail?: string }

const dialog = ref<HTMLElement | null>(null)
const pkg = ref('')
const loadedPkg = ref<string | null>(null)
const files = ref<{ databases: AppDataFile[]; prefs: AppDataFile[]; skipped: number } | null>(null)
const selected = ref<{ kind: 'db' | 'prefs'; name: string } | null>(null)
const db = ref<{ handle: string; name: string; tables: AppDbTable[]; wal: 'none' | 'applied' | 'partial'; walFrames: number; at: number } | null>(null)
const table = ref<string | null>(null)
const page = ref(0)
const rows = ref<Ok<AppDbRows> | null>(null)
const showSchema = ref(false)
const sql = ref('')
const queryResult = ref<Ok<AppDbRows> | null>(null)
const prefs = ref<{ name: string; entries: PrefEntry[]; hasOriginal: boolean } | null>(null)
const editing = ref<string | null>(null)
const draft = ref('')
const busy = ref<string | null>(null)
const error = ref<Failure | null>(null)
const note = ref<string | null>(null)
let gen = 0
let restoreFocus: HTMLElement | null = null

const pkgOk = computed(() => isPackageName(pkg.value.trim()))
const current = computed(() => db.value?.tables.find((x) => x.name === table.value) ?? null)
const shown = computed(() => queryResult.value ?? rows.value)
const pageText = computed(() => {
  const r = rows.value
  if (!r || queryResult.value) return ''
  const from = r.rows.length ? page.value * ROWS_PAGE + 1 : 0
  const to = page.value * ROWS_PAGE + r.rows.length
  return r.total === null ? t('appData.db.pageNoTotal', { from, to }) : t('appData.db.page', { from, to, total: r.total.toLocaleString(locale.value) })
})
const hasNext = computed(() => !!rows.value && rows.value.total !== null && (page.value + 1) * ROWS_PAGE < rows.value.total)
const copyWhen = computed(() => (db.value ? (relativeTime(db.value.at, locale.value, Date.now()) ?? '') : ''))
const editEntry = computed(() => prefs.value?.entries.find((e) => e.key === editing.value) ?? null)
const draftValue = computed(() => (editEntry.value ? prefFromInput(editEntry.value, draft.value) : null))
const draftOk = computed(() => !!editEntry.value && draftValue.value !== null && prefValid(editEntry.value.type, draftValue.value))

const errorText = computed(() => {
  const code = error.value?.code
  if (!code) return ''
  if (te(`appData.error.${code}`)) return t(`appData.error.${code}`)
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})

function fail(r: { error: AppDataErrorCode; detail?: string }): void {
  error.value = { code: r.error, detail: r.detail }
  note.value = null
}

async function step<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (busy.value) return null
  busy.value = key
  error.value = null
  note.value = null
  try {
    return await fn()
  } finally {
    busy.value = null
  }
}

function closeDb(): void {
  if (db.value) void appDataDbClose(db.value.handle)
  db.value = null
  table.value = null
  rows.value = null
  queryResult.value = null
}

async function load(): Promise<void> {
  const id = props.deviceId
  const p = pkg.value.trim()
  if (!id || !isPackageName(p)) return
  const my = gen
  closeDb()
  prefs.value = null
  selected.value = null
  const r = await step('list', () => appDataList(id, p))
  if (!r || my !== gen) return
  if (!r.ok) {
    files.value = null
    return fail(r)
  }
  files.value = { databases: r.databases, prefs: r.prefs, skipped: r.skipped }
  loadedPkg.value = p
  try {
    localStorage.setItem(PKG_KEY, p)
  } catch {
    // remembered package is a convenience only
  }
}

async function loadRows(): Promise<void> {
  const d = db.value
  if (!d || !table.value) return
  queryResult.value = null
  const r = await appDataDbRows(d.handle, table.value, page.value)
  if (r.ok) rows.value = r
  else fail(r)
}

async function openDb(f: AppDataFile): Promise<void> {
  const id = props.deviceId
  const p = loadedPkg.value
  if (!id || !p) return
  const my = gen
  closeDb()
  prefs.value = null
  editing.value = null
  selected.value = { kind: 'db', name: f.name }
  const r = await step('open', () => appDataDbOpen(id, p, f.name))
  if (!r || my !== gen) return
  if (!r.ok) return fail(r)
  db.value = { handle: r.handle, name: r.name, tables: r.tables, wal: r.wal, walFrames: r.walFrames, at: Date.now() }
  table.value = r.tables[0]?.name ?? null
  page.value = 0
  await loadRows()
}

async function pickTable(name: string): Promise<void> {
  table.value = name
  page.value = 0
  await loadRows()
}

async function turn(by: number): Promise<void> {
  page.value = Math.max(0, page.value + by)
  await loadRows()
}

async function runQuery(): Promise<void> {
  const d = db.value
  if (!d || !sql.value.trim()) return
  const r = await step('query', () => appDataDbQuery(d.handle, sql.value))
  if (!r) return
  if (r.ok) queryResult.value = r
  else fail(r)
}

function fillSchema(): void {
  const tb = current.value
  if (!tb || !db.value || !loadedPkg.value) return
  const res = handoff.fillText(schemaPrompt(loadedPkg.value, db.value.name, tb))
  error.value = null
  note.value = t(res === 'ok' ? 'appData.db.filled' : 'appData.db.noAgent')
}

async function openPrefs(f: AppDataFile): Promise<void> {
  const id = props.deviceId
  const p = loadedPkg.value
  if (!id || !p) return
  const my = gen
  closeDb()
  editing.value = null
  selected.value = { kind: 'prefs', name: f.name }
  const r = await step('open', () => appDataPrefsRead(id, p, f.name))
  if (!r || my !== gen) return
  if (r.ok) prefs.value = { name: r.name, entries: r.entries, hasOriginal: r.hasOriginal }
  else {
    prefs.value = null
    fail(r)
  }
}

async function startEdit(e: PrefEntry): Promise<void> {
  editing.value = e.key
  draft.value = prefInput(e)
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('[data-appdata-draft]')?.focus()
}

async function savePref(): Promise<void> {
  const id = props.deviceId
  const p = loadedPkg.value
  const e = editEntry.value
  const v = draftValue.value
  if (!id || !p || !prefs.value || !e || v === null || !draftOk.value) return
  const name = prefs.value.name
  const r = await step('save', () => appDataPrefsWrite(id, p, name, { key: e.key, type: e.type, before: e.value, after: v }))
  if (!r) return
  if (r.ok) {
    prefs.value = { name: r.name, entries: r.entries, hasOriginal: r.hasOriginal }
    editing.value = null
    note.value = t('appData.pref.saved')
  } else fail(r)
}

async function restorePrefs(): Promise<void> {
  const id = props.deviceId
  const p = loadedPkg.value
  if (!id || !p || !prefs.value) return
  const name = prefs.value.name
  const r = await step('restore', () => appDataPrefsRestore(id, p, name))
  if (!r) return
  if (r.ok) {
    prefs.value = { name: r.name, entries: r.entries, hasOriginal: r.hasOriginal }
    editing.value = null
    note.value = t('appData.pref.restored')
  } else fail(r)
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (editing.value) editing.value = null
    else emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    gen++
    if (!open) {
      closeDb()
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    files.value = null
    prefs.value = null
    selected.value = null
    loadedPkg.value = null
    error.value = null
    note.value = null
    sql.value = ''
    try {
      pkg.value = localStorage.getItem(PKG_KEY) ?? ''
    } catch {
      pkg.value = ''
    }
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[data-appdata-pkg]')?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[5vh]" @mousedown.self="emit('close')">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-appdata-title"
          class="flex h-[86vh] w-full max-w-[1080px] flex-col overflow-hidden ccm-sheet"
          data-device-appdata
          @keydown="trap"
        >
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2.5 pr-3 pl-4">
            <Database :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="device-appdata-title" class="truncate text-sm font-semibold">{{ t('appData.title', { name: deviceName }) }}</h2>
              <p class="truncate text-2xs text-ink-faint">{{ t('appData.hint') }}</p>
            </div>
            <form class="flex min-w-0 items-center gap-1.5" @submit.prevent="load">
              <input
                v-model="pkg"
                class="ccm-field w-56 min-w-0 font-mono text-xs"
                spellcheck="false"
                maxlength="255"
                :aria-label="t('appData.pkg')"
                :placeholder="t('appData.pkgPlaceholder')"
                data-appdata-pkg
              />
              <button type="submit" class="ccm-btn" :disabled="!pkgOk || !!busy" data-appdata-load>
                <LoaderCircle v-if="busy === 'list'" :size="13" class="ccm-spin" aria-hidden="true" />
                <RefreshCw v-else :size="13" aria-hidden="true" />{{ files ? t('appData.reload') : t('appData.load') }}
              </button>
            </form>
            <button type="button" class="ccm-btn-plain" :title="t('appData.close')" :aria-label="t('appData.close')" data-appdata-close @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>

          <div v-if="error || note" class="flex shrink-0 items-start gap-1.5 border-b border-line px-4 py-2 text-xs" :class="error ? 'bg-warning-soft' : 'bg-fill'" role="status" data-appdata-message>
            <CircleAlert v-if="error" :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1">
              {{ error ? errorText : note }}
              <span v-if="error?.detail" class="ml-1 line-clamp-2 font-mono text-2xs break-all text-ink-muted" :title="error.detail">{{ error.detail }}</span>
            </p>
          </div>

          <div class="flex min-h-0 flex-1">
            <nav class="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-line py-2" :aria-label="t('appData.databases')">
              <p v-if="busy === 'list'" class="flex items-center gap-2 px-3 text-xs text-ink-muted"><LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('appData.loading') }}</p>
              <template v-else-if="files">
                <template v-for="group in (['databases', 'prefs'] as const)" :key="group">
                  <h3 class="px-3 pt-1 pb-0.5 text-2xs font-semibold text-ink-faint">{{ t(`appData.${group}`) }}</h3>
                  <p v-if="!files[group].length" class="px-3 pb-1 text-2xs text-ink-faint">{{ t('appData.noFiles') }}</p>
                  <button
                    v-for="f in files[group]"
                    :key="f.name"
                    type="button"
                    class="flex min-h-7 w-full min-w-0 items-center gap-1.5 px-3 text-left text-xs"
                    :class="selected?.name === f.name && selected.kind === (group === 'databases' ? 'db' : 'prefs') ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
                    :disabled="!!busy"
                    :data-appdata-file="f.name"
                    @click="group === 'databases' ? openDb(f) : openPrefs(f)"
                  >
                    <component :is="group === 'databases' ? Database : FileCog" :size="12" class="shrink-0 text-ink-muted" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-mono" :title="f.name">{{ f.name }}</span>
                    <span v-if="f.size !== null" class="shrink-0 text-2xs text-ink-faint tabular-nums">{{ f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB` }}</span>
                  </button>
                </template>
                <p v-if="files.skipped" class="px-3 pt-2 text-2xs text-ink-faint">{{ t('appData.skipped', { n: files.skipped }) }}</p>
              </template>
            </nav>

            <section class="flex min-w-0 flex-1 flex-col">
              <p v-if="busy === 'open'" class="flex items-center gap-2 px-4 py-3 text-xs text-ink-muted"><LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('appData.db.opening') }}</p>
              <p v-else-if="!db && !prefs" class="px-4 py-3 text-xs text-ink-faint">{{ files ? t('appData.pick') : '' }}</p>

              <template v-if="db">
                <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                  <label class="flex min-w-0 items-center gap-1.5 text-2xs text-ink-muted">
                    {{ t('appData.db.table') }}
                    <select class="ccm-field max-w-64 min-w-0 text-xs" :value="table ?? ''" data-appdata-table @change="pickTable(($event.target as HTMLSelectElement).value)">
                      <option v-for="tb in db.tables" :key="tb.name" :value="tb.name">{{ tb.name }}{{ tb.type === 'view' ? ` (${t('appData.db.view')})` : tb.rows !== null ? ` · ${tb.rows}` : '' }}</option>
                    </select>
                  </label>
                  <button type="button" class="ccm-btn-plain text-xs" :aria-pressed="showSchema" :disabled="!current" data-appdata-schema @click="showSchema = !showSchema">{{ t('appData.db.schema') }}</button>
                  <button type="button" class="ccm-btn-plain text-xs" :disabled="!current" :title="t('appData.db.fillHint')" data-appdata-fill @click="fillSchema">
                    <Sparkles :size="13" aria-hidden="true" />{{ t('appData.db.fill') }}
                  </button>
                  <div class="ml-auto flex items-center gap-1 text-2xs text-ink-muted">
                    <span class="tabular-nums">{{ pageText }}</span>
                    <button type="button" class="ccm-btn-plain" :disabled="page === 0 || !!queryResult" :title="t('appData.db.prev')" :aria-label="t('appData.db.prev')" @click="turn(-1)"><ChevronLeft :size="14" aria-hidden="true" /></button>
                    <button type="button" class="ccm-btn-plain" :disabled="!hasNext || !!queryResult" :title="t('appData.db.next')" :aria-label="t('appData.db.next')" @click="turn(1)"><ChevronRight :size="14" aria-hidden="true" /></button>
                  </div>
                </div>
                <p class="shrink-0 px-3 pt-1.5 text-2xs text-ink-faint">
                  {{ t('appData.db.copyNote', { when: copyWhen }) }}
                  <span v-if="db.wal === 'applied'">{{ t('appData.db.walApplied', { n: db.walFrames }) }}</span>
                  <span v-else-if="db.wal === 'partial'" class="text-warning">{{ t('appData.db.walPartial') }}</span>
                </p>
                <pre v-if="showSchema && current" class="mx-3 mt-1.5 max-h-40 shrink-0 overflow-auto rounded-control bg-well px-3 py-2 font-mono text-2xs whitespace-pre-wrap text-well-ink" data-appdata-sql>{{ current.sql }}</pre>
                <form class="flex shrink-0 items-start gap-1.5 px-3 pt-2" @submit.prevent="runQuery">
                  <textarea
                    v-model="sql"
                    rows="2"
                    class="ccm-field min-w-0 flex-1 resize-y font-mono text-xs"
                    spellcheck="false"
                    maxlength="20000"
                    :aria-label="t('appData.db.query')"
                    :placeholder="t('appData.db.queryPlaceholder')"
                    data-appdata-query
                    @keydown.ctrl.enter.prevent="runQuery"
                    @keydown.meta.enter.prevent="runQuery"
                  />
                  <button type="submit" class="ccm-btn shrink-0" :disabled="!sql.trim() || !!busy" data-appdata-run>
                    <LoaderCircle v-if="busy === 'query'" :size="13" class="ccm-spin" aria-hidden="true" />
                    <Play v-else :size="13" aria-hidden="true" />{{ t('appData.db.run') }}
                  </button>
                  <button v-if="queryResult" type="button" class="ccm-btn-plain shrink-0" :title="t('appData.close')" :aria-label="t('appData.close')" @click="queryResult = null"><X :size="13" aria-hidden="true" /></button>
                </form>
                <p v-if="queryResult" class="shrink-0 px-3 pt-1 text-2xs text-ink-muted">
                  {{ t('appData.db.queryRows', { n: queryResult.rows.length }) }}<template v-if="queryResult.truncated"> · {{ t('appData.db.truncated', { n: queryResult.rows.length }) }}</template>
                </p>
                <div class="m-3 min-h-0 flex-1 overflow-auto rounded-control border border-line" data-appdata-grid>
                  <p v-if="shown && !shown.rows.length" class="px-3 py-2 text-xs text-ink-faint">{{ t('appData.db.empty') }}</p>
                  <table v-else-if="shown" class="min-w-full text-xs">
                    <thead class="sticky top-0 bg-raised text-2xs text-ink-muted">
                      <tr>
                        <th v-for="(c, i) in shown.columns" :key="i" class="border-b border-line px-2 py-1 text-left font-medium whitespace-nowrap">{{ c }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                      <tr v-for="(r, i) in shown.rows" :key="i" class="hover:bg-fill">
                        <td v-for="(c, j) in r" :key="j" class="max-w-80 truncate px-2 py-0.5 font-mono text-2xs" :class="c === null || isBlob(c) ? 'text-ink-faint' : 'text-ink'" :title="cellText(c)">{{ cellText(c) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>

              <template v-if="prefs">
                <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                  <p class="mr-auto min-w-0 truncate font-mono text-xs">{{ prefs.name }}</p>
                  <span class="text-2xs text-ink-faint">{{ t('appData.pref.confirmHint') }}</span>
                  <button type="button" class="ccm-btn" :disabled="!prefs.hasOriginal || !!busy" :title="t('appData.pref.restoreHint')" data-appdata-restore @click="restorePrefs">
                    <LoaderCircle v-if="busy === 'restore'" :size="13" class="ccm-spin" aria-hidden="true" />
                    <RotateCcw v-else :size="13" aria-hidden="true" />{{ t('appData.pref.restore') }}
                  </button>
                </div>
                <div class="min-h-0 flex-1 overflow-auto px-3 py-2">
                  <p v-if="!prefs.entries.length" class="text-xs text-ink-faint">{{ t('appData.pref.none') }}</p>
                  <table v-else class="w-full table-fixed text-xs" data-appdata-prefs>
                    <thead class="text-2xs text-ink-faint">
                      <tr class="text-left">
                        <th class="w-[34%] py-1 font-medium">{{ t('appData.pref.key') }}</th>
                        <th class="w-20 py-1 font-medium">{{ t('appData.pref.type') }}</th>
                        <th class="py-1 font-medium">{{ t('appData.pref.value') }}</th>
                        <th class="w-10 py-1" />
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                      <tr v-for="e in prefs.entries" :key="e.key" class="align-top">
                        <td class="truncate py-1 pr-2 font-mono text-2xs" :title="e.key">{{ e.key }}</td>
                        <td class="py-1 text-2xs text-ink-muted">{{ e.type }}</td>
                        <td class="min-w-0 py-1">
                          <form v-if="editing === e.key" class="flex flex-col gap-1" @submit.prevent="savePref">
                            <select v-if="e.type === 'boolean'" v-model="draft" class="ccm-field w-28 text-xs" data-appdata-draft>
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                            <textarea v-else-if="e.type === 'string' || e.type === 'set'" v-model="draft" rows="3" class="ccm-field w-full resize-y font-mono text-2xs" spellcheck="false" data-appdata-draft />
                            <input v-else v-model="draft" class="ccm-field w-48 font-mono text-xs" spellcheck="false" inputmode="decimal" data-appdata-draft />
                            <p v-if="e.type === 'set'" class="text-2xs text-ink-faint">{{ t('appData.pref.setHint') }}</p>
                            <p v-if="!draftOk" class="text-2xs text-warning" role="alert">{{ t('appData.pref.invalid', { type: e.type }) }}</p>
                            <div class="flex gap-1.5">
                              <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!draftOk || !!busy" data-appdata-save>
                                <LoaderCircle v-if="busy === 'save'" :size="13" class="ccm-spin" aria-hidden="true" />{{ t('appData.pref.save') }}
                              </button>
                              <button type="button" class="ccm-btn" @click="editing = null">{{ t('appData.pref.cancel') }}</button>
                            </div>
                          </form>
                          <span v-else class="block truncate font-mono text-2xs" :title="prefShown(e.value)">{{ prefShown(e.value) }}</span>
                        </td>
                        <td class="py-1 text-right">
                          <button
                            v-if="editing !== e.key"
                            type="button"
                            class="ccm-btn-plain"
                            :disabled="!!busy"
                            :title="t('appData.pref.edit', { key: e.key })"
                            :aria-label="t('appData.pref.edit', { key: e.key })"
                            :data-appdata-edit="e.key"
                            @click="startEdit(e)"
                          >
                            <Pencil :size="12" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
