<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, Gauge, HardDrive, OctagonAlert, WifiOff } from 'lucide-vue-next'
import { hasDisk } from '../lib/buildClean'
import { now, relativeTime } from '../lib/format'
import { limitsStale, worstLimit } from '../lib/headerStatus'
import { retireOverlay } from '../lib/motion'
import { useAwakeStore } from '../stores/awake'
import { useConnectionStore } from '../stores/connection'
import { useDiskStore } from '../stores/disk'
import { useExtrasStore } from '../stores/extras'
import PlanLimits from './PlanLimits.vue'
import KeepAwakeBadge from './KeepAwakeBadge.vue'
import ResourcesButton from './ResourcesButton.vue'
import DiskBadge from './DiskBadge.vue'

/** One header control for what used to be five: limits, keep-awake, disk, resources and the collector connection. */
const { t, locale } = useI18n()
const extras = useExtrasStore()
const connection = useConnectionStore()
const awake = useAwakeStore()
const disk = useDiskStore()
onMounted(() => {
  awake.start()
  disk.start()
})

const btn = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const open = ref(false)
const anchor = ref<DOMRect | null>(null)

const worst = computed(() => worstLimit(extras.limits, extras.codexLimits))
const worstStale = computed(() => {
  const w = worst.value
  return !!w && limitsStale(w.provider === 'codex' ? extras.codexLimits : extras.limits, now.value)
})
const alert = computed(() => worst.value?.level === 'critical' && !worstStale.value)
const warn = computed(() => worst.value?.level === 'warn' && !worstStale.value)
const worstLabel = computed(() => (worst.value ? `${t(`limits.${worst.value.key}`)} ${t('headerV79.left', { pct: worst.value.left })}` : ''))
const worstTone = computed(() => (alert.value ? 'text-st-error' : warn.value ? 'text-warning' : worstStale.value ? 'text-ink-muted' : 'text-ink'))

const offline = computed(() => connection.state !== 'connected' && (connection.state !== 'connecting' || connection.hasData))
const connectionView = computed(() => {
  switch (connection.state) {
    case 'connected':
      return { label: t('connection.connected'), cls: 'text-success' }
    case 'reconnecting':
      return { label: t('connection.reconnecting'), cls: 'text-warning' }
    case 'connecting':
      return { label: t('connection.connecting'), cls: 'text-st-idle' }
    default:
      return { label: t('connection.disconnected'), cls: 'text-st-error' }
  }
})
const offlineText = computed(() => (connection.state === 'disconnected' ? t('headerV79.lost') : connectionView.value.label))
const lastUpdate = computed(() => {
  const ago = relativeTime(connection.lastEventAt, locale.value, now.value)
  return ago ? t('connection.lastUpdate', { ago }) : t('connection.never')
})

const diskLow = computed(() => hasDisk && !!disk.worst)
const diskText = computed(() => (disk.low.length > 1 ? t('disk.badgeMany', { n: disk.low.length }) : disk.low[0] ? t('disk.badge', { label: disk.low[0].label }) : ''))
const awakeOn = computed(() => !!awake.state?.holding)

const label = computed(() => {
  const parts = [worst.value ? t('headerV79.buttonLimit', { label: t(`limits.${worst.value.key}Long`), pct: worst.value.left }) : t('headerV79.button')]
  if (offline.value) parts.push(offlineText.value)
  if (diskLow.value) parts.push(diskText.value)
  return parts.join('. ')
})

const WIDTH = 340
const style = computed(() => {
  const a = anchor.value
  if (!a) return {}
  const left = Math.max(12, Math.min(a.right - WIDTH, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${a.bottom + 6}px`, width: `${Math.min(WIDTH, window.innerWidth - 24)}px`, '--ccm-origin': 'top right' }
})

function close(refocus = true): void {
  open.value = false
  if (refocus) btn.value?.focus()
}
function toggle(): void {
  if (open.value) return close()
  anchor.value = btn.value?.getBoundingClientRect() ?? null
  open.value = true
  void nextTick(() => pop.value?.focus())
}
function showDisk(): void {
  close(false)
  disk.open = true
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (open.value && !pop.value?.contains(target) && !btn.value?.contains(target)) close(false)
}
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !open.value) return
  e.preventDefault()
  e.stopPropagation()
  close()
}
watch(open, (value) => {
  if (value) document.addEventListener('keydown', onKey, true)
  else document.removeEventListener('keydown', onKey, true)
})
onMounted(() => document.addEventListener('pointerdown', onOutside, true))
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <button
    ref="btn"
    type="button"
    class="ccm-btn-plain relative gap-1.5 text-xs font-medium"
    :class="open ? 'bg-fill' : ''"
    :aria-label="label"
    :title="label"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :data-awake="awakeOn ? awake.state?.reason : undefined"
    :data-disk-badge="diskLow ? disk.worst : undefined"
    data-tour="limits"
    data-status-button
    @click="toggle"
  >
    <template v-if="offline">
      <WifiOff :size="14" :class="connectionView.cls" aria-hidden="true" />
      <span :class="connectionView.cls" data-offline-label>{{ offlineText }}</span>
    </template>
    <template v-else>
      <component :is="alert ? OctagonAlert : warn ? CircleAlert : Gauge":size="14" :class="worstTone" aria-hidden="true" />
      <span class="hidden sm:inline" :class="worst ? 'text-ink-muted' : 'text-ink'">{{ t('headerV79.limits') }}</span>
      <span v-if="worst" class="tabular" :class="worstTone" data-worst-limit>{{ worstLabel }}</span>
    </template>
    <span
      v-if="diskLow"
      class="absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-surface"
      :class="disk.worst === 'danger' ? 'bg-st-error' : 'bg-warning'"
      aria-hidden="true"
      data-status-dot
    />
  </button>

  <Transition name="ccm-menu" @before-leave="retireOverlay">
    <div
      v-if="open && anchor"
      ref="pop"
      class="ccm-menu fixed z-50 flex max-h-[min(80vh,560px)] flex-col overflow-y-auto p-3 outline-none"
      :style="style"
      role="dialog"
      tabindex="-1"
      :aria-label="t('headerV79.popoverTitle')"
      data-status-popover
    >
      <p class="text-sm font-semibold text-ink">{{ t('headerV79.popoverTitle') }}</p>
      <div class="mt-2 flex flex-col gap-3">
        <PlanLimits v-if="extras.limits?.fiveHour || extras.limits?.sevenDay" list />
        <PlanLimits v-if="extras.codexLimits?.fiveHour || extras.codexLimits?.sevenDay" provider="codex" list />
        <p v-if="!worst" class="text-xs text-ink-muted" data-limits-empty>{{ t('headerV79.noLimits') }}</p>
      </div>

      <div class="mt-3 flex flex-col gap-0.5 border-t border-line pt-2">
        <KeepAwakeBadge row class="px-2 py-1.5" />
        <button
          v-if="diskLow"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left text-xs transition-colors hover:bg-fill"
          :class="disk.worst === 'danger' ? 'text-st-error' : 'text-warning'"
          data-status-disk
          @click="showDisk"
        >
          <HardDrive :size="14" class="shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ t('headerV79.disk') }}: {{ diskText }}</span>
          <span class="shrink-0 text-ink-faint">{{ t('headerV79.diskOpen') }}</span>
        </button>
        <ResourcesButton variant="row" @click="close(false)" />
      </div>

      <p class="mt-2 flex items-center gap-2 border-t border-line px-2 pt-2 text-xs" role="status" data-status-connection>
        <span class="size-2 shrink-0 rounded-full bg-current" :class="connectionView.cls" aria-hidden="true" />
        <span class="text-ink-muted">{{ t('headerV79.collector') }}</span>
        <span class="font-medium" :class="connectionView.cls">{{ connectionView.label }}</span>
        <span class="ml-auto truncate text-2xs text-ink-faint">{{ lastUpdate }}</span>
      </p>
    </div>
  </Transition>
  <DiskBadge :anchor="btn" />
</template>
