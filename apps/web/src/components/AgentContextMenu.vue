<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, Crosshair, Info, SquareTerminal, TriangleAlert } from 'lucide-vue-next'
import { useRevealInWorkspace } from '../composables/useRevealInWorkspace'
import { hasTerminals } from '../lib/desktop'
import { displayTitle } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'

/** Right-click menu of a session (map node or session card); `at` is the cursor, or the node rect from the keyboard. */
const props = defineProps<{ at: DOMRect; terminalId: string; agentId?: string; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const ui = useUiStore()
const connection = useConnectionStore()
const terminals = useTerminalsStore()
const reveal = useRevealInWorkspace()

const WIDTH = 252
const menu = ref<HTMLElement | null>(null)
const height = ref(0)
const confirming = ref(false)

const terminal = computed(() => terminals.byId[props.terminalId])
const title = computed(() => (terminal.value ? displayTitle(terminal.value) : ''))
const ended = computed(() => terminal.value?.status === 'stale')
const pane = computed(() => reveal.paneOf(props.terminalId))
const canReopen = computed(() => !!terminal.value && reveal.canReopen(terminal.value))
const canJump = computed(() => !!terminal.value && !ended.value && !!terminal.value.processId && !pane.value)

// Opens to the right of / below the cursor; flips when that would leave the window.
const style = computed(() => {
  const right = props.at.left + WIDTH > window.innerWidth - 12
  const below = props.at.bottom + height.value <= window.innerHeight - 12
  const left = Math.max(12, right ? props.at.right - WIDTH : props.at.left)
  const top = Math.max(12, below ? props.at.bottom + 2 : props.at.top - height.value - 2)
  return { left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, '--ccm-origin': `${right ? 'right' : 'left'} ${below ? 'top' : 'bottom'}` }
})

const items = (): HTMLElement[] => [...(menu.value?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]

function done(): void {
  emit('close')
}

function showInWorkspace(): void {
  reveal.show(props.terminalId)
  done()
}

async function reopen(force = false): Promise<void> {
  if (!terminal.value) return
  if (!ended.value && !force) {
    confirming.value = true
    await nextTick()
    items()[0]?.focus()
    return
  }
  reveal.reopen(terminal.value)
  done()
}

function focusSession(): void {
  ui.setView('monitor')
  ui.focusTerminal(props.terminalId)
  done()
}

function details(): void {
  if (props.agentId) ui.selectAgent(props.agentId)
  done()
}

function jump(): void {
  if (!connection.focusWindow(props.terminalId)) ui.reportWindowResult(props.terminalId, 'offline')
  done()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    done()
    props.trigger?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && !menu.value?.contains(next)) done()
}

function onOutside(e: PointerEvent): void {
  if (!menu.value?.contains(e.target as Node)) done()
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('blur', done)
  window.addEventListener('resize', done)
  await nextTick()
  height.value = menu.value?.offsetHeight ?? 0
  items()[0]?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('blur', done)
  window.removeEventListener('resize', done)
})

const ITEM =
  'group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none aria-disabled:cursor-default aria-disabled:text-ink-disabled aria-disabled:hover:bg-transparent'
const ICON = 'shrink-0 text-ink-muted group-focus-visible:text-on-accent group-aria-disabled:text-ink-disabled'
</script>

<template>
  <div
    ref="menu"
    class="ccm-menu fixed z-50 flex flex-col p-1"
    :style="style"
    role="menu"
    :aria-label="t('agentMenu.label', { title })"
    data-agent-menu
    @keydown="onKey"
    @focusout="onFocusOut"
    @contextmenu.prevent
  >
    <p class="truncate px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true" :title="title">{{ title }}</p>
    <template v-if="confirming">
      <p class="mx-1 mb-1 flex gap-1.5 rounded-inner bg-warning-soft p-2 text-xs text-ink" role="note">
        <TriangleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />{{ t('workspace.reopen.liveWarning') }}
      </p>
      <button type="button" role="menuitem" :class="ITEM" data-menu="reopen-confirm" @click="reopen(true)">
        <SquareTerminal :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('workspace.reopen.confirm') }}</span>
      </button>
      <button type="button" role="menuitem" :class="ITEM" @click="done">
        <span class="w-3.5 shrink-0" aria-hidden="true" /><span class="truncate">{{ t('workspace.reopen.cancel') }}</span>
      </button>
    </template>
    <template v-else>
      <template v-if="hasTerminals">
        <button v-if="pane" type="button" role="menuitem" :class="ITEM" data-menu="show-in-workspace" @click="showInWorkspace">
          <SquareTerminal :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('workspace.reopen.show') }}</span>
        </button>
        <button v-else-if="canReopen" type="button" role="menuitem" :class="ITEM" data-menu="reopen" @click="reopen()">
          <SquareTerminal :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('workspace.reopen.action') }}</span>
        </button>
        <button v-else type="button" role="menuitem" aria-disabled="true" :class="[ITEM, 'h-auto! py-1.5']" :title="t('agentMenu.noWorkspace')">
          <SquareTerminal :size="14" :class="ICON" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ t('workspace.reopen.action') }}</span>
            <span class="block truncate text-2xs">{{ t('agentMenu.noWorkspace') }}</span>
          </span>
        </button>
      </template>
      <button v-if="canJump" type="button" role="menuitem" :class="ITEM" @click="jump">
        <AppWindow :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('terminal.jumpTitle') }}</span>
      </button>
      <div class="mx-2 my-1 border-t border-line" role="separator" />
      <button type="button" role="menuitem" :class="ITEM" @click="focusSession">
        <Crosshair :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('agentMenu.focus') }}</span>
      </button>
      <button v-if="agentId" type="button" role="menuitem" :class="ITEM" @click="details">
        <Info :size="14" :class="ICON" aria-hidden="true" /><span class="truncate">{{ t('agentMenu.details') }}</span>
      </button>
    </template>
  </div>
</template>
