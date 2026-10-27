<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { Agent } from '@ccm/shared'
import type { MapNodeContext, TrayState } from '../lib/mapNav'
import { TRAY_HEIGHT, TRAY_WIDTH, TRUNK_X } from '../lib/layout'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{ id: string; data: { terminalId: string } }>()

const { t } = useI18n()
const trays = inject<ComputedRef<Record<string, TrayState>> | null>('ccm-map-trays', null)
const mapCtx = inject<MapNodeContext | null>('ccm-map-node', null)

const MAX_DOTS = 12

type Dot = { id: string; cancelled: boolean; title: string }

const tray = computed(() => trays?.value[props.data.terminalId])
const open = computed(() => !!tray.value?.open)
const count = computed(() => (tray.value ? (tray.value.open ? tray.value.finished.length : tray.value.hidden.length) : 0))
const dots = computed<Dot[]>((prev) => {
  const next = tray.value && !tray.value.open ? tray.value.hidden.slice(-MAX_DOTS).map(toDot) : []
  const same = prev?.length === next.length && next.every((d, i) => d.id === prev[i]!.id && d.cancelled === prev[i]!.cancelled && d.title === prev[i]!.title)
  return same ? prev! : next
})
const more = computed(() => Math.max(0, (tray.value?.hidden.length ?? 0) - MAX_DOTS))
const tabbable = computed(() => mapCtx?.tabStop.value === props.id)
const label = computed(() => (open.value ? t('mapV53.tray.close', { n: count.value }, count.value) : t('mapV53.tray.open', { n: count.value }, count.value)))

function toDot(a: Agent): Dot {
  const name = a.type ?? a.name ?? t('agent.subagent')
  return { id: a.id, cancelled: a.status === 'cancelled', title: a.description ? `${name} — ${a.description}` : name }
}
</script>

<template>
  <div v-if="count" class="relative" :style="{ width: `${TRAY_WIDTH}px`, height: `${TRAY_HEIGHT}px` }">
    <Handle type="target" :position="Position.Top" :style="{ left: `${TRUNK_X}px` }" />
    <div class="ccm-pill-in size-full">
      <div
        data-tray-node
        role="button"
        :tabindex="tabbable ? 0 : -1"
        :aria-expanded="open"
        :aria-label="label"
        :title="label"
        class="group/tray relative flex cursor-pointer items-center gap-2 rounded-full border border-dashed border-line-strong bg-surface pr-2.5 pl-3 text-xs text-ink-muted transition-colors duration-(--ccm-dur-fast) hover:border-solid hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus"
        :style="{ width: `${TRAY_WIDTH}px`, height: `${TRAY_HEIGHT}px` }"
      >
        <TransitionGroup v-if="dots.length" tag="span" name="ccm-dot" class="flex min-w-0 shrink items-center gap-1" aria-hidden="true">
          <span v-for="d in dots" :key="d.id" class="size-2 shrink-0 rounded-full" :class="d.cancelled ? 'bg-st-stale' : 'bg-st-done'" :title="d.title" />
        </TransitionGroup>
        <span v-if="more" class="shrink-0 tabular-nums text-ink-faint" aria-hidden="true">+{{ more }}</span>
        <span class="min-w-0 flex-1 truncate font-medium tabular-nums">{{ open ? t('mapV53.tray.collapse') : t('mapV53.tray.count', { n: count }, count) }}</span>
        <component :is="open ? ChevronUp : ChevronDown" :size="14" class="shrink-0" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
