<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutTemplate, Pencil, RefreshCw, Star, Trash2, X } from 'lucide-vue-next'
import { layoutCounts } from '../../lib/layouts'
import { retireOverlay } from '../../lib/motion'
import { deleteLayout, listLayouts, saveLayout, setStartLayout, type LayoutDraft, type SavedLayout } from '../../lib/projects'
import ToggleSwitch from '../ToggleSwitch.vue'

/** `capture` snapshots the project's open tabs (no output, no prompts); null when none belong to it. */
const props = defineProps<{
  open: boolean
  root: string
  name: string
  mode: 'save' | 'manage'
  capture: (opts: { name: string; resume: boolean; id?: string; openOnStart?: boolean }) => LayoutDraft | null
}>()
const emit = defineEmits<{ close: []; open: [layout: SavedLayout] }>()

const { t } = useI18n()
const layouts = ref<SavedLayout[]>([])
const newName = ref('')
const resume = ref(false)
const notice = ref<{ text: string; error?: boolean } | null>(null)
const renaming = ref<string | null>(null)
const renameText = ref('')
const deleting = ref<string | null>(null)
const busy = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)
const sheet = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const canSave = computed(() => !!props.capture({ name: 'x', resume: false }))

async function refresh(): Promise<void> {
  layouts.value = await listLayouts(props.root)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    notice.value = null
    renaming.value = null
    deleting.value = null
    newName.value = ''
    resume.value = false
    await refresh()
    await nextTick()
    if (props.mode === 'save' && nameInput.value) nameInput.value.focus()
    else sheet.value?.querySelector<HTMLElement>('[data-layout-row] button')?.focus()
  },
  { immediate: true },
)

function fail(error: string): void {
  notice.value = { text: t(`workspace.layouts.error.${error}`), error: true }
}

async function save(): Promise<void> {
  const name = newName.value.trim()
  if (!name || busy.value) return
  const draft = props.capture({ name, resume: resume.value })
  if (!draft) return void (notice.value = { text: t('workspace.layouts.nothingToSave'), error: true })
  busy.value = true
  const res = await saveLayout(draft)
  busy.value = false
  if (!res.ok) return fail(res.error)
  newName.value = ''
  notice.value = { text: t('workspace.layouts.saved', { name: res.layout.name }) }
  await refresh()
}

/** Same id + current tabs; keeps the name, the resume choice and the start flag. */
async function overwrite(l: SavedLayout): Promise<void> {
  const keepsResume = Object.values(l.panes).some((p) => p.resume)
  const draft = props.capture({ name: l.name, resume: keepsResume, id: l.id, openOnStart: l.openOnStart })
  if (!draft) return void (notice.value = { text: t('workspace.layouts.nothingToSave'), error: true })
  const res = await saveLayout(draft)
  if (!res.ok) return fail(res.error)
  notice.value = { text: t('workspace.layouts.overwritten', { name: l.name }) }
  await refresh()
}

async function startRename(l: SavedLayout): Promise<void> {
  renaming.value = l.id
  renameText.value = l.name
  deleting.value = null
  await nextTick()
  sheet.value?.querySelector<HTMLInputElement>('[data-rename]')?.select()
}

async function rename(l: SavedLayout): Promise<void> {
  const name = renameText.value.trim()
  if (!name) return
  const res = await saveLayout({ ...l, name })
  renaming.value = null
  if (!res.ok) return fail(res.error)
  await refresh()
}

async function remove(l: SavedLayout): Promise<void> {
  deleting.value = null
  await deleteLayout(props.root, l.id)
  await refresh()
  await nextTick()
  sheet.value?.querySelector<HTMLElement>('[data-layout-row] button, input')?.focus()
}

async function toggleStart(l: SavedLayout): Promise<void> {
  await setStartLayout(props.root, l.openOnStart ? null : l.id)
  await refresh()
}

function openLayout(l: SavedLayout): void {
  emit('open', l)
  emit('close')
}

function trap(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !sheet.value) return
  const items = [...sheet.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')].filter((n) => n.offsetParent)
  const at = items.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
}

function summary(l: SavedLayout): string {
  const c = layoutCounts(l)
  const parts = [t('workspace.layouts.summary', { n: c.tabs }, c.tabs)]
  if (c.agents) parts.push(t('workspace.layouts.agents', { n: c.agents }, c.agents))
  return parts.join(' · ')
}

const ICON_BTN =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint hover:bg-fill-strong hover:text-ink aria-pressed:text-favorite'
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="emit('close')">
        <div
          ref="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ws-layouts-title"
          class="ccm-sheet flex max-h-[min(80vh,640px)] w-full max-w-[520px] flex-col overflow-hidden"
          data-layouts-dialog
          @keydown.esc.stop="emit('close')"
          @keydown="trap"
        >
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <LayoutTemplate :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 id="ws-layouts-title" class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="root">{{ t('workspace.layouts.dialogTitle', { name }) }}</h2>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.layouts.close')" :aria-label="t('workspace.layouts.close')" @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </header>

          <form class="flex flex-col gap-2 border-b border-line px-4 py-3" @submit.prevent="save">
            <p class="text-xs text-ink-muted">{{ canSave ? t('workspace.layouts.saveTitle') : t('workspace.layouts.nothingToSave') }}</p>
            <label class="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              {{ t('workspace.layouts.name') }}
              <input
                ref="nameInput"
                v-model="newName"
                type="text"
                maxlength="80"
                class="ccm-field h-8 text-sm"
                :placeholder="t('workspace.layouts.namePlaceholder')"
                :disabled="!canSave"
                data-layout-name
              />
            </label>
            <ToggleSwitch v-model="resume" :label="t('workspace.layouts.resume')" :hint="t('workspace.layouts.resumeHint')" :disabled="!canSave" />
            <div class="flex justify-end">
              <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!canSave || !newName.trim() || busy" data-layout-save>{{ t('workspace.layouts.saveAction') }}</button>
            </div>
          </form>

          <p v-if="notice" class="px-4 pt-2 text-xs" :class="notice.error ? 'text-st-error' : 'text-success'" role="status">{{ notice.text }}</p>

          <ul class="ccm-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" :aria-label="t('workspace.layouts.section')">
            <li v-if="!layouts.length" class="px-2 py-4 text-center text-xs text-ink-faint">{{ t('workspace.layouts.empty') }}</li>
            <li v-for="l in layouts" :key="l.id" class="flex min-w-0 flex-col rounded-inner px-2 py-1.5 hover:bg-fill" data-layout-row :data-layout="l.name">
              <div v-if="renaming === l.id" class="flex items-center gap-2">
                <input v-model="renameText" data-rename type="text" maxlength="80" class="ccm-field h-7 min-w-0 flex-1 text-sm" :aria-label="t('workspace.layouts.name')" @keydown.enter.prevent="rename(l)" @keydown.esc.stop.prevent="renaming = null" />
                <button type="button" class="ccm-btn shrink-0" @click="rename(l)">{{ t('workspace.layouts.renameAction') }}</button>
                <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.layouts.cancel')" :title="t('workspace.layouts.cancel')" @click="renaming = null"><X :size="13" aria-hidden="true" /></button>
              </div>
              <div v-else-if="deleting === l.id" class="flex items-center gap-2" role="alert">
                <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ t('workspace.layouts.deleteConfirm', { name: l.name }) }}</span>
                <button type="button" class="ccm-btn shrink-0" @click="deleting = null">{{ t('workspace.layouts.cancel') }}</button>
                <button type="button" class="ccm-btn ccm-btn-danger shrink-0" data-layout-delete-yes @click="remove(l)">{{ t('workspace.layouts.delete') }}</button>
              </div>
              <div v-else class="flex min-w-0 items-center gap-1">
                <button type="button" class="flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-inner px-1 py-0.5 text-left" data-layout-open @click="openLayout(l)">
                  <span class="w-full truncate text-sm font-medium text-ink">{{ l.name }}</span>
                  <span class="w-full truncate text-2xs text-ink-faint tabular">{{ summary(l) }}</span>
                </button>
                <button
                  type="button"
                  :class="ICON_BTN"
                  :aria-pressed="!!l.openOnStart"
                  :title="`${t('workspace.layouts.onStart')} — ${t('workspace.layouts.onStartHint')}`"
                  :aria-label="t('workspace.layouts.onStart')"
                  data-layout-start
                  @click="toggleStart(l)"
                >
                  <Star :size="14" :fill="l.openOnStart ? 'currentColor' : 'none'" aria-hidden="true" />
                </button>
                <button type="button" :class="ICON_BTN" :title="t('workspace.layouts.rename')" :aria-label="`${t('workspace.layouts.rename')}: ${l.name}`" @click="startRename(l)">
                  <Pencil :size="13" aria-hidden="true" />
                </button>
                <button type="button" :class="ICON_BTN" :disabled="!canSave" :title="t('workspace.layouts.overwrite')" :aria-label="`${t('workspace.layouts.overwrite')}: ${l.name}`" data-layout-overwrite @click="overwrite(l)">
                  <RefreshCw :size="13" aria-hidden="true" />
                </button>
                <button type="button" :class="ICON_BTN" class="hover:text-st-error" :title="t('workspace.layouts.delete')" :aria-label="`${t('workspace.layouts.delete')}: ${l.name}`" data-layout-delete @click="(deleting = l.id), (renaming = null)">
                  <Trash2 :size="13" aria-hidden="true" />
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
