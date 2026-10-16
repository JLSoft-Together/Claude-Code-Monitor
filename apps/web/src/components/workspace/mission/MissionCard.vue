<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Columns2, LoaderCircle, X } from 'lucide-vue-next'
import { usePaneInfo, usePeerSweeps, type PanePeer } from '../../../composables/usePaneInfo'
import type { MissionCard, MissionTile } from '../../../lib/rail/mission'
import { peerSlot, stateWord, type PeerSlot, type RailState } from '../../../lib/rail/railModel'
import type { RunBadge } from '../../../lib/runUi'
import type { Box } from '../../../lib/splitLayout'
import { isTerm, useWorkspaceStore, type Pane } from '../../../stores/workspace'
import StatusIcon from '../../StatusIcon.vue'
import PaneIcon from '../PaneIcon.vue'
import TabRenameInput from '../TabRenameInput.vue'
import { tailLines, tileRows, type TileMetrics } from './missionLayout'
import { dur, ease, flipAll, layoutBox } from './missionMotion'

const props = defineProps<{
  card: MissionCard
  section: string
  roving: boolean
  draggable: boolean
  renaming: { initial: string } | null
  highlight: number
  snaps: Record<string, string>
  flashes: Record<string, number>
  drop: boolean
  dragging: string | null
  index: number | null
  bodyH: number
  rowCap: number
  motion: { enter: (el: Element, done: () => void) => void; leave: (el: Element, done: () => void) => void }
}>()
const emit = defineEmits<{
  open: []
  openTile: [paneKey: string]
  close: []
  rename: []
  renamed: [saved: boolean]
  menu: [event: MouseEvent, paneKey?: string]
}>()

const { t } = useI18n()
const info = usePaneInfo()
const workspace = useWorkspaceStore()
const paneOf = (k: string): Pane | undefined => workspace.panes.find((p) => p.key === k)

const BADGE: Record<string, string> = { failed: 'error', asked: 'waiting', working: 'working', subagents: 'working', done: 'completed', ended: 'completed', idle: 'idle' }
const badgeOf = (s: RailState | null): string | undefined => (s ? BADGE[s] : undefined)
const inkOf = (s: RailState | null): string => (s === 'failed' ? 'text-st-error' : s === 'asked' ? 'text-st-waiting' : 'text-ink-muted')
const FLASH_INK: Record<string, string> = { failed: 'text-st-error', asked: 'text-st-waiting', done: 'text-st-done' }

function wordOf(x: { state: RailState | null; run: RunBadge | null; subagents: number }, paneKey?: string): string {
  if (x.run) return t(`run.badge.${x.run}`)
  if (!x.state) return ''
  const own = paneKey ? info.stateText(paneOf(paneKey)) : null
  if (own) return own
  const w = stateWord(x.state, x.subagents)
  return w.n === undefined ? t(w.key) : t(w.key, { n: w.n }, w.n)
}

const words = computed<Record<string, string>>(() => Object.fromEntries(props.card.tiles.map((x) => [x.paneKey, wordOf(x, x.paneKey)])))
const details = computed<Record<string, string>>(() =>
  Object.fromEntries(
    props.card.tiles.flatMap((x) => {
      const pane = paneOf(x.paneKey)
      return pane && !isTerm(pane) && pane.kind !== 'run' ? [[x.paneKey, info.viewDetail(pane) ?? info.viewLabel(pane)]] : []
    }),
  ),
)
const peers = computed<Record<string, PanePeer | null>>(() => Object.fromEntries(props.card.tiles.map((x) => [x.paneKey, info.peerOf(paneOf(x.paneKey))])))
const slots = computed<Record<string, PeerSlot>>(() => Object.fromEntries(props.card.tiles.map((x) => [x.paneKey, peerSlot(x.state, peers.value[x.paneKey])])))
const peerLine = (paneKey: string): PanePeer | null => (slots.value[paneKey] === 'line' ? peers.value[paneKey]! : null)
const peerBadge = (paneKey: string): PanePeer | null => (slots.value[paneKey] === 'badge' ? peers.value[paneKey]! : null)
const relations = computed<Record<string, string[]>>(() => Object.fromEntries(props.card.tiles.map((x) => [x.paneKey, info.peerLines(paneOf(x.paneKey))])))
const sweeps = usePeerSweeps(() => peers.value)
const cardWord = computed(() => wordOf({ state: props.card.state, run: null, subagents: props.card.subagents }))
const lead = computed(() => paneOf(props.card.tiles[0]?.paneKey ?? ''))

const label = computed(() => {
  const n = props.card.tiles.length
  return [
    props.card.title,
    cardWord.value,
    n > 1 ? t('workspace.rail.mission.panes', { n }, n) : '',
    props.card.needs ? t('workspace.rail.needs', { n: props.card.needs }, props.card.needs) : '',
  ]
    .filter(Boolean)
    .join(', ')
})
const headTip = computed(() => [props.card.title, cardWord.value, props.draggable ? t('workspace.missionGrid.dragTab') : ''].filter(Boolean).join('\n'))
const titleTip = computed(() => [props.card.title, t('workspace.missionGrid.renameHint')].join('\n'))

function tileLabel(x: MissionTile): string {
  const detail = details.value[x.paneKey]
  const parts = [x.title, words.value[x.paneKey], peers.value[x.paneKey]?.label, detail !== undefined ? detail : props.snaps[x.paneKey] ? '' : t('workspace.rail.mission.empty')]
  return t('workspace.rail.mission.enter', { name: parts.filter(Boolean).join(', ') })
}
const tileTip = (x: MissionTile): string =>
  [
    ...new Set(
      [
        x.title,
        words.value[x.paneKey],
        peers.value[x.paneKey]?.label,
        ...(relations.value[x.paneKey] ?? []),
        details.value[x.paneKey],
        props.draggable || props.card.tiles.length > 1 ? t('workspace.missionGrid.dragPane') : '',
      ].filter(Boolean),
    ),
  ].join('\n')

const GAP = 2
const tileStyle = (b: Box): Record<string, string> => ({
  left: `calc(${b.x * 100}% + ${GAP}px)`,
  top: `calc(${b.y * 100}% + ${GAP}px)`,
  width: `calc(${b.w * 100}% - ${GAP * 2}px)`,
  height: `calc(${b.h * 100}% - ${GAP * 2}px)`,
})

const METRICS: TileMetrics = { inset: 2, gap: GAP, head: 20, pad: 8, line: 15.6 }
const outputs = computed<Record<string, string>>(() =>
  Object.fromEntries(props.card.tiles.map((x) => [x.paneKey, tailLines(props.snaps[x.paneKey] ?? '', tileRows(props.bodyH, x.box.h, METRICS, props.rowCap))])),
)

const root = ref<HTMLElement | null>(null)
const tileEls = (): HTMLElement[] => [...(root.value?.querySelectorAll<HTMLElement>('[data-mission-tile]') ?? [])]
const boxSig = computed(() => props.card.tiles.map((x) => `${x.paneKey}@${x.box.x},${x.box.y},${x.box.w},${x.box.h}`).join('|'))
let before: Map<string, ReturnType<typeof layoutBox>> | null = null

watch(
  boxSig,
  () => {
    before = dur('base') ? new Map(tileEls().map((el) => [el.dataset.missionTile ?? '', layoutBox(el)])) : null
  },
  { flush: 'pre' },
)
watch(
  boxSig,
  () => {
    const from = before
    before = null
    if (!from?.size) return
    const keys = new Set(props.card.tiles.map((x) => x.paneKey))
    const items = tileEls()
      .filter((el) => keys.has(el.dataset.missionTile ?? ''))
      .map((el) => ({ el, from: from.get(el.dataset.missionTile ?? ''), inner: el.querySelector<HTMLElement>('[data-mission-tile-inner]') }))
    void flipAll(items, { ms: dur('base'), easing: ease('out-quint'), measure: layoutBox })
  },
  { flush: 'post' },
)

let clickTimer: ReturnType<typeof setTimeout> | undefined
function onTitleClick(e: MouseEvent): void {
  if (e.detail > 1) return
  clearTimeout(clickTimer)
  clickTimer = setTimeout(() => emit('open'), 250)
}
function onTitleDblClick(): void {
  clearTimeout(clickTimer)
  emit('rename')
}
onBeforeUnmount(() => clearTimeout(clickTimer))
</script>

<template>
  <div
    ref="root"
    class="group/card relative flex min-w-0 origin-top-left cursor-pointer flex-col overflow-hidden rounded-card bg-surface text-left shadow-card"
    :class="[card.current ? 'ring-2 ring-focus' : '', dragging === 'card' ? 'outline-2 outline-dashed outline-line-strong' : '']"
    role="group"
    :tabindex="roving ? 0 : -1"
    :aria-label="label"
    :aria-keyshortcuts="index ? String(index) : undefined"
    :aria-current="card.current ? 'true' : undefined"
    :data-mission-card="card.tabKey"
    :data-section="section"
    :data-state="card.state ?? undefined"
    :data-current="card.current ? '' : undefined"
    :data-drop="drop ? 'valid' : undefined"
    :data-panes="card.tiles.map((x) => x.paneKey).join(' ')"
    @click="emit('open')"
    @contextmenu.prevent.stop="emit('menu', $event)"
  >
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-2.5" :title="headTip" data-mission-card-head>
      <kbd
        v-if="index"
        class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] px-1 font-sans text-2xs leading-none font-normal text-ink-faint tabular ring-1 ring-line ring-inset"
        :title="t('workspace.missionV2.index', { n: index })"
        aria-hidden="true"
        :data-mission-index="index"
        >{{ index }}</kbd
      >
      <span class="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        <Transition name="ccm-fade" mode="out-in">
          <LoaderCircle v-if="card.state === 'starting'" key="starting" :size="14" class="ccm-spin text-ink-faint" />
          <StatusIcon v-else-if="badgeOf(card.state)" :key="badgeOf(card.state)" :status="badgeOf(card.state)!" :size="14" />
          <PaneIcon v-else-if="lead" key="pane" :pane="lead" :size="14" />
        </Transition>
      </span>
      <TabRenameInput v-if="renaming" :tab-key="card.tabKey" :initial="renaming.initial" class="min-w-0 flex-1" @done="(saved: boolean) => emit('renamed', saved)" />
      <span
        v-else
        :key="`title-${highlight}`"
        class="-mx-0.5 min-w-0 flex-1 truncate rounded-[4px] px-0.5 text-xs font-medium text-ink"
        :class="highlight ? 'ccm-highlight' : ''"
        :title="titleTip"
        data-mission-card-title
        @click.stop="onTitleClick"
        @dblclick.stop="onTitleDblClick"
        >{{ card.title }}</span
      >
      <span
        v-if="card.tiles.length > 1"
        class="inline-flex h-5 shrink-0 items-center gap-1 rounded-inner bg-fill px-1.5 text-2xs text-ink-muted tabular"
        aria-hidden="true"
        data-mission-pane-count
        ><Columns2 :size="11" />{{ card.tiles.length }}</span
      >
      <button
        type="button"
        class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-faint opacity-0 transition-opacity duration-(--ccm-dur-fast) group-focus-within/card:opacity-100 group-hover/card:opacity-100 hover:bg-fill-strong hover:text-ink focus-visible:opacity-100"
        :tabindex="roving ? 0 : -1"
        :title="t('workspace.tabActions.close')"
        :aria-label="t('workspace.rail.closeRow', { name: card.title })"
        data-no-drag
        data-mission-card-close
        @click.stop="emit('close')"
      >
        <X :size="13" aria-hidden="true" />
      </button>
    </div>
    <div class="relative shrink-0 rounded-b-card bg-fill" :style="{ height: `${bodyH}px` }" data-mission-body>
      <TransitionGroup tag="div" class="absolute inset-[2px]" :css="false" @enter="motion.enter" @leave="motion.leave">
        <button
          v-for="tile in card.tiles"
          :key="tile.paneKey"
          type="button"
          class="mc-tile @container absolute flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-[7px] bg-surface text-left shadow-control outline-offset-1 hover:ring-1 hover:ring-line-strong"
          :class="dragging === tile.paneKey ? 'outline-2 outline-dashed outline-line-strong' : ''"
          :style="tileStyle(tile.box)"
          :tabindex="roving ? 0 : -1"
          :aria-label="tileLabel(tile)"
          :title="tileTip(tile)"
          :data-mission-tile="tile.paneKey"
          :data-state="tile.state ?? undefined"
          @click.stop="emit('openTile', tile.paneKey)"
          @contextmenu.prevent.stop="emit('menu', $event, tile.paneKey)"
        >
          <span class="flex min-h-0 min-w-0 flex-1 flex-col" data-mission-tile-inner>
            <span class="flex h-5 min-w-0 shrink-0 items-center gap-1 px-1.5 text-2xs">
              <span class="relative inline-flex shrink-0">
                <PaneIcon v-if="paneOf(tile.paneKey)" :pane="paneOf(tile.paneKey)!" :size="12" />
                <Transition name="ccm-fade">
                  <span v-if="peerBadge(tile.paneKey)" class="absolute -top-1 -right-1 inline-flex rounded-full bg-surface p-px" aria-hidden="true" data-mission-peer-badge>
                    <component :is="peerBadge(tile.paneKey)!.glyph" :size="8" :class="peerBadge(tile.paneKey)!.tone" />
                  </span>
                </Transition>
              </span>
              <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ tile.title }}</span>
              <Transition name="ccm-fade" mode="out-in">
                <span
                  v-if="peerLine(tile.paneKey)"
                  :key="`p:${peerLine(tile.paneKey)!.text}`"
                  class="inline-flex max-w-[60%] min-w-0 shrink-0 items-center gap-0.5 text-ink"
                  :data-mission-peer="peerLine(tile.paneKey)!.dir"
                >
                  <component :is="peerLine(tile.paneKey)!.glyph" :size="10" class="shrink-0" :class="peerLine(tile.paneKey)!.tone" aria-hidden="true" />
                  <span class="truncate @max-[260px]:hidden">{{ peerLine(tile.paneKey)!.text }}</span>
                  <span class="hidden truncate @max-[260px]:inline">{{ peerLine(tile.paneKey)!.short }}</span>
                </span>
                <span
                  v-else-if="words[tile.paneKey]"
                  :key="words[tile.paneKey]"
                  class="inline-flex max-w-[60%] min-w-0 shrink-0 items-center gap-0.5"
                  :class="inkOf(tile.state)"
                  data-mission-state
                >
                  <LoaderCircle v-if="tile.state === 'starting'" :size="10" class="ccm-spin shrink-0 text-ink-faint" aria-hidden="true" />
                  <StatusIcon v-else-if="badgeOf(tile.state)" :status="badgeOf(tile.state)!" :size="10" />
                  <span class="truncate">{{ words[tile.paneKey] }}</span>
                </span>
              </Transition>
            </span>
            <span
              v-if="details[tile.paneKey] !== undefined"
              class="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden bg-raised px-2 text-center"
              aria-hidden="true"
              data-mission-view
            >
              <PaneIcon v-if="paneOf(tile.paneKey)" :pane="paneOf(tile.paneKey)!" :size="18" />
              <span class="line-clamp-2 max-w-full text-2xs break-all text-ink-muted">{{ details[tile.paneKey] }}</span>
            </span>
            <span v-else class="flex min-h-0 flex-1 flex-col justify-start overflow-hidden bg-well px-1.5 py-1" aria-hidden="true">
              <span v-if="outputs[tile.paneKey]" class="block font-mono text-2xs leading-[1.3] whitespace-pre text-well-ink" data-mission-output>{{
                outputs[tile.paneKey]
              }}</span>
              <span v-else class="m-auto px-1 text-center text-2xs text-well-ink" data-mission-empty>{{ t('workspace.rail.mission.empty') }}</span>
            </span>
          </span>
          <span
            v-if="sweeps[tile.paneKey]"
            :key="`sweep-${sweeps[tile.paneKey]}`"
            class="ccm-peer-sweep-x absolute inset-x-1.5 top-0 z-10 h-0.5"
            aria-hidden="true"
            data-mission-peer-sweep
          />
          <span
            v-if="flashes[tile.paneKey]"
            :key="`flash-${flashes[tile.paneKey]}`"
            class="ccm-flash pointer-events-none absolute inset-0 rounded-[7px]"
            :class="FLASH_INK[tile.state ?? ''] ?? 'text-ink-muted'"
            aria-hidden="true"
          />
        </button>
      </TransitionGroup>
    </div>
    <Transition name="ccm-fade">
      <span v-if="drop" class="pointer-events-none absolute inset-0 z-10 rounded-card bg-accent-soft ring-2 ring-accent ring-inset" aria-hidden="true" />
    </Transition>
  </div>
</template>

<style scoped>
.mc-tile {
  transition: box-shadow var(--ccm-dur-fast) var(--ease-out-quint);
}
</style>
