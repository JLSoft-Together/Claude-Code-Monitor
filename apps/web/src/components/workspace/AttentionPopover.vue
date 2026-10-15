<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { now } from '../../lib/format'
import type { AttentionEntry, AttentionList } from '../../lib/rail/attentionList'
import { shortAge } from '../../lib/sidebarRows'
import { useWorkspaceStore } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'

const props = defineProps<{ anchor: DOMRect; list: AttentionList; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ close: [refocus: boolean] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const WIDTH = 288
const root = ref<HTMLElement | null>(null)
const active = ref(0)
watch(
  () => props.list.entries.length,
  (n) => {
    if (active.value >= n) active.value = Math.max(0, n - 1)
  },
)

const style = computed(() => {
  const left = Math.max(8, Math.min(props.anchor.right - WIDTH, window.innerWidth - WIDTH - 8))
  const origin = `${Math.round(props.anchor.left + props.anchor.width / 2 - left)}px 0`
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `${WIDTH}px`, '--ccm-origin': origin }
})

const footer = computed(() =>
  (['working', 'done', 'idle', 'ended'] as const)
    .filter((k) => props.list.footer[k])
    .map((k) => t(`workspace.rail.needsList.${k}`, { n: props.list.footer[k] }))
    .join(' · '),
)

function age(e: AttentionEntry): string {
  if (!e.since) return ''
  const a = shortAge(e.since, Math.max(now.value, e.since))
  return a.unit === 'now' ? t('workspace.projects.age.now') : t(`workspace.projects.age.${a.unit}`, { n: a.n })
}

const detail = (e: AttentionEntry): string => [e.run ? t(`run.badge.${e.run}`) : e.agent, e.place, e.branch].filter(Boolean).join(' · ')

function pick(e: AttentionEntry): void {
  workspace.activate(e.paneKey)
  emit('close', false)
}

function onKey(e: KeyboardEvent): void {
  const n = props.list.entries.length
  if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    emit('close', true)
    return
  }
  if (!n) return
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n
  else if (e.key === 'Home') active.value = 0
  else if (e.key === 'End') active.value = n - 1
  else if (e.key === 'Enter' || e.key === ' ') {
    const entry = props.list.entries[active.value]
    if (entry) pick(entry)
  } else return
  e.preventDefault()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) emit('close', false)
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  root.value?.querySelector<HTMLElement>('[role=listbox]')?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div ref="root" class="ccm-menu fixed z-50 flex flex-col p-1" :style="style" data-attention-popover @keydown="onKey">
    <p id="ws-needs-title" class="px-2 pt-1.5 pb-1 text-2xs font-semibold text-ink-faint">{{ t('workspace.rail.needsList.title') }}</p>
    <ul
      v-if="list.entries.length"
      role="listbox"
      tabindex="0"
      aria-labelledby="ws-needs-title"
      :aria-activedescendant="`ws-need-${active}`"
      class="flex max-h-[min(60vh,420px)] flex-col overflow-y-auto outline-none"
    >
      <li
        v-for="(e, i) in list.entries"
        :id="`ws-need-${i}`"
        :key="e.paneKey"
        role="option"
        :aria-selected="i === active"
        class="flex min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 py-1.5"
        :class="i === active ? 'bg-accent text-on-accent' : 'text-ink hover:bg-fill'"
        data-need
        @click="pick(e)"
        @mousemove="active = i"
      >
        <span class="inline-flex shrink-0 rounded-full" :class="i === active ? 'bg-surface' : ''">
          <StatusIcon :status="e.state === 'failed' ? 'error' : 'waiting'" :size="13" :animate="false" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs font-medium">{{ e.first }}</span>
          <span class="block truncate text-2xs" :class="i === active ? 'text-on-accent' : 'text-ink-muted'">
            {{ t(`workspace.rail.state.${e.state}`) }} · {{ detail(e) }}
          </span>
        </span>
        <span class="shrink-0 text-2xs tabular" :class="i === active ? 'text-on-accent' : 'text-ink-faint'">{{ age(e) }}</span>
      </li>
    </ul>
    <p v-else class="px-2 py-2 text-xs text-ink-muted" role="status">{{ t('workspace.rail.needsList.empty') }}</p>
    <p v-if="footer" class="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-2xs text-ink-faint">{{ footer }}</p>
  </div>
</template>
