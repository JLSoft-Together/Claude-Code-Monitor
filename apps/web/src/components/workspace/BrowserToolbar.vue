<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ArrowRight, Bug, ExternalLink, FolderOpen, Globe, MonitorSmartphone, RotateCw, Send, X, Zap, ZapOff } from 'lucide-vue-next'
import type { HandoffAction } from '../../lib/agentHandoff'
import type { DeviceId } from '../../lib/browserDevices'
import DeviceMenu from './DeviceMenu.vue'
import HandoffMenu from './HandoffMenu.vue'

const props = defineProps<{
  address: string
  canBack: boolean
  canForward: boolean
  loading: boolean
  /** Live reload only applies to files served from disk. */
  liveAvailable: boolean
  live: boolean
  device: DeviceId
  rotated: boolean
  zoom: number
  favicon?: string
  /** Send-to-agent menu (v23); hidden when false. */
  canHandoff?: boolean
  consoleCount?: number
  picking?: boolean
}>()
const emit = defineEmits<{
  back: []
  forward: []
  reload: []
  stop: []
  navigate: [input: string]
  live: []
  device: [id: DeviceId]
  rotate: []
  zoom: [value: number]
  external: []
  devtools: []
  openFile: []
  handoff: [action: HandoffAction, anchor: DOMRect]
}>()

const { t } = useI18n()
const draft = ref(props.address)
const editing = ref(false)
// A 404 /favicon.ico (most preview pages) falls back to the globe instead of a broken image.
const iconFailed = ref<string | undefined>(undefined)
const input = ref<HTMLInputElement | null>(null)

watch(
  () => props.address,
  (a) => {
    if (!editing.value) draft.value = a
  },
)

/** Calm address: host + path for web pages, the bare path for files; the full value stays in the tooltip. */
const shown = computed(() => {
  if (editing.value) return draft.value
  // "C:\x" parses as a URL with scheme "c:".
  if (!/^https?:\/\//i.test(props.address)) return props.address
  try {
    const u = new URL(props.address)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`
  } catch {
    return props.address
  }
})

function onFocus(): void {
  editing.value = true
  draft.value = props.address
  requestAnimationFrame(() => input.value?.select())
}

function onBlur(): void {
  editing.value = false
  draft.value = props.address
}

function submit(): void {
  const value = draft.value.trim()
  if (value) emit('navigate', value)
  input.value?.blur()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    draft.value = props.address
    input.value?.blur()
  }
}

const deviceAnchor = ref<DOMRect | null>(null)
const deviceButton = ref<HTMLButtonElement | null>(null)
const toggleDevices = (): void => {
  deviceAnchor.value = deviceAnchor.value ? null : (deviceButton.value?.getBoundingClientRect() ?? null)
}

const handoffAnchor = ref<DOMRect | null>(null)
const handoffButton = ref<HTMLButtonElement | null>(null)
const toggleHandoff = (): void => {
  handoffAnchor.value = handoffAnchor.value ? null : (handoffButton.value?.getBoundingClientRect() ?? null)
}
function pickHandoff(action: HandoffAction): void {
  const rect = handoffButton.value?.getBoundingClientRect()
  if (rect) emit('handoff', action, rect)
}

const handoffLabel = computed(() => {
  const n = props.consoleCount ?? 0
  return n ? `${t('workspace.handoff.menu')} (${t('workspace.handoff.consoleHint', { n }, n)})` : t('workspace.handoff.menu')
})

defineExpose({ handoffButton })
</script>

<template>
  <div class="ccm-material flex h-9 min-w-0 shrink-0 items-center gap-0.5 border-b border-line px-1.5" role="toolbar" :aria-label="t('workspace.browser.toolbar')">
    <button type="button" class="ccm-btn-plain shrink-0" :disabled="!canBack" :title="t('workspace.browser.back')" :aria-label="t('workspace.browser.back')" @click="emit('back')">
      <ArrowLeft :size="15" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0" :disabled="!canForward" :title="t('workspace.browser.forward')" :aria-label="t('workspace.browser.forward')" @click="emit('forward')">
      <ArrowRight :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="loading"
      type="button"
      class="ccm-btn-plain shrink-0"
      :title="t('workspace.browser.stop')"
      :aria-label="t('workspace.browser.stop')"
      @click="emit('stop')"
    >
      <X :size="15" aria-hidden="true" />
    </button>
    <button v-else type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.browser.reload')" :aria-label="t('workspace.browser.reload')" @click="emit('reload')">
      <RotateCw :size="14" aria-hidden="true" />
    </button>

    <form class="ccm-field mx-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 px-2" role="search" @submit.prevent="submit">
      <img v-if="favicon && !editing && iconFailed !== favicon" :src="favicon" alt="" class="size-3.5 shrink-0 rounded-[3px]" @error="iconFailed = favicon" />
      <Globe v-else :size="13" class="shrink-0 text-agent-browser" aria-hidden="true" />
      <input
        ref="input"
        :value="shown"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="ccm-bare-input min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
        :class="editing ? '' : 'text-ink-muted'"
        :placeholder="t('workspace.browser.addressHint')"
        :aria-label="t('workspace.browser.address')"
        :title="address"
        @input="draft = ($event.target as HTMLInputElement).value"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKey"
      />
      <span v-if="loading" class="h-0.5 w-6 shrink-0 overflow-hidden rounded-full bg-fill" aria-hidden="true">
        <span class="ccm-shimmer block h-full w-full bg-accent" />
      </span>
    </form>

    <button
      ref="deviceButton"
      type="button"
      class="ccm-btn-plain shrink-0 gap-1 text-xs"
      :title="t('workspace.browser.deviceMenu')"
      :aria-label="t('workspace.browser.deviceMenu')"
      aria-haspopup="menu"
      :aria-expanded="!!deviceAnchor"
      @click="toggleDevices"
    >
      <MonitorSmartphone :size="15" aria-hidden="true" />
      <span v-if="zoom !== 100" class="tabular">{{ zoom }}%</span>
    </button>
    <DeviceMenu
      v-if="deviceAnchor"
      :anchor="deviceAnchor"
      :device="device"
      :rotated="rotated"
      :zoom="zoom"
      :trigger="deviceButton"
      @device="(id) => emit('device', id)"
      @rotate="emit('rotate')"
      @zoom="(z) => emit('zoom', z)"
      @close="deviceAnchor = null"
    />
    <button
      v-if="liveAvailable"
      type="button"
      class="ccm-btn-plain shrink-0"
      :aria-pressed="live"
      :title="live ? t('workspace.browser.liveReloadOn') : t('workspace.browser.liveReloadOff')"
      :aria-label="t('workspace.browser.liveReload')"
      @click="emit('live')"
    >
      <Zap v-if="live" :size="14" aria-hidden="true" />
      <ZapOff v-else :size="14" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.browser.openFile')" :aria-label="t('workspace.browser.openFile')" @click="emit('openFile')">
      <FolderOpen :size="14" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.browser.openExternal')" :aria-label="t('workspace.browser.openExternal')" @click="emit('external')">
      <ExternalLink :size="14" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.browser.devtools')" :aria-label="t('workspace.browser.devtools')" @click="emit('devtools')">
      <Bug :size="14" aria-hidden="true" />
    </button>
    <button
      v-if="canHandoff"
      ref="handoffButton"
      type="button"
      class="ccm-btn-plain shrink-0 gap-1 text-xs"
      :title="t('workspace.handoff.menu')"
      :aria-label="handoffLabel"
      aria-haspopup="menu"
      :aria-expanded="!!handoffAnchor"
      :aria-pressed="picking || undefined"
      @click="toggleHandoff"
    >
      <Send :size="14" aria-hidden="true" />
      <span v-if="consoleCount" class="tabular text-2xs" aria-hidden="true">{{ consoleCount }}</span>
    </button>
    <HandoffMenu
      v-if="handoffAnchor"
      :anchor="handoffAnchor"
      :console-count="consoleCount ?? 0"
      :trigger="handoffButton"
      @pick="pickHandoff"
      @close="handoffAnchor = null"
    />
    <slot name="end" />
  </div>
</template>
