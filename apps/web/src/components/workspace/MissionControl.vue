<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing } from 'lucide-vue-next'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { useRail } from '../../composables/useRail'
import { motionMs } from '../../lib/motion'
import { snapshotOf } from '../../lib/paneSnapshots'
import { flipTransform, missionShelf, type MissionSpace, type MissionWindow } from '../../lib/rail/mission'
import type { RailState } from '../../lib/rail/railModel'
import { folderName, shellTitle } from '../../lib/sidebarRows'
import { isTerm, tabProject, useWorkspaceStore, type Pane } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'
import PaneIcon from './PaneIcon.vue'

const props = defineProps<{ open: boolean; paneRect: (key: string) => DOMRect | null }>()
const emit = defineEmits<{ close: [focusOpener: boolean] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const { clusters } = useRail()
const { labelOf, sessionOf } = usePaneInfo()

const ROWS = 14
const paneOf = (k: string): Pane | undefined => workspace.panes.find((p) => p.key === k)

function titleOf(key: string): string {
  const pane = paneOf(key)
  if (!pane) return ''
  if (isTerm(pane) && pane.preset === 'shell' && !sessionOf(pane)) return shellTitle(pane) ?? labelOf(pane)
  return labelOf(pane)
}

const shelf = computed(() =>
  missionShelf(
    clusters.value,
    workspace.tabs,
    workspace.activeTab?.key ?? null,
    (tab) => {
      const p = tabProject(tab, paneOf)
      return p ? folderName(p) : t('workspace.side.home')
    },
    titleOf,
    paneOf,
  ),
)
const spaces = computed(() => shelf.value.flatMap((g) => g.spaces))

/** Space whose windows the spread shows: hover / focus on the shelf previews, default the current one. */
const previewKey = ref<string | null>(null)
const previewed = computed<MissionSpace | null>(() => spaces.value.find((s) => s.tabKey === previewKey.value) ?? spaces.value.find((s) => s.current) ?? spaces.value[0] ?? null)

// Taken once per previewed space, never live: the text stays in this component's memory only.
const snaps = ref<Record<string, string>>({})
watch(
  () => [props.open, previewed.value?.tabKey] as const,
  ([open]) => {
    if (!open || !previewed.value) return
    const next: Record<string, string> = {}
    for (const w of previewed.value.windows) next[w.paneKey] = snapshotOf(w.paneKey, ROWS)
    snaps.value = next
  },
  { immediate: true },
)

const BADGE: Partial<Record<RailState, string>> = { failed: 'error', asked: 'waiting', working: 'working', done: 'completed', ended: 'completed' }
const word = (w: MissionWindow): string => (w.run ? t(`run.badge.${w.run}`) : w.state ? t(`workspace.rail.state.${w.state}`) : '')

const root = ref<HTMLElement | null>(null)
const spread = ref<HTMLElement | null>(null)
let choosing = false

const windowEls = (): HTMLElement[] => [...(spread.value?.querySelectorAll<HTMLElement>('[data-mission-window]') ?? [])]
const spaceEls = (): HTMLElement[] => [...(root.value?.querySelectorAll<HTMLElement>('[data-mission-space]') ?? [])]

function columns(): number {
  const tpl = spread.value ? getComputedStyle(spread.value).gridTemplateColumns : ''
  return Math.max(1, tpl.split(' ').filter(Boolean).length)
}

async function onOpen(): Promise<void> {
  previewKey.value = null
  choosing = false
  await nextTick()
  const els = windowEls()
  const start = els.find((el) => el.dataset.missionWindow === workspace.activeKey) ?? els[0] ?? spaceEls()[0]
  start?.focus({ preventScroll: true })
  const ms = motionMs(300)
  if (!ms) return
  for (const el of els) {
    const from = props.paneRect(el.dataset.missionWindow!)
    if (!from) continue
    el.animate([{ transform: flipTransform(el.getBoundingClientRect(), from) }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' })
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void onOpen()
  },
  { immediate: true },
)

// Something outside switched tabs, closed the last one or asked to close panes: leave without animation.
watch(
  () => [workspace.activeTab?.key, workspace.tabs.length, !!workspace.pendingClose] as const,
  ([, n, pending]) => {
    if (props.open && !choosing && (!n || pending)) emit('close', false)
  },
)
watch(
  () => workspace.activeTab?.key,
  () => {
    if (props.open && !choosing) emit('close', false)
  },
)

function enterSpace(s: MissionSpace): void {
  choosing = true
  workspace.activateTab(s.tabKey)
  emit('close', false)
}

async function choose(w: MissionWindow, el: HTMLElement): Promise<void> {
  if (choosing) return
  choosing = true
  workspace.activate(w.paneKey)
  await nextTick()
  const ms = motionMs(260)
  const to = props.paneRect(w.paneKey)
  if (ms && to) {
    for (const other of windowEls()) if (other !== el) other.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.6, fill: 'forwards' })
    const anim = el.animate([{ transform: 'none' }, { transform: flipTransform(el.getBoundingClientRect(), to) }], { duration: ms, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' })
    await anim.finished.catch(() => undefined)
  }
  emit('close', false)
}

function trap(e: KeyboardEvent): void {
  const items = [...(root.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close', true)
    return
  }
  if (e.key === 'Tab') return trap(e)
  const el = document.activeElement as HTMLElement | null
  if (!el) return
  const wins = windowEls()
  const sp = spaceEls()
  const wi = wins.indexOf(el)
  const si = sp.indexOf(el)
  let next: HTMLElement | undefined
  if (wi >= 0) {
    const cols = columns()
    if (e.key === 'ArrowRight') next = wins[Math.min(wins.length - 1, wi + 1)]
    else if (e.key === 'ArrowLeft') next = wins[Math.max(0, wi - 1)]
    else if (e.key === 'ArrowDown') next = wins[wi + cols]
    else if (e.key === 'ArrowUp') next = wi - cols >= 0 ? wins[wi - cols] : (sp.find((s) => s.dataset.missionSpace === previewed.value?.tabKey) ?? sp[0])
    else if (e.key === 'Home') next = wins[0]
    else if (e.key === 'End') next = wins.at(-1)
    else return
  } else if (si >= 0) {
    if (e.key === 'ArrowRight') next = sp[Math.min(sp.length - 1, si + 1)]
    else if (e.key === 'ArrowLeft') next = sp[Math.max(0, si - 1)]
    else if (e.key === 'ArrowDown') next = wins[0]
    else if (e.key === 'Home') next = sp[0]
    else if (e.key === 'End') next = sp.at(-1)
    else return
  } else return
  e.preventDefault()
  next?.focus()
}

function boxStyle(w: MissionWindow): Record<string, string> {
  return { left: `${w.box.x * 100}%`, top: `${w.box.y * 100}%`, width: `${w.box.w * 100}%`, height: `${w.box.h * 100}%` }
}
const TINT: Partial<Record<RailState, string>> = { failed: 'border-st-error', asked: 'border-st-waiting', working: 'border-st-working' }
</script>

<template>
  <div
    v-if="open"
    ref="root"
    class="absolute inset-0 z-30 grid grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden rounded-card bg-canvas"
    role="dialog"
    aria-modal="true"
    :aria-label="t('workspace.rail.mission.title')"
    data-mission
    @keydown="onKey"
  >
    <div class="ccm-material flex flex-wrap items-start gap-x-5 gap-y-2 rounded-card p-2" role="group" :aria-label="t('workspace.rail.mission.shelf')">
      <div v-for="g in shelf" :key="g.key" class="flex min-w-0 flex-col gap-1" role="group" :aria-labelledby="`mc-${g.key}`">
        <h3 :id="`mc-${g.key}`" class="max-w-[28ch] truncate px-0.5 text-2xs font-semibold text-ink-muted" :title="g.name">{{ g.key === 'home' ? t('workspace.side.home') : g.name }}</h3>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="s in g.spaces"
            :key="s.tabKey"
            type="button"
            class="flex w-24 cursor-pointer flex-col gap-1 rounded-inner p-1 text-left outline-offset-1 transition-colors duration-(--ccm-dur-fast) hover:bg-fill"
            :class="s.tabKey === previewed?.tabKey ? 'bg-fill' : ''"
            :aria-current="s.current ? 'true' : undefined"
            :aria-label="[s.label, t('workspace.rail.mission.panes', { n: s.windows.length }, s.windows.length), s.needs ? t('workspace.rail.needs', { n: s.needs }, s.needs) : ''].filter(Boolean).join(', ')"
            :data-mission-space="s.tabKey"
            @mouseenter="previewKey = s.tabKey"
            @focus="previewKey = s.tabKey"
            @click="enterSpace(s)"
          >
            <span class="relative block h-12 w-full rounded-[5px] bg-fill-strong" :class="s.current ? 'ring-2 ring-focus' : ''" aria-hidden="true">
              <span
                v-for="w in s.windows"
                :key="w.paneKey"
                class="absolute rounded-[3px] border bg-surface"
                :class="(w.state && TINT[w.state]) || 'border-line'"
                :style="boxStyle(w)"
              />
            </span>
            <span class="flex min-w-0 items-center gap-1 text-2xs">
              <span class="min-w-0 flex-1 truncate" :class="s.current ? 'font-semibold text-ink' : 'text-ink-muted'">{{ s.label }}</span>
              <span v-if="s.needs" class="inline-flex shrink-0 items-center gap-0.5 tabular" :class="s.failed ? 'text-st-error' : 'text-st-waiting'" aria-hidden="true">
                <BellRing :size="10" />{{ s.needs }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <div class="ccm-scroll min-h-0 overflow-y-auto px-1 pb-1">
      <div
        ref="spread"
        class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
        role="group"
        :aria-label="t('workspace.rail.mission.windows', { name: previewed?.label ?? '' })"
      >
        <button
          v-for="w in previewed?.windows ?? []"
          :key="w.paneKey"
          type="button"
          class="flex min-w-0 origin-top-left cursor-pointer flex-col overflow-hidden rounded-card border-t-2 bg-surface text-left shadow-card outline-offset-2"
          :class="w.state === 'failed' ? 'border-st-error' : w.state === 'asked' ? 'border-st-waiting' : 'border-transparent'"
          :aria-label="t('workspace.rail.mission.enter', { name: [w.title, word(w)].filter(Boolean).join(', ') })"
          :data-mission-window="w.paneKey"
          @click="choose(w, $event.currentTarget as HTMLElement)"
        >
          <span class="flex h-8 min-w-0 items-center gap-1.5 px-2.5">
            <PaneIcon v-if="paneOf(w.paneKey)" :pane="paneOf(w.paneKey)!" :size="14" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">{{ w.title }}</span>
            <span v-if="w.state && w.state !== 'idle'" class="inline-flex shrink-0 items-center gap-1 text-2xs text-ink-muted">
              <StatusIcon v-if="BADGE[w.state]" :status="BADGE[w.state]!" :size="11" />{{ word(w) }}
            </span>
          </span>
          <pre
            class="h-[calc(14*1.35em+12px)] overflow-hidden bg-well px-2.5 py-1.5 font-mono text-2xs leading-[1.35] whitespace-pre text-well-ink"
            aria-hidden="true"
          >{{ snaps[w.paneKey] || '' }}</pre>
          <span v-if="!snaps[w.paneKey]" class="sr-only">{{ t('workspace.rail.mission.empty') }}</span>
          <span v-if="!snaps[w.paneKey]" class="-mt-[calc(14*1.35em+12px)] flex h-[calc(14*1.35em+12px)] items-center justify-center text-2xs text-ink-faint" aria-hidden="true" data-mission-empty>
            {{ t('workspace.rail.mission.empty') }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
