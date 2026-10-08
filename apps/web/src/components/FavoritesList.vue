<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, FolderOpen, FolderPlus, GripVertical, History, LoaderCircle, Pencil, SquareTerminal, Star, X } from 'lucide-vue-next'
import type { Favorite, LaunchMode } from '@ccm/shared'
import { shortPath } from '../lib/format'
import { useConnectionStore } from '../stores/connection'
import { dirKey, useFavoritesStore } from '../stores/favorites'
import { useTerminalsStore } from '../stores/terminals'
import LottieArt from './LottieArt.vue'
import Pager from './Pager.vue'

const { t } = useI18n()
const favorites = useFavoritesStore()
const terminals = useTerminalsStore()
const connection = useConnectionStore()

const sent = ref<string | null>(null)
const failed = ref<string | null>(null)
let timer: number | undefined

const liveCount = computed(() => {
  const out: Record<string, number> = {}
  for (const term of terminals.live) if (term.cwd) out[dirKey(term.cwd)] = (out[dirKey(term.cwd)] ?? 0) + 1
  return out
})

function open(f: Favorite, mode: LaunchMode): void {
  const key = `${f.dir}|${mode}`
  window.clearTimeout(timer)
  const ok = connection.openFavorite(f.dir, mode)
  sent.value = ok ? key : null
  failed.value = ok ? null : f.dir
  timer = window.setTimeout(() => {
    sent.value = null
    failed.value = null
  }, 1800)
}

const editing = ref<string | null>(null)
const draft = ref('')
const editFailed = ref(false)
const input = ref<HTMLInputElement[]>([])

async function startEdit(f: Favorite): Promise<void> {
  editing.value = f.dir
  draft.value = f.label
  editFailed.value = false
  await nextTick()
  input.value[0]?.focus()
  input.value[0]?.select()
}

function commitEdit(f: Favorite): void {
  if (editing.value !== f.dir) return
  const value = draft.value.trim()
  if (value !== f.label && !connection.renameFavorite(f.dir, value || null)) {
    editFailed.value = true
    return
  }
  editing.value = null
}

function cancelEdit(): void {
  editing.value = null
  editFailed.value = false
}

const PAGE_SIZE = 5
const page = ref(0)
const pages = computed(() => Math.max(1, Math.ceil(favorites.list.length / PAGE_SIZE)))
const shown = computed(() => favorites.list.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE))
watch(pages, (n) => {
  if (page.value > n - 1) page.value = n - 1
})

const listEl = ref<ComponentPublicInstance | null>(null)
const dragging = ref<string | null>(null)
const announce = ref('')
const handles = new Map<string, HTMLElement>()
let dragStart: string[] = []

const indexOf = (dir: string): number => favorites.list.findIndex((f) => f.dir === dir)

function setHandle(dir: string, el: unknown): void {
  if (el instanceof HTMLElement) handles.set(dir, el)
  else handles.delete(dir)
}

function commitOrder(dir: string, before: string[]): void {
  const after = favorites.list.map((f) => f.dir)
  if (after.every((d, i) => d === before[i])) return
  if (connection.reorderFavorites(after)) {
    failed.value = null
    const f = favorites.list[indexOf(dir)]
    if (f) announce.value = t('favorites.moved', { name: f.label, pos: indexOf(dir) + 1, n: after.length })
    return
  }
  const byDir = new Map(favorites.list.map((f) => [f.dir, f]))
  favorites.replaceAll(before.flatMap((d) => byDir.get(d) ?? []))
  window.clearTimeout(timer)
  failed.value = dir
  timer = window.setTimeout(() => (failed.value = null), 1800)
}

function onDragMove(e: PointerEvent): void {
  const dir = dragging.value
  const ul = listEl.value?.$el as HTMLElement | undefined
  if (!dir || !ul) return
  const y = e.clientY - ul.getBoundingClientRect().top
  const items = [...ul.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.favIndex)
  let target = items.length - 1
  for (let i = 0; i < items.length; i++) {
    const el = items[i]!
    if (y < el.offsetTop + el.offsetHeight / 2) {
      target = i
      break
    }
  }
  const from = indexOf(dir)
  const to = page.value * PAGE_SIZE + Math.max(0, target)
  if (from >= 0 && to !== from) favorites.move(from, to)
}

function onDragEnd(e: PointerEvent): void {
  const handle = e.currentTarget as HTMLElement
  handle.removeEventListener('pointermove', onDragMove)
  handle.removeEventListener('pointerup', onDragEnd)
  handle.removeEventListener('pointercancel', onDragEnd)
  const dir = dragging.value
  dragging.value = null
  if (dir) commitOrder(dir, dragStart)
}

function onDragStart(e: PointerEvent, f: Favorite): void {
  if (e.button !== 0 || editing.value) return
  e.preventDefault()
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  handle.focus()
  dragStart = favorites.list.map((x) => x.dir)
  dragging.value = f.dir
  handle.addEventListener('pointermove', onDragMove)
  handle.addEventListener('pointerup', onDragEnd)
  handle.addEventListener('pointercancel', onDragEnd)
}

async function onHandleKey(e: KeyboardEvent, f: Favorite): Promise<void> {
  const from = indexOf(f.dir)
  const last = favorites.list.length - 1
  const to = { ArrowUp: from - 1, ArrowDown: from + 1, Home: 0, End: last }[e.key]
  if (to === undefined || from < 0) return
  e.preventDefault()
  if (to < 0 || to > last || to === from) return
  const before = favorites.list.map((x) => x.dir)
  favorites.move(from, to)
  page.value = Math.floor(to / PAGE_SIZE)
  commitOrder(f.dir, before)
  await nextTick()
  handles.get(f.dir)?.focus()
}

const adding = ref(false)
const addDir = ref('')
const addName = ref('')
const addPending = ref(false)
const addError = ref<string | null>(null)
const addInput = ref<HTMLInputElement | null>(null)
const justAdded = ref<string | null>(null)
const suggestions = computed(() => [
  ...new Set(terminals.list.map((x) => x.cwd).filter((d): d is string => !!d && !favorites.has(d))),
])
let pendingKey: string | null = null
let countBefore = 0

async function openAdd(): Promise<void> {
  adding.value = true
  addError.value = null
  await nextTick()
  addInput.value?.focus()
}

function closeAdd(): void {
  adding.value = false
  addDir.value = ''
  addName.value = ''
  addError.value = null
  addPending.value = false
  pendingKey = null
}

const picking = ref(false)

async function browse(): Promise<void> {
  if (picking.value) return
  picking.value = true
  addError.value = null
  const r = await connection.pickFolder()
  picking.value = false
  if (!adding.value) return
  if (r.result === 'ok' && r.dir) {
    addDir.value = r.dir
    addInput.value?.focus()
  } else if (r.result !== 'cancelled') {
    addError.value = t(`favorites.pickError.${r.result === 'ok' ? 'failed' : r.result}`)
  }
}

function submitAdd(): void {
  const dir = addDir.value.trim().replace(/^"(.*)"$/, '$1')
  if (!dir || addPending.value) return
  addError.value = null
  if (favorites.has(dir)) {
    addError.value = t('favorites.addError.exists')
    return
  }
  if (!connection.addFavorite(dir, addName.value.trim() || null)) {
    addError.value = t('favorites.offline')
    return
  }
  pendingKey = dirKey(dir)
  countBefore = favorites.list.length
  addPending.value = true
}

watch(
  () => favorites.list,
  (list) => {
    if (!pendingKey) return
    let i = list.findIndex((f) => dirKey(f.dir) === pendingKey)
    // The collector resolves the path ("D:\a\..\b"), so fall back to the newest entry when the key differs.
    if (i < 0 && list.length > countBefore) i = list.reduce((best, f, j) => (f.addedAt > list[best]!.addedAt ? j : best), 0)
    if (i < 0) return
    page.value = Math.floor(i / PAGE_SIZE)
    justAdded.value = list[i]!.dir
    closeAdd()
  },
)

watch(
  () => favorites.rejected?.n,
  () => {
    const r = favorites.rejected
    if (!r || !pendingKey) return
    pendingKey = null
    addPending.value = false
    addError.value = t(`favorites.addError.${r.reason}`)
  },
)

const actionCls =
  'relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-accent'
</script>

<template>
  <section v-if="favorites.list.length || connection.hasData" class="mb-4" aria-labelledby="favorites-title">
    <div class="mb-2 flex items-center gap-1.5 px-0.5">
      <h3 id="favorites-title" class="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <Star :size="13" fill="currentColor" class="text-st-waiting" aria-hidden="true" />{{ t('favorites.title') }}
        <span v-if="favorites.list.length" class="font-normal text-ink-faint tabular">{{ favorites.list.length }}</span>
      </h3>
      <button
        v-if="!adding"
        type="button"
        class="-my-1 inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-raised hover:text-accent"
        :title="t('favorites.addTitle')"
        @click="openAdd"
      >
        <FolderPlus :size="15" aria-hidden="true" />{{ t('favorites.add') }}
      </button>
    </div>

    <Transition
      enter-active-class="transition duration-200 ease-out-quint"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-120 ease-in"
      leave-to-class="opacity-0"
    >
      <form v-if="adding" class="mb-2 rounded-xl border border-accent bg-surface p-2.5" @submit.prevent="submitAdd" @keydown.esc.prevent.stop="closeAdd">
        <label for="fav-add-dir" class="mb-1 block text-2xs font-medium text-ink-muted">{{ t('favorites.addPath') }}</label>
        <div class="flex items-center gap-1.5">
        <input
          id="fav-add-dir"
          ref="addInput"
          v-model="addDir"
          list="fav-add-suggest"
          maxlength="1024"
          spellcheck="false"
          autocomplete="off"
          :placeholder="t('favorites.addPathPlaceholder')"
          class="h-9 w-full min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 font-mono text-xs text-ink outline-none focus:border-accent"
          :aria-invalid="!!addError"
          :aria-describedby="addError ? 'fav-add-err' : undefined"
        />
        <button
          type="button"
          class="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-wait disabled:opacity-60"
          :disabled="picking"
          :title="t('favorites.browseTitle')"
          @click="browse"
        >
          <LoaderCircle v-if="picking" :size="14" class="ccm-spin" aria-hidden="true" /><FolderOpen v-else :size="14" aria-hidden="true" />
          {{ picking ? t('favorites.browsing') : t('favorites.browse') }}
        </button>
        </div>
        <datalist id="fav-add-suggest">
          <option v-for="d in suggestions" :key="d" :value="d" />
        </datalist>
        <label for="fav-add-name" class="mt-2 mb-1 block text-2xs font-medium text-ink-muted">{{ t('favorites.addName') }}</label>
        <input
          id="fav-add-name"
          v-model="addName"
          maxlength="80"
          :placeholder="t('favorites.renamePlaceholder')"
          class="h-9 w-full min-w-0 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink outline-none focus:border-accent"
        />
        <p v-if="addError" id="fav-add-err" role="alert" class="ccm-enter mt-1.5 text-2xs text-st-error">{{ addError }}</p>
        <div class="mt-2.5 flex items-center justify-end gap-1.5">
          <button type="button" class="inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-xs font-medium text-ink-muted hover:bg-raised hover:text-ink" @click="closeAdd">
            {{ t('terminal.renameCancel') }}
          </button>
          <button
            type="submit"
            class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!addDir.trim() || addPending"
          >
            <LoaderCircle v-if="addPending" :size="14" class="ccm-spin" aria-hidden="true" /><FolderPlus v-else :size="14" aria-hidden="true" />
            {{ addPending ? t('favorites.addPending') : t('favorites.addSubmit') }}
          </button>
        </div>
      </form>
    </Transition>

    <p v-if="!favorites.list.length && !adding" class="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-xs text-ink-muted">
      {{ t('favorites.empty') }}
    </p>

    <p class="sr-only" aria-live="polite">{{ announce }}</p>
    <TransitionGroup ref="listEl" tag="ul" name="ccm-list" class="relative space-y-1.5" :class="dragging ? 'cursor-grabbing select-none' : ''">
      <li
        v-for="(f, i) in shown"
        :key="f.dir"
        :data-fav-index="i"
        class="flex items-center gap-1 rounded-xl border bg-surface py-1.5 pr-1.5 pl-0.5 transition-[border-color,box-shadow]"
        :class="[justAdded === f.dir ? 'ccm-highlight' : '', dragging === f.dir ? 'relative z-10 border-accent shadow-lg' : 'border-line']"
        @animationend="justAdded === f.dir && (justAdded = null)"
      >
        <button
          v-if="editing !== f.dir && favorites.list.length > 1"
          :ref="(el) => setHandle(f.dir, el)"
          type="button"
          class="inline-flex h-8 w-6 shrink-0 touch-none items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-raised hover:text-ink focus-visible:text-ink"
          :class="dragging === f.dir ? 'cursor-grabbing text-accent' : 'cursor-grab'"
          :aria-label="t('favorites.moveName', { name: f.label })"
          :aria-describedby="'fav-move-hint'"
          :title="t('favorites.move')"
          @pointerdown="onDragStart($event, f)"
          @keydown="onHandleKey($event, f)"
        >
          <GripVertical :size="14" aria-hidden="true" />
        </button>
        <span v-else class="w-2.5 shrink-0" aria-hidden="true" />
        <form v-if="editing === f.dir" class="flex min-w-0 flex-1 items-center gap-1" @submit.prevent="commitEdit(f)">
          <label :for="'fav-name-edit'" class="sr-only">{{ t('favorites.renameLabel') }}</label>
          <input
            :id="'fav-name-edit'"
            ref="input"
            v-model="draft"
            maxlength="80"
            :placeholder="t('favorites.renamePlaceholder')"
            class="h-8 min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2 text-sm font-medium text-ink outline-none"
            :aria-invalid="editFailed"
            @keydown.esc.prevent.stop="cancelEdit"
          />
          <button type="submit" class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-accent text-on-accent" :aria-label="t('terminal.renameSave')">
            <Check :size="15" aria-hidden="true" />
          </button>
          <button type="button" :class="actionCls" :aria-label="t('terminal.renameCancel')" @click="cancelEdit">
            <X :size="15" aria-hidden="true" />
          </button>
        </form>
        <div v-else class="min-w-0 flex-1">
          <p class="flex items-center gap-1.5 truncate text-sm font-medium" :title="f.label">
            <span class="truncate">{{ f.label }}</span>
            <span
              v-if="liveCount[dirKey(f.dir)]"
              class="shrink-0 rounded-md bg-st-working-soft px-1.5 text-2xs font-medium text-st-working"
              :title="t('favorites.liveTitle')"
            >
              {{ t('favorites.live', { n: liveCount[dirKey(f.dir)] }) }}
            </span>
          </p>
          <p class="truncate font-mono text-2xs text-ink-faint" :title="f.dir">{{ shortPath(f.dir) }}</p>
          <p v-if="failed === f.dir" role="alert" class="text-2xs text-st-error">{{ t('favorites.offline') }}</p>
        </div>
        <p v-if="editing === f.dir && editFailed" role="alert" class="shrink-0 text-2xs text-st-error">{{ t('favorites.offline') }}</p>
        <template v-if="editing !== f.dir">
        <button type="button" :class="actionCls" :aria-label="t('favorites.renameName', { name: f.label })" :title="t('favorites.rename')" @click="startEdit(f)">
          <Pencil :size="15" aria-hidden="true" />
        </button>
        <button type="button" :class="actionCls" :aria-label="t('favorites.openNewIn', { name: f.label })" :title="t('favorites.openNew')" @click="open(f, 'new')">
          <LottieArt v-if="sent === `${f.dir}|new`" name="check-pop" class="size-6" />
          <SquareTerminal v-else :size="16" aria-hidden="true" />
        </button>
        <button type="button" :class="actionCls" :aria-label="t('favorites.continueIn', { name: f.label })" :title="t('favorites.continue')" @click="open(f, 'continue')">
          <LottieArt v-if="sent === `${f.dir}|continue`" name="check-pop" class="size-6" />
          <History v-else :size="16" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-st-waiting transition-colors hover:bg-raised"
          :aria-label="t('favorites.removeName', { name: f.label })"
          :title="t('favorites.unstar')"
          @click="connection.removeFavorite(f.dir)"
        >
          <Star :size="15" fill="currentColor" aria-hidden="true" />
        </button>
        </template>
      </li>
    </TransitionGroup>
    <p id="fav-move-hint" class="sr-only">{{ t('favorites.move') }}</p>
    <Pager v-if="pages > 1" v-model="page" :pages="pages" class="mt-2 justify-end" />
  </section>
</template>
