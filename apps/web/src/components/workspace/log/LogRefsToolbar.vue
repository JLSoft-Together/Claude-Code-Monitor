<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, Check, ChevronsDownUp, ChevronsUpDown, Columns2, Crosshair, EllipsisVertical, LoaderCircle, PanelLeft, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-vue-next'
import type { RefRow } from '../../../lib/gitRefs'

const props = defineProps<{ open: boolean; selected: RefRow | null; busy: 'fetch' | 'update' | 'delete' | null; view: { group: boolean; tags: boolean }; canWrite: boolean }>()
const emit = defineEmits<{
  toggle: []
  newBranch: []
  update: []
  remove: []
  compare: []
  search: []
  fetch: []
  favorite: []
  navigate: []
  view: [v: { group: boolean; tags: boolean }]
  expandAll: []
  collapseAll: []
}>()
const { t } = useI18n()

const target = computed(() => (props.selected?.kind === 'ref' ? props.selected : null))
const isLocal = computed(() => target.value?.refKind === 'local')
// `<remote>/HEAD` is a symref (already dropped by listRefs); never offer delete / compare on it.
const isBranch = computed(() => target.value?.refKind === 'local' || (target.value?.refKind === 'remote' && !target.value.ref.endsWith('/HEAD')))
/** More (⋮) popover, fixed next to the button (teleported out of the pane's overflow). */
const more = ref<{ left: number; top: number } | null>(null)
const moreBtn = ref<HTMLButtonElement | null>(null)
const moreEl = ref<HTMLElement | null>(null)
const bar = ref<HTMLElement | null>(null)

const B =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-muted outline-none hover:bg-fill hover:text-ink focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:text-accent-ink'
const ROW = 'flex h-7 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-xs text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'
const L = (k: string): string => t(`workspace.log.branches.${k}`)

function onOutside(e: PointerEvent): void {
  const node = e.target as Node
  if (!moreEl.value?.contains(node) && !moreBtn.value?.contains(node)) closeMore(false)
}
async function toggleMore(): Promise<void> {
  if (more.value) return closeMore(true)
  const r = moreBtn.value!.getBoundingClientRect()
  more.value = { left: Math.min(r.right + 4, window.innerWidth - 220), top: Math.min(r.top, window.innerHeight - 90) }
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  moreEl.value?.querySelector<HTMLElement>('[role=menuitemcheckbox]')?.focus()
}
function closeMore(refocus: boolean): void {
  more.value = null
  document.removeEventListener('pointerdown', onOutside, true)
  if (refocus) moreBtn.value?.focus()
}
function onMoreKey(e: KeyboardEvent): void {
  const items = [...(moreEl.value?.querySelectorAll<HTMLElement>('[role=menuitemcheckbox]') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape' || e.key === 'Tab') closeMore(true)
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  else return
  e.preventDefault()
  e.stopPropagation()
}

/** Vertical toolbar: ↑ / ↓ move between enabled buttons. */
function onBarKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = [...(bar.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLButtonElement)
  if (at < 0) return
  e.preventDefault()
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div ref="bar" class="flex w-8 shrink-0 flex-col items-center gap-0.5 border-r border-line py-1" role="toolbar" aria-orientation="vertical" :aria-label="L('toolbar')" data-refs-toolbar @keydown="onBarKey">
    <button type="button" :class="B" :aria-pressed="open" :title="t(open ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" :aria-label="t(open ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" data-refs-action="toggle" @click="emit('toggle')">
      <PanelLeft :size="15" aria-hidden="true" />
    </button>
    <template v-if="open">
      <span class="my-0.5 h-px w-4 bg-line" aria-hidden="true" />
      <button type="button" :class="B" :disabled="!canWrite || !!busy" :title="L('new')" :aria-label="L('new')" data-refs-action="newBranch" @click="emit('newBranch')"><Plus :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!canWrite || !isLocal || !!busy" :title="L('update')" :aria-label="L('update')" :aria-busy="busy === 'update'" data-refs-action="update" @click="emit('update')">
        <LoaderCircle v-if="busy === 'update'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <ArrowDownToLine v-else :size="15" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!canWrite || !isBranch || !!target?.current || !!busy" :title="L('delete')" :aria-label="L('delete')" :aria-busy="busy === 'delete'" data-refs-action="remove" @click="emit('remove')">
        <LoaderCircle v-if="busy === 'delete'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <Trash2 v-else :size="15" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!isBranch || !!target?.current" :title="L('compare')" :aria-label="L('compare')" data-refs-action="compare" @click="emit('compare')"><Columns2 :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('search')" :aria-label="L('search')" data-refs-action="search" @click="emit('search')"><Search :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!canWrite || !!busy" :title="L('fetch')" :aria-label="L('fetch')" :aria-busy="busy === 'fetch'" data-refs-action="fetch" @click="emit('fetch')">
        <LoaderCircle v-if="busy === 'fetch'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <RefreshCw v-else :size="15" class="text-accent-ink" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="B"
        :disabled="!isBranch"
        :aria-pressed="!!target?.favorite"
        :title="L(target?.favorite ? 'unfavorite' : 'favorite')"
        :aria-label="L(target?.favorite ? 'unfavorite' : 'favorite')"
        data-refs-action="favorite"
        @click="emit('favorite')"
      >
        <Star :size="15" :class="target?.favorite ? 'fill-current text-favorite' : ''" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!target" :title="L('navigate')" :aria-label="L('navigate')" data-refs-action="navigate" @click="emit('navigate')"><Crosshair :size="15" aria-hidden="true" /></button>
      <button ref="moreBtn" type="button" :class="B" :title="L('more')" :aria-label="L('more')" aria-haspopup="menu" :aria-expanded="!!more" data-refs-action="more" @click="toggleMore">
        <EllipsisVertical :size="15" aria-hidden="true" />
      </button>
      <span class="my-0.5 h-px w-4 bg-line" aria-hidden="true" />
      <button type="button" :class="B" :title="L('expandAll')" :aria-label="L('expandAll')" data-refs-action="expandAll" @click="emit('expandAll')"><ChevronsUpDown :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('collapseAll')" :aria-label="L('collapseAll')" data-refs-action="collapseAll" @click="emit('collapseAll')"><ChevronsDownUp :size="15" aria-hidden="true" /></button>
    </template>
    <Teleport to="body">
      <Transition name="ccm-menu">
        <div
          v-if="more"
          ref="moreEl"
          class="ccm-menu fixed z-50 flex w-52 flex-col p-1"
          style="--ccm-origin: left top"
          :style="{ left: `${more.left}px`, top: `${more.top}px` }"
          role="menu"
          :aria-label="L('more')"
          data-refs-more
          @keydown="onMoreKey"
        >
          <button type="button" role="menuitemcheckbox" :aria-checked="view.group" :class="ROW" data-refs-view="group" @click="emit('view', { ...view, group: !view.group })">
            <Check :size="13" class="shrink-0" :class="view.group ? '' : 'invisible'" aria-hidden="true" />{{ L('groupByFolder') }}
          </button>
          <button type="button" role="menuitemcheckbox" :aria-checked="view.tags" :class="ROW" data-refs-view="tags" @click="emit('view', { ...view, tags: !view.tags })">
            <Check :size="13" class="shrink-0" :class="view.tags ? '' : 'invisible'" aria-hidden="true" />{{ L('showTags') }}
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
