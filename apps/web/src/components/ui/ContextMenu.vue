<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { isSeparator, menuPosition, submenuPosition, type MenuAction, type MenuEntry, type Rect } from '../../lib/menu'

/** Right-click menu: one level of submenus, keyboard (↑↓ Home End → ← Enter Esc), outside click / scroll / blur / resize close it. */
const props = defineProps<{ at: Rect; entries: MenuEntry[]; label: string; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()

const WIDTH = 252
const SUB_WIDTH = 228
const main = ref<HTMLElement | null>(null)
const sub = ref<HTMLElement | null>(null)
const mainH = ref(0)
const subH = ref(0)
const openId = ref<string | null>(null)
const subRow = ref<Rect | null>(null)

const openEntry = computed(() => props.entries.find((e): e is MenuAction => !isSeparator(e) && e.id === openId.value) ?? null)
const mainStyle = computed(() => {
  const p = menuPosition(props.at, WIDTH, mainH.value, window.innerWidth, window.innerHeight)
  return { left: `${p.left}px`, top: `${p.top}px`, width: `${WIDTH}px`, '--ccm-origin': p.origin, visibility: mainH.value ? ('visible' as const) : ('hidden' as const) }
})
const subStyle = computed(() => {
  if (!subRow.value) return {}
  const p = submenuPosition(subRow.value, SUB_WIDTH, subH.value, window.innerWidth, window.innerHeight)
  return { left: `${p.left}px`, top: `${p.top}px`, width: `${SUB_WIDTH}px`, visibility: subH.value ? ('visible' as const) : ('hidden' as const) }
})

const items = (panel: HTMLElement | null): HTMLElement[] => [...(panel?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])]

async function openSub(e: MenuAction, row: HTMLElement, focus: boolean): Promise<void> {
  if (e.disabled || !e.children) return
  if (openId.value !== e.id) {
    openId.value = e.id
    subRow.value = row.getBoundingClientRect()
    subH.value = 0
    await nextTick()
    subH.value = sub.value?.offsetHeight ?? 0
    // A panel is `visibility: hidden` until measured, and hidden elements refuse focus: wait for that render.
    await nextTick()
  }
  if (focus) items(sub.value)[0]?.focus({ preventScroll: true })
}

function closeSub(refocus: boolean): void {
  const id = openId.value
  openId.value = null
  subRow.value = null
  if (refocus && id) main.value?.querySelector<HTMLElement>(`[data-menu-id="${CSS.escape(id)}"]`)?.focus()
}

function close(): void {
  emit('close')
  props.trigger?.focus()
}

function activate(e: MenuAction, row: HTMLElement, fromKey: boolean): void {
  if (e.disabled) return
  if (e.children) {
    void openSub(e, row, fromKey)
    return
  }
  emit('pick', e.id)
  close()
}

// The pointer moves focus, as in native menus: one highlight (focus) whether keys or the mouse lead.
function hover(e: MenuAction, row: HTMLElement, level: 'main' | 'sub'): void {
  if (!e.disabled) row.focus({ preventScroll: true })
  if (level !== 'main') return
  if (e.children && !e.disabled) void openSub(e, row, false)
  else if (openId.value) closeSub(false)
}

function find(level: 'main' | 'sub', id: string | undefined): MenuAction | null {
  const list = level === 'main' ? props.entries : (openEntry.value?.children ?? [])
  return list.find((e): e is MenuAction => !isSeparator(e) && e.id === id) ?? null
}

function onKey(ev: KeyboardEvent, level: 'main' | 'sub'): void {
  const list = items(level === 'main' ? main.value : sub.value)
  const at = list.indexOf(document.activeElement as HTMLElement)
  const cur = at >= 0 ? list[at]! : null
  switch (ev.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      if (at < 0) list[ev.key === 'ArrowDown' ? 0 : list.length - 1]?.focus()
      else list[(at + (ev.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
      break
    case 'Home':
      list[0]?.focus()
      break
    case 'End':
      list[list.length - 1]?.focus()
      break
    case 'ArrowRight': {
      const e = level === 'main' && cur ? find('main', cur.dataset.menuId) : null
      if (e?.children && cur) void openSub(e, cur, true)
      break
    }
    case 'ArrowLeft':
      if (level === 'sub') closeSub(true)
      break
    case 'Enter':
    case ' ': {
      const e = cur ? find(level, cur.dataset.menuId) : null
      if (e && cur) activate(e, cur, true)
      break
    }
    case 'Escape':
      if (level === 'sub') closeSub(true)
      else close()
      break
    case 'Tab':
      close()
      break
    default:
      return
  }
  ev.preventDefault()
  ev.stopPropagation()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!main.value?.contains(target) && !sub.value?.contains(target)) emit('close')
}

/** Anything scrolling under a fixed menu leaves it pointing at the wrong row; the menu's own scroll does not count. */
function onScrollOutside(e: Event): void {
  const target = e.target
  if (target instanceof Node && (main.value?.contains(target) || sub.value?.contains(target))) return
  emit('close')
}
const onDismiss = (): void => emit('close')

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('scroll', onScrollOutside, true)
  document.addEventListener('wheel', onScrollOutside, { capture: true, passive: true })
  window.addEventListener('blur', onDismiss)
  window.addEventListener('resize', onDismiss)
  await nextTick()
  mainH.value = main.value?.offsetHeight ?? 0
  await nextTick()
  items(main.value)[0]?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('scroll', onScrollOutside, true)
  document.removeEventListener('wheel', onScrollOutside, true)
  window.removeEventListener('blur', onDismiss)
  window.removeEventListener('resize', onDismiss)
})

const panels = computed(() => [
  { level: 'main' as const, entries: props.entries, style: mainStyle.value },
  ...(openEntry.value?.children ? [{ level: 'sub' as const, entries: openEntry.value.children, style: subStyle.value }] : []),
])
const setPanel = (level: 'main' | 'sub', el: unknown): void => {
  if (level === 'main') main.value = el as HTMLElement | null
  else sub.value = el as HTMLElement | null
}
const ITEM =
  'group flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 py-1 text-left text-[13px] text-ink focus:bg-accent focus:text-on-accent focus:outline-none aria-disabled:cursor-default aria-disabled:text-ink-disabled aria-expanded:not-focus:bg-fill'
const ICON = 'shrink-0 text-ink-muted group-focus:text-on-accent group-aria-disabled:text-ink-disabled'
</script>

<template>
  <Teleport to="body">
    <div
      v-for="p in panels"
      :key="p.level"
      :ref="(el) => setPanel(p.level, el)"
      class="ccm-menu ccm-scroll fixed z-50 flex max-h-[calc(100vh-16px)] flex-col overflow-y-auto p-1"
      :style="p.style"
      role="menu"
      :aria-label="p.level === 'main' ? label : openEntry?.label"
      :data-context-menu="p.level === 'main' ? '' : undefined"
      :data-context-submenu="p.level === 'sub' ? '' : undefined"
      @keydown="onKey($event, p.level)"
      @contextmenu.prevent
    >
      <template v-for="(e, i) in p.entries" :key="isSeparator(e) ? `sep-${i}` : e.id">
        <div v-if="isSeparator(e)" class="mx-2 my-1 border-t border-line" role="separator" />
        <button
          v-else
          type="button"
          role="menuitem"
          tabindex="-1"
          :class="ITEM"
          :data-menu-id="e.id"
          :title="e.hint"
          :aria-disabled="e.disabled ? 'true' : undefined"
          :aria-haspopup="e.children ? 'menu' : undefined"
          :aria-expanded="e.children ? openId === e.id : undefined"
          @click="activate(e, $event.currentTarget as HTMLElement, false)"
          @pointerenter="hover(e, $event.currentTarget as HTMLElement, p.level)"
        >
          <component :is="e.icon" v-if="e.icon" :size="14" :class="ICON" aria-hidden="true" />
          <span v-else class="w-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ e.label }}</span>
            <span v-if="e.hint" class="block text-2xs text-ink-faint group-focus:text-on-accent" :class="e.wrapHint ? 'whitespace-normal' : 'truncate'">{{ e.hint }}</span>
          </span>
          <kbd v-if="e.shortcut" class="shrink-0 font-sans text-2xs text-ink-faint group-focus:text-on-accent">{{ e.shortcut }}</kbd>
          <ChevronRight v-if="e.children" :size="13" :class="ICON" aria-hidden="true" />
        </button>
      </template>
    </div>
  </Teleport>
</template>
