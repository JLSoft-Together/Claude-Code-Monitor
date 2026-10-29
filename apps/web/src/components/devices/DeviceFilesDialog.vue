<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, CircleAlert, Download, ExternalLink, File, FileQuestion, Folder, FolderDown, FolderOpen, FolderPlus, Link2, LoaderCircle, RefreshCw, Trash2, Upload, X } from 'lucide-vue-next'
import type { DevFsEntry, DevFsErrorCode, DevFsProgress, DevFsScope, DevFsSource } from '@ccm/shared'
import { crumbs, devFsCancel, devFsDelete, devFsList, devFsMkdir, devFsOpen, devFsPull, devFsPush, fmtBytes, joinPath, onDevFsProgress, opensAsDir, parentOf, progressPct, SDCARD_ROOTS, transferId, validName } from '../../lib/devFiles'
import { isPackageName } from '../../lib/deviceUiTest'
import { dragPaths, hasDragPath } from '../../lib/explorer/dragPath'
import { pathForFile } from '../../lib/preview'
import { retireOverlay } from '../../lib/motion'
import { useDeviceHandoff } from '../../composables/useDeviceHandoff'

const props = defineProps<{ open: boolean; deviceId: string | null; deviceName: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, te } = useI18n()
const handoff = useDeviceHandoff(() => null)
const PKG_KEY = 'ccm.devices.appDataPkg'
const KIND_ICON = { dir: Folder, file: File, link: Link2, other: FileQuestion }

const dialog = ref<HTMLElement | null>(null)
const scopeKind = ref<'sdcard' | 'app'>('sdcard')
const sdRoot = ref<string>(SDCARD_ROOTS[0])
const pkg = ref('')
const appPkg = ref<string | null>(null)
const dir = ref<string>(SDCARD_ROOTS[0])
const entries = ref<DevFsEntry[] | null>(null)
const skipped = ref(0)
const busy = ref<string | null>(null)
const error = ref<{ code: DevFsErrorCode; detail?: string } | null>(null)
const note = ref<string | null>(null)
const pulled = ref<{ local: string; name: string } | null>(null)
const transfer = ref<{ id: string; kind: 'pull' | 'push'; p: DevFsProgress | null } | null>(null)
const naming = ref(false)
const newName = ref('')
const dropping = ref(false)
let gen = 0
let restoreFocus: HTMLElement | null = null

const scope = computed<DevFsScope | null>(() => (scopeKind.value === 'sdcard' ? { kind: 'sdcard' } : appPkg.value ? { kind: 'app', pkg: appPkg.value } : null))
const root = computed(() => (scopeKind.value === 'sdcard' ? sdRoot.value : '/'))
const trail = computed(() => crumbs(root.value, dir.value))
const up = computed(() => parentOf(root.value, dir.value))
const projectDir = computed(() => (handoff.target() as { cwd?: string } | null)?.cwd ?? null)
const pct = computed(() => (transfer.value?.p ? progressPct(transfer.value.p) : null))
const where = computed(() => (scopeKind.value === 'app' && appPkg.value ? `${appPkg.value}:${dir.value}` : dir.value))

const errorText = computed(() => {
  const code = error.value?.code
  if (!code) return ''
  for (const k of [`devFiles.error.${code}`, `appData.error.${code}`, `devices.error.${code}`]) if (te(k)) return t(k)
  return t('devices.error.denied')
})

function fail(r: { error: DevFsErrorCode; detail?: string }): void {
  error.value = r.error === 'cancelled' ? null : { code: r.error, detail: r.detail }
  if (r.error === 'cancelled') note.value = t('devFiles.error.cancelled')
}

async function step<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (busy.value) return null
  busy.value = key
  error.value = null
  note.value = null
  pulled.value = null
  try {
    return await fn()
  } finally {
    busy.value = null
    keepFocus()
  }
}

// A focused button that turns disabled while busy drops focus to <body>, and Esc / Tab would then miss the dialog.
function keepFocus(): void {
  void nextTick(() => {
    if (dialog.value && !dialog.value.contains(document.activeElement)) dialog.value.focus()
  })
}

async function load(to: string = dir.value): Promise<void> {
  const id = props.deviceId
  const s = scope.value
  if (!id || !s) return
  const my = ++gen
  const r = await step('list', () => devFsList(id, s, to))
  if (!r || my !== gen) return
  if (!r.ok) return fail(r)
  dir.value = r.path
  entries.value = r.entries
  skipped.value = r.skipped
  naming.value = false
}

function setScope(kind: 'sdcard' | 'app'): void {
  scopeKind.value = kind
  entries.value = null
  error.value = null
  note.value = null
  if (kind === 'sdcard') {
    dir.value = sdRoot.value
    void load()
  } else if (appPkg.value) {
    dir.value = '/'
    void load()
  }
}

function setRoot(r: string): void {
  sdRoot.value = r
  dir.value = r
  void load()
}

function openApp(): void {
  const p = pkg.value.trim()
  if (!isPackageName(p)) return
  appPkg.value = p
  dir.value = '/'
  try {
    localStorage.setItem(PKG_KEY, p)
  } catch {
    // remembered package is a convenience only
  }
  void load()
}

function enter(e: DevFsEntry): void {
  if (opensAsDir(e)) void load(joinPath(dir.value, e.name))
}

async function mkdir(): Promise<void> {
  const id = props.deviceId
  const s = scope.value
  const name = newName.value.trim()
  if (!id || !s || !validName(name)) return
  const r = await step('mkdir', () => devFsMkdir(id, s, dir.value, name))
  if (!r) return
  if (!r.ok) return fail(r)
  naming.value = false
  newName.value = ''
  await load()
  note.value = t('devFiles.created', { name })
}

async function remove(e: DevFsEntry): Promise<void> {
  const id = props.deviceId
  const s = scope.value
  if (!id || !s) return
  const r = await step('delete', () => devFsDelete(id, s, joinPath(dir.value, e.name), e.kind === 'dir'))
  if (!r) return
  if (!r.ok) return fail(r)
  await load()
  note.value = t('devFiles.deleted', { name: e.name })
}

async function pull(e: DevFsEntry, intoProject: boolean): Promise<void> {
  const id = props.deviceId
  const s = scope.value
  const proj = projectDir.value
  if (!id || !s || (intoProject && !proj)) return
  const tid = transferId()
  const r = await step('transfer', async () => {
    transfer.value = { id: tid, kind: 'pull', p: null }
    try {
      return await devFsPull(id, { transfer: tid, scope: s, path: joinPath(dir.value, e.name), kind: e.kind, size: e.size, dest: intoProject && proj ? { kind: 'dir', dir: proj } : { kind: 'pick' } })
    } finally {
      transfer.value = null
    }
  })
  if (!r) return
  if (!r.ok) return fail(r)
  pulled.value = { local: r.local, name: r.name }
  note.value = t('devFiles.pulled', { name: r.name, dir: r.inDir })
}

async function push(source: DevFsSource): Promise<void> {
  const id = props.deviceId
  const s = scope.value
  if (!id || !s) return
  const tid = transferId()
  const r = await step('transfer', async () => {
    transfer.value = { id: tid, kind: 'push', p: null }
    try {
      return await devFsPush(id, { transfer: tid, scope: s, dir: dir.value, source })
    } finally {
      transfer.value = null
    }
  })
  if (!r) return
  if (!r.ok) return fail(r)
  await load()
  note.value = [t('devFiles.pushed', { n: r.pushed.length }, r.pushed.length), r.skipped.length ? t('devFiles.pushSkipped', { names: r.skipped.join(', ') }) : ''].filter(Boolean).join(' ')
}

function cancelTransfer(): void {
  if (transfer.value) void devFsCancel(transfer.value.id)
}

const accepts = (e: DragEvent): boolean => !!scope.value && (hasDragPath(e.dataTransfer) || Array.from(e.dataTransfer?.types ?? []).includes('Files'))

function onDragOver(e: DragEvent): void {
  if (!accepts(e) || busy.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropping.value = true
}

function onDrop(e: DragEvent): void {
  dropping.value = false
  if (!accepts(e) || busy.value) return
  e.preventDefault()
  const fromOs = Array.from(e.dataTransfer?.files ?? []).map(pathForFile).filter(Boolean)
  const paths = [...new Set([...dragPaths(e.dataTransfer), ...fromOs])]
  if (!paths.length) {
    error.value = null
    note.value = t('devFiles.noDropPaths')
    return
  }
  void push({ kind: 'paths', paths: paths.slice(0, 20) })
}

async function startNaming(): Promise<void> {
  naming.value = true
  newName.value = ''
  await nextTick()
  dialog.value?.querySelector<HTMLElement>('[data-files-newname]')?.focus()
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (naming.value) naming.value = false
    else if (!transfer.value) emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
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

const offProgress = onDevFsProgress((p) => {
  if (transfer.value?.id === p.transfer) transfer.value = { ...transfer.value, p }
})
onBeforeUnmount(offProgress)

watch(
  () => props.open,
  async (open) => {
    gen++
    if (!open) {
      cancelTransfer()
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    scopeKind.value = 'sdcard'
    sdRoot.value = SDCARD_ROOTS[0]
    dir.value = SDCARD_ROOTS[0]
    entries.value = null
    appPkg.value = null
    error.value = null
    note.value = null
    pulled.value = null
    naming.value = false
    try {
      pkg.value = localStorage.getItem(PKG_KEY) ?? ''
    } catch {
      pkg.value = ''
    }
    void load()
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[data-files-scope="sdcard"]')?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[5vh]" @mousedown.self="!transfer && emit('close')">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-files-title"
          tabindex="-1"
          class="flex h-[86vh] w-full max-w-[980px] flex-col overflow-hidden ccm-sheet outline-none"
          data-device-files
          @keydown="trap"
        >
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2.5 pr-3 pl-4">
            <FolderOpen :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="device-files-title" class="truncate text-sm font-semibold">{{ t('devFiles.title', { name: deviceName }) }}</h2>
              <p class="truncate text-2xs text-ink-faint" :title="t('devFiles.hint')">{{ t('devFiles.hint') }}</p>
            </div>
            <div class="flex rounded-control border border-line p-0.5" role="group">
              <button
                v-for="k in (['sdcard', 'app'] as const)"
                :key="k"
                type="button"
                class="rounded-[5px] px-2 py-0.5 text-xs"
                :class="scopeKind === k ? 'bg-accent text-on-accent' : 'text-ink hover:bg-fill'"
                :aria-pressed="scopeKind === k"
                :disabled="!!transfer"
                :data-files-scope="k"
                @click="setScope(k)"
              >
                {{ t(`devFiles.scope.${k}`) }}
              </button>
            </div>
            <button type="button" class="ccm-btn-plain" :disabled="!!transfer" :title="t('devFiles.close')" :aria-label="t('devFiles.close')" data-files-close @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
            <label v-if="scopeKind === 'sdcard'" class="flex items-center gap-1.5 text-2xs text-ink-muted">
              {{ t('devFiles.root') }}
              <select class="ccm-field font-mono text-xs" :value="sdRoot" :disabled="!!busy" data-files-root @change="setRoot(($event.target as HTMLSelectElement).value)">
                <option v-for="r in SDCARD_ROOTS" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <form v-else class="flex min-w-0 items-center gap-1.5" @submit.prevent="openApp">
              <input
                v-model="pkg"
                class="ccm-field w-52 min-w-0 font-mono text-xs"
                spellcheck="false"
                maxlength="255"
                :aria-label="t('devFiles.pkg')"
                :placeholder="t('devFiles.pkgPlaceholder')"
                data-files-pkg
              />
              <button type="submit" class="ccm-btn" :disabled="!isPackageName(pkg.trim()) || !!busy" data-files-pkg-open>{{ t('devFiles.open') }}</button>
            </form>
            <button type="button" class="ccm-btn-plain" :disabled="!up || !!busy" :title="t('devFiles.up')" :aria-label="t('devFiles.up')" data-files-up @click="up && load(up)">
              <ArrowUp :size="14" aria-hidden="true" />
            </button>
            <nav class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-xs" :aria-label="t('devFiles.col.name')" data-files-crumbs>
              <template v-for="(c, i) in trail" :key="c.path">
                <span v-if="i" class="text-ink-faint" aria-hidden="true">/</span>
                <button type="button" class="max-w-40 truncate rounded px-1 font-mono hover:bg-fill" :class="i === trail.length - 1 ? 'text-ink' : 'text-ink-muted'" :disabled="!!busy || !scope" :title="c.path" :data-files-crumb="c.path" @click="load(c.path)">
                  {{ c.label }}
                </button>
              </template>
            </nav>
            <button type="button" class="ccm-btn-plain" :disabled="!scope || !!busy" :title="t('devFiles.refresh')" :aria-label="t('devFiles.refresh')" data-files-refresh @click="load()">
              <LoaderCircle v-if="busy === 'list'" :size="14" class="ccm-spin" aria-hidden="true" />
              <RefreshCw v-else :size="14" aria-hidden="true" />
            </button>
            <button type="button" class="ccm-btn" :disabled="!scope || !!busy" data-files-newfolder @click="startNaming">
              <FolderPlus :size="13" aria-hidden="true" />{{ t('devFiles.newFolder') }}
            </button>
            <button type="button" class="ccm-btn" :disabled="!scope || !!busy" :title="t('devFiles.pushHint')" data-files-push @click="push({ kind: 'pick' })">
              <Upload :size="13" aria-hidden="true" />{{ t('devFiles.push') }}
            </button>
          </div>

          <div v-if="transfer" class="flex shrink-0 items-center gap-3 border-b border-line bg-fill px-4 py-2 text-xs" data-files-transfer :data-files-transfer-kind="transfer.kind">
            <LoaderCircle :size="13" class="shrink-0 ccm-spin text-ink-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p class="truncate">
                {{ transfer.kind === 'pull' ? t('devFiles.transfer.pull', { name: transfer.p?.name ?? '' }) : t('devFiles.transfer.push', { name: transfer.p?.name ?? '', i: (transfer.p?.index ?? 0) + 1, n: transfer.p?.count ?? 1 }) }}
              </p>
              <div
                class="mt-1 h-1 overflow-hidden rounded-full bg-line"
                role="progressbar"
                :aria-valuenow="pct ?? undefined"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="transfer.p?.name ?? ''"
              >
                <div v-if="pct !== null" class="h-full bg-accent transition-[width] duration-(--ccm-dur-fast)" :style="{ width: `${pct}%` }" data-files-progress />
              </div>
            </div>
            <span class="shrink-0 text-2xs text-ink-muted tabular-nums" data-files-bytes>
              {{ transfer.p ? fmtBytes(transfer.p.done) : '' }}<template v-if="transfer.p?.total"> / {{ fmtBytes(transfer.p.total) }}</template><template v-else-if="transfer.p"> · {{ t('devFiles.unknownSize') }}</template>
            </span>
            <button type="button" class="ccm-btn shrink-0" data-files-cancel @click="cancelTransfer">{{ t('devFiles.cancelTransfer') }}</button>
          </div>

          <div v-if="error || note" class="flex shrink-0 flex-wrap items-start gap-1.5 border-b border-line px-4 py-2 text-xs" :class="error ? 'bg-warning-soft' : 'bg-fill'" role="status" data-files-message>
            <CircleAlert v-if="error" :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1">
              {{ error ? errorText : note }}
              <span v-if="error?.detail" class="ml-1 line-clamp-2 font-mono text-2xs break-all text-ink-muted" :title="error.detail">{{ error.detail }}</span>
            </p>
            <template v-if="pulled && !error">
              <button type="button" class="ccm-btn-plain text-xs" :title="t('devFiles.openHint')" data-files-open-pulled @click="devFsOpen(pulled.local, 'open')">
                <ExternalLink :size="13" aria-hidden="true" />{{ t('devFiles.openFile') }}
              </button>
              <button type="button" class="ccm-btn-plain text-xs" data-files-reveal-pulled @click="devFsOpen(pulled.local, 'reveal')">
                <FolderOpen :size="13" aria-hidden="true" />{{ t('devFiles.reveal') }}
              </button>
            </template>
          </div>

          <form v-if="naming" class="flex shrink-0 items-center gap-1.5 border-b border-line px-4 py-2" @submit.prevent="mkdir">
            <FolderPlus :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <input v-model="newName" class="ccm-field w-64 min-w-0 text-xs" maxlength="255" spellcheck="false" :aria-label="t('devFiles.newFolderName')" :placeholder="t('devFiles.newFolderName')" data-files-newname />
            <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!validName(newName.trim()) || !!busy" data-files-create>{{ t('devFiles.create') }}</button>
            <button type="button" class="ccm-btn" @click="naming = false">{{ t('devFiles.cancel') }}</button>
          </form>

          <div
            class="relative min-h-0 flex-1 overflow-y-auto"
            :class="dropping ? 'bg-accent-soft' : ''"
            data-files-list
            @dragover="onDragOver"
            @dragleave.self="dropping = false"
            @drop="onDrop"
          >
            <p v-if="dropping" class="pointer-events-none sticky top-0 z-10 border-b border-accent bg-accent-soft px-4 py-1.5 text-xs text-accent-ink" data-files-drop>{{ t('devFiles.dropHere', { dir: where }) }}</p>
            <p v-if="busy === 'list' && !entries" class="flex items-center gap-2 px-4 py-3 text-xs text-ink-muted"><LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('devFiles.loading') }}</p>
            <p v-else-if="entries && !entries.length" class="px-4 py-3 text-xs text-ink-faint" data-files-empty>{{ t('devFiles.empty') }}</p>
            <table v-else-if="entries" class="w-full table-fixed text-xs">
              <thead class="sticky top-0 bg-raised text-2xs text-ink-faint">
                <tr class="text-left">
                  <th class="py-1 pl-4 font-medium">{{ t('devFiles.col.name') }}</th>
                  <th class="hidden w-24 py-1 text-right font-medium sm:table-cell">{{ t('devFiles.col.size') }}</th>
                  <th class="hidden w-36 py-1 pl-3 font-medium md:table-cell">{{ t('devFiles.col.modified') }}</th>
                  <th class="w-32 py-1 pr-3" />
                </tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr v-for="e in entries" :key="e.name" class="group hover:bg-fill" :data-files-row="e.name" :data-files-kind="e.kind">
                  <td class="min-w-0 py-0.5 pl-4">
                    <button
                      v-if="opensAsDir(e)"
                      type="button"
                      class="flex min-h-7 w-full min-w-0 items-center gap-1.5 text-left"
                      :disabled="!!busy"
                      :title="e.target ? `${e.name} → ${e.target}` : e.name"
                      data-files-enter
                      @click="enter(e)"
                    >
                      <component :is="KIND_ICON[e.kind]" :size="13" class="shrink-0 text-accent-ink" :aria-label="t(`devFiles.kind.${e.kind}`)" />
                      <span class="truncate">{{ e.name }}</span>
                    </button>
                    <span v-else class="flex min-h-7 min-w-0 items-center gap-1.5" :title="e.name">
                      <component :is="KIND_ICON[e.kind]" :size="13" class="shrink-0 text-ink-muted" :aria-label="t(`devFiles.kind.${e.kind}`)" />
                      <span class="truncate">{{ e.name }}</span>
                    </span>
                  </td>
                  <td class="hidden py-0.5 text-right text-ink-muted tabular-nums sm:table-cell">{{ e.size !== null && e.kind !== 'dir' ? fmtBytes(e.size) : '' }}</td>
                  <td class="hidden truncate py-0.5 pl-3 text-ink-muted tabular-nums md:table-cell">{{ e.modified ?? '' }}</td>
                  <td class="py-0.5 pr-3">
                    <div class="flex justify-end gap-0.5" role="group" :aria-label="t('devFiles.rowActions', { name: e.name })">
                      <button type="button" class="ccm-btn-plain" :disabled="!!busy || e.kind === 'other' || (e.kind === 'dir' && scopeKind === 'app')" :title="t('devFiles.pullTo')" :aria-label="t('devFiles.pullTo')" data-files-pull @click="pull(e, false)">
                        <Download :size="13" aria-hidden="true" />
                      </button>
                      <button
                        v-if="projectDir"
                        type="button"
                        class="ccm-btn-plain"
                        :disabled="!!busy || e.kind === 'other' || (e.kind === 'dir' && scopeKind === 'app')"
                        :title="t('devFiles.pullProjectHint', { dir: projectDir })"
                        :aria-label="t('devFiles.pullProject')"
                        data-files-pull-project
                        @click="pull(e, true)"
                      >
                        <FolderDown :size="13" aria-hidden="true" />
                      </button>
                      <button type="button" class="ccm-btn-plain hover:text-st-error!" :disabled="!!busy" :title="t('devFiles.deleteHint')" :aria-label="t('devFiles.delete')" data-files-delete @click="remove(e)">
                        <Trash2 :size="13" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="skipped" class="px-4 py-2 text-2xs text-ink-faint">{{ t('devFiles.skipped', { n: skipped }) }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
