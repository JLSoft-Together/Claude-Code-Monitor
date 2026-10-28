<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Inbox } from 'lucide-vue-next'
import type { InboxReason } from '../../lib/inbox'
import { duration, now } from '../../lib/format'
import { displayTitle } from '../../lib/title'
import { useInboxStore } from '../../stores/inbox'
import { useTerminalsStore } from '../../stores/terminals'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'

const props = defineProps<{ anchor: DOMRect; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const inbox = useInboxStore()
const terminals = useTerminalsStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const STATUS: Record<InboxReason, string> = { waiting: 'waiting', loop: 'error', checks: 'error', stuck: 'working', done: 'completed' }
const root = ref<HTMLElement | null>(null)
const active = ref(0)

const rows = computed(() =>
  inbox.items.flatMap((i) => {
    const x = terminals.byId[i.id]
    if (!x) return []
    const since = i.since ? (duration(i.since, now.value)?.replace(/\s\d+s$/, '') ?? null) : null
    return [{ item: i, title: displayTitle(x), reason: t(`inbox.reason.${i.reason}`), since }]
  }),
)

const style = computed(() => {
  const w = Math.min(400, window.innerWidth - 24)
  return { left: `${Math.max(12, Math.min(props.anchor.right - w, window.innerWidth - w - 12))}px`, top: `${props.anchor.bottom + 6}px`, width: `${w}px` }
})

function go(id: string): void {
  const pane = workspace.paneByTerminal.get(id)
  if (pane) {
    ui.setView('workspace')
    workspace.activate(pane.key)
  } else {
    ui.setView('monitor')
    ui.focusTerminal(id)
  }
  emit('close')
}

function focusRow(): void {
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-inbox-row="${active.value}"]`)?.focus())
}

function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const n = rows.value.length
  const k = e.key.toLowerCase()
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    props.trigger?.focus()
  } else if ((k === 'j' || e.key === 'ArrowDown' || k === 'k' || e.key === 'ArrowUp') && n) {
    e.preventDefault()
    active.value = (active.value + (k === 'j' || e.key === 'ArrowDown' ? 1 : -1) + n) % n
    focusRow()
  } else if (e.key === 'Enter' && rows.value[active.value]) {
    e.preventDefault()
    go(rows.value[active.value]!.item.id)
  } else if (k === 'e' && rows.value[active.value]) {
    e.preventDefault()
    inbox.dismiss(rows.value[active.value]!.item.id)
    active.value = Math.min(active.value, Math.max(0, rows.value.length - 1))
    focusRow()
  }
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutside, true)
  if (rows.value.length) focusRow()
  else root.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div ref="root" class="ccm-menu fixed z-50 flex max-h-[min(70vh,520px)] flex-col overflow-hidden outline-none" :style="style" role="dialog" tabindex="-1" :aria-label="t('inbox.title')" data-inbox @keydown="onKey">
    <p class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs font-semibold text-ink">
      <Inbox :size="14" class="text-ink-muted" aria-hidden="true" />{{ t('inbox.title') }}
      <span class="ml-auto text-2xs font-normal text-ink-faint">{{ t('inbox.keys') }}</span>
    </p>
    <ul class="ccm-scroll min-h-0 flex-1 overflow-y-auto py-1" role="listbox" :aria-label="t('inbox.title')">
      <li
        v-for="(r, i) in rows"
        :key="r.item.id"
        role="option"
        :aria-selected="i === active"
        :tabindex="i === active ? 0 : -1"
        class="group mx-1 flex min-h-9 cursor-pointer items-center gap-2 rounded-inner px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus"
        :class="i === active ? 'bg-fill' : 'hover:bg-fill'"
        :data-inbox-row="i"
        :data-inbox-reason="r.item.reason"
        @click="go(r.item.id)"
        @focus="active = i"
      >
        <StatusIcon :status="STATUS[r.item.reason]" :size="14" class="shrink-0" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-medium text-ink">{{ r.title }}</span>
          <span class="truncate text-2xs text-ink-muted">{{ r.reason }}<template v-if="r.since"> · {{ r.since }}</template></span>
        </span>
        <button
          type="button"
          class="ccm-btn-plain size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          :title="t('inbox.dismiss')"
          :aria-label="t('inbox.dismiss')"
          tabindex="-1"
          @click.stop="inbox.dismiss(r.item.id)"
        >
          <Check :size="13" aria-hidden="true" />
        </button>
      </li>
      <li v-if="!rows.length" class="px-3 py-4 text-center text-xs text-ink-faint">{{ t('inbox.empty') }}</li>
    </ul>
  </div>
</template>
