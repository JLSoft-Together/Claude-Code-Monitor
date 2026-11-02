<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, FolderOpen, RefreshCw, TriangleAlert, OctagonAlert, X } from 'lucide-vue-next'
import type { DiskDrive, DiskLevel } from '@ccm/shared'
import { hasBuildClean, uniqueDirs } from '../lib/buildClean'
import { hasAgentData } from '../lib/agentData'
import { formatBytes } from '../lib/resources'
import { useDiskStore } from '../stores/disk'
import { useUiStore } from '../stores/ui'
import { isTerm, useWorkspaceStore, workCwd } from '../stores/workspace'

/** Drives popover (v77 R9, v79): opened from the header status popover (`disk.open`), anchored under `anchor`. */
const props = defineProps<{ anchor: HTMLElement | null }>()
const { t, locale } = useI18n()
const disk = useDiskStore()
const ui = useUiStore()
const workspace = useWorkspaceStore()
onMounted(() => disk.start())

// Open project folders go to desktop main so their drives are measured too; only the folder paths cross.
watch(
  () => uniqueDirs(workspace.panes.map((p) => (isTerm(p) ? workCwd(p) : p.cwd))),
  (dirs) => disk.reportProjects(dirs),
  { immediate: true },
)

const pop = ref<HTMLElement | null>(null)
const anchorRect = ref<DOMRect | null>(null)
const refreshing = ref(false)

const gb = (b: number): string => formatBytes(b, locale.value)

const LEVEL_ICON: Record<DiskLevel, typeof CircleCheck> = { ok: CircleCheck, warn: TriangleAlert, danger: OctagonAlert }
const LEVEL_TEXT: Record<DiskLevel, string> = { ok: 'text-success', warn: 'text-warning', danger: 'text-st-error' }
const LEVEL_BAR: Record<DiskLevel, string> = { ok: 'bg-accent', warn: 'bg-warning', danger: 'bg-st-error' }
const usedPct = (d: DiskDrive): number => (d.totalBytes ? Math.min(100, Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100)) : 0)
const measuredAt = computed(() => (disk.state?.at ? new Date(disk.state.at).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' }) : ''))

const WIDTH = 340
const style = computed(() => {
  const a = anchorRect.value
  if (!a) return {}
  const left = Math.max(12, Math.min(a.right - WIDTH, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${a.bottom + 6}px`, width: `${Math.min(WIDTH, window.innerWidth - 24)}px`, '--ccm-origin': 'top right' }
})

watch(
  () => disk.open,
  (open) => {
    if (!open) return
    anchorRect.value = props.anchor?.getBoundingClientRect() ?? null
    void nextTick(() => pop.value?.querySelector<HTMLElement>('button')?.focus())
  },
)

function close(refocus = true): void {
  disk.open = false
  if (refocus) props.anchor?.focus()
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await disk.refresh()
  refreshing.value = false
}

function cleanBuild(): void {
  close(false)
  ui.buildClean = { dir: null }
}

async function agentData(): Promise<void> {
  close(false)
  ui.settingsPage = 'notify'
  ui.settingsOpen = true
  await nextTick()
  document.querySelector('[data-agentdata]')?.scrollIntoView({ block: 'start' })
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (disk.open && !pop.value?.contains(target)) close(false)
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  close()
}

onMounted(() => document.addEventListener('pointerdown', onOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
watch(
  () => disk.worst,
  (w) => {
    if (!w && disk.open) close(false)
  },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="disk.open && anchorRect"
      ref="pop"
      class="ccm-menu ccm-pop fixed z-50 flex max-h-[min(70vh,520px)] flex-col p-0"
      :style="style"
      role="dialog"
      :aria-label="t('disk.title')"
      data-disk-popover
      @keydown="onKey"
    >
      <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1 pl-3">
        <p class="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{{ t('disk.title') }}</p>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('disk.refresh')" :aria-label="t('disk.refresh')" :disabled="refreshing" data-disk-refresh @click="refresh">
          <RefreshCw :size="14" :class="refreshing ? 'ccm-spin' : ''" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('disk.close')" :aria-label="t('disk.close')" @click="close()">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
      <ul class="ccm-scroll min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        <li v-for="d in disk.state?.drives ?? []" :key="d.mount" class="px-3 py-2" :data-disk-drive="d.label" :data-level="d.level">
          <div class="flex min-w-0 items-center gap-2">
            <p class="shrink-0 text-sm font-medium text-ink">{{ d.label }}</p>
            <span class="inline-flex min-w-0 flex-1 items-center gap-1 text-2xs" :class="LEVEL_TEXT[d.level]">
              <component :is="LEVEL_ICON[d.level]" :size="12" class="shrink-0" aria-hidden="true" />
              <span class="truncate">{{ t(`disk.level.${d.level}`) }}</span>
            </span>
            <button type="button" class="ccm-btn-plain shrink-0 text-2xs" :title="t('disk.openFolder')" :aria-label="`${t('disk.openFolder')} ${d.label}`" @click="disk.openFolder(d.mount)">
              <FolderOpen :size="13" aria-hidden="true" />
            </button>
          </div>
          <div
            class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill"
            role="meter"
            :aria-label="d.label"
            :aria-valuenow="usedPct(d)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="h-full rounded-full" :class="LEVEL_BAR[d.level]" :style="{ width: `${usedPct(d)}%` }" />
          </div>
          <p class="mt-1 text-2xs text-ink-muted tabular-nums" data-disk-free>{{ t('disk.free', { free: gb(d.freeBytes), total: gb(d.totalBytes) }) }}</p>
          <p class="mt-0.5 truncate text-2xs text-ink-faint">{{ d.places.map((p) => t(`disk.places.${p}`)).join(', ') }}</p>
        </li>
      </ul>
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-line p-2">
        <button v-if="hasBuildClean" type="button" class="ccm-btn" data-disk-clean @click="cleanBuild">{{ t('disk.cleanBuild') }}</button>
        <button v-if="hasAgentData" type="button" class="ccm-btn" data-disk-agentdata @click="agentData">{{ t('disk.agentData') }}</button>
        <span v-if="measuredAt" class="ml-auto text-2xs text-ink-faint">{{ t('disk.measured', { time: measuredAt }) }}</span>
      </div>
    </div>
  </Teleport>
</template>
