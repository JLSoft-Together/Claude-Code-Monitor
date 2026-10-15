<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronUp, Copy, GitCompare, Undo2, X } from 'lucide-vue-next'
import { renderLine } from '../../lib/codeView'
import { isMac } from '../../lib/platform'
import { keyCombo } from '../../lib/shortcuts'
import { wordDiff, type Block } from '../../lib/diffBlocks'

/** IntelliJ's change-marker popup: the old text of one change, Prev / Next, Rollback, Show diff, Copy. */
const props = defineProps<{
  block: Block
  index: number
  total: number
  /** Rows the change starts and ends on: the popup sits under the last (above the first when there is no room). */
  anchor: HTMLElement
  anchorTop?: HTMLElement | null
  /** Null = rollback offered; a string = why it is not (tooltip on the disabled button). */
  rollbackBlocked: string | null
}>()
const emit = defineEmits<{ close: []; step: [dir: 1 | -1]; rollback: []; showDiff: [] }>()

const { t } = useI18n()
const prevKey = keyCombo(['Shift', 'F7'], isMac)
const el = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0, width: 480 })
const copied = ref(false)

const oldHtml = computed(() => {
  const dels = props.block.dels.map((l) => l.text)
  const marks = props.block.type === 'modified' ? wordDiff(dels, props.block.adds.map((l) => l.text)) : null
  return dels.map((text, i) => `<div class="ol">${renderLine([{ content: text }], marks?.old[i]?.map((m) => ({ ...m, cls: 'w-del' })))}\n</div>`).join('')
})

function place(): void {
  const box = el.value
  if (!box || !props.anchor.isConnected) return
  const r = props.anchor.getBoundingClientRect()
  const width = Math.min(560, Math.max(260, window.innerWidth - r.left - 16))
  const left = Math.max(8, Math.min(r.left + 8, window.innerWidth - width - 8))
  const h = box.offsetHeight
  const below = r.bottom + 2
  const above = (props.anchorTop?.isConnected ? props.anchorTop : props.anchor).getBoundingClientRect().top - h - 2
  const top = below + h > window.innerHeight - 8 && above > 8 ? above : below
  pos.value = { top, left, width }
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.block.dels.map((l) => l.text).join('\n'))
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard denied
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'F7' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    e.stopPropagation()
    emit('step', e.shiftKey ? -1 : 1)
  }
}

function onPointerDown(e: PointerEvent): void {
  const target = e.target as Node
  if (el.value?.contains(target)) return
  // The marker that opened it handles its own click (toggle / another change).
  if ((target as HTMLElement).closest?.('[data-gutter]')) return
  emit('close')
}

const reposition = (): void => void requestAnimationFrame(place)

watch(
  () => [props.anchor, props.block] as const,
  () => void nextTick(place),
)

onMounted(async () => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
  await nextTick()
  place()
  el.value?.querySelector<HTMLElement>('[data-hunk-focus]')?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
})

const BTN = 'ccm-btn-plain shrink-0'
</script>

<template>
  <Teleport to="body">
    <div
      ref="el"
      class="ccm-menu fixed z-50 flex flex-col overflow-hidden p-0"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px`, '--ccm-origin': 'top left' }"
      role="dialog"
      :aria-label="t('workspace.gutter.popup', { n: index + 1, total })"
      data-hunk-popup
      @keydown="onKey"
    >
      <div class="flex h-8 min-w-0 shrink-0 items-center gap-0.5 border-b border-line px-1.5" role="toolbar" :aria-label="t('workspace.gutter.popup', { n: index + 1, total })">
        <span class="mr-1 inline-flex size-2 shrink-0 rounded-full" :class="`dot-${block.type}`" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          {{ t(`workspace.gutter.kind.${block.type}`) }} · <span class="tabular text-ink-muted">{{ t('workspace.gutter.popup', { n: index + 1, total }) }}</span>
        </span>
        <button type="button" :class="BTN" :disabled="total < 2" :title="t('workspace.gutter.prev', { key: prevKey })" :aria-label="t('workspace.gutter.prev', { key: prevKey })" @click="emit('step', -1)">
          <ChevronUp :size="14" aria-hidden="true" />
        </button>
        <button type="button" :class="BTN" :disabled="total < 2" :title="t('workspace.gutter.next')" :aria-label="t('workspace.gutter.next')" data-hunk-focus @click="emit('step', 1)">
          <ChevronDown :size="14" aria-hidden="true" />
        </button>
        <span class="mx-0.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
        <button
          type="button"
          :class="[BTN, 'gap-1 text-2xs hover:text-st-error']"
          :aria-disabled="rollbackBlocked ? 'true' : undefined"
          :title="rollbackBlocked ?? t('workspace.gutter.rollback')"
          data-hunk-rollback
          @click="!rollbackBlocked && emit('rollback')"
        >
          <Undo2 :size="13" aria-hidden="true" />
          {{ t('workspace.gutter.rollback') }}
        </button>
        <button type="button" :class="[BTN, 'gap-1 text-2xs']" :title="t('workspace.gutter.showDiff')" data-hunk-diff @click="emit('showDiff')">
          <GitCompare :size="13" aria-hidden="true" />
          {{ t('workspace.gutter.showDiff') }}
        </button>
        <button v-if="block.dels.length" type="button" :class="BTN" :title="copied ? t('workspace.gutter.copied') : t('workspace.gutter.copy')" :aria-label="t('workspace.gutter.copy')" @click="copy">
          <Check v-if="copied" :size="14" class="text-success" aria-hidden="true" />
          <Copy v-else :size="14" aria-hidden="true" />
        </button>
        <button type="button" :class="BTN" :title="t('workspace.gutter.close')" :aria-label="t('workspace.gutter.close')" @click="emit('close')">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <div v-if="block.dels.length" class="old ccm-scroll max-h-64 overflow-auto bg-well py-1.5">
        <p class="sr-only">{{ t('workspace.gutter.before') }}</p>
        <div class="w-max min-w-full" data-code-zoom v-html="oldHtml" />
      </div>
      <p v-else class="px-3 py-2 text-xs text-ink-muted">{{ t('workspace.gutter.added', { n: block.adds.length }, block.adds.length) }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.old {
  color: var(--ccm-well-ink);
  font-family: var(--font-mono);
  font-size: calc(var(--ccm-code-size, 13px) - 0.5px);
  font-variant-ligatures: none;
  line-height: 1.5;
  tab-size: 4;
}
.old :deep(.ol) {
  padding-inline: 0.75em;
  white-space: pre;
  background: color-mix(in srgb, var(--ccm-diff-del-well) 12%, transparent);
}
.old :deep(mark.w-del) {
  color: inherit;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ccm-diff-del-well) 38%, transparent);
}
.dot-added {
  background: var(--ccm-diff-add);
}
.dot-modified {
  background: var(--ccm-diff-mod);
}
.dot-deleted {
  background: var(--ccm-diff-del);
}
</style>
