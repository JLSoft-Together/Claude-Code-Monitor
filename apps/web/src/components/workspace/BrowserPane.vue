<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, Globe, Lock, MousePointerClick } from 'lucide-vue-next'
import {
  PICKER_CANCEL_SCRIPT,
  asElementPick,
  consoleLevel,
  formatConsoleBlock,
  formatElementBlock,
  pickerScript,
  pushConsole,
  type ConsoleEntry,
  type HandoffAction,
} from '../../lib/agentHandoff'
import { DEVICES, frameFit, type DeviceId } from '../../lib/browserDevices'
import {
  captureGuest,
  clipboardImage,
  hasCaptureGuest,
  hasPreview,
  onPreviewChanged,
  openExternal,
  parseAddress,
  pickFile,
  previewUrl,
  unwatchRoot,
  watchRoot,
  type PreviewTarget,
} from '../../lib/preview'
import AccessPrompt from './AccessPrompt.vue'
import BrowserToolbar from './BrowserToolbar.vue'
import ConsolePopover from './ConsolePopover.vue'

/** Subset of Electron's WebviewTag used here (the renderer has no electron types). */
interface WebviewEl extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  reloadIgnoringCache(): void
  stop(): void
  isDevToolsOpened(): boolean
  openDevTools(): void
  closeDevTools(): void
  setZoomFactor(factor: number): void
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  getWebContentsId(): number
  capturePage(): Promise<{ toDataURL(): string; isEmpty(): boolean }>
}

const PARTITION = 'persist:ccm-preview'

/** `cwd`: where "Open file" starts when the page is not a local file. */
const props = withDefaults(defineProps<{ url: string; active?: boolean; cwd?: string }>(), { active: true })
const emit = defineEmits<{
  navigate: [source: string]
  title: [title: string]
  favicon: [url: string | null]
  /** Text for the target agent's input line (bracketed paste, never submitted). */
  insertText: [text: string]
  /** A screenshot is on the clipboard; the target terminal pastes it (^V) into the agent input. */
  insertImage: []
}>()

const { t } = useI18n()

const initialSrc = ref<string | null>(null)
const webview = ref<WebviewEl | null>(null)
const stage = ref<HTMLElement | null>(null)
const target = ref<PreviewTarget | null>(null)
const current = ref('')
const loading = ref(false)
const canBack = ref(false)
const canForward = ref(false)
const failure = ref<{ url: string; error: string } | null>(null)
const notice = ref<string | null>(null)
/** Path refused as outside every allowed folder: offers the inline "Allow access" button. */
const denied = ref<string | null>(null)
const favicon = ref<string | undefined>(undefined)
const live = ref(true)
const device = ref<DeviceId>('responsive')
const rotated = ref(false)
const zoom = ref(100)
const stageSize = ref({ w: 0, h: 0 })
const consoleEntries = ref<ConsoleEntry[]>([])
const picking = ref(false)
const consoleAnchor = ref<DOMRect | null>(null)
const toolbar = ref<InstanceType<typeof BrowserToolbar> | null>(null)
const handoffNote = ref<string | null>(null)
let noteTimer: ReturnType<typeof setTimeout> | null = null
let ready = false
let watchedRoot: string | null = null
let pendingScroll: number | null = null

/** Pane state keeps file paths, not preview URLs: the port and token change every app run. */
function toSource(url: string): string {
  const tg = target.value
  const base = tg ? `${tg.origin}/${tg.token}/` : ''
  if (!tg || !url.startsWith(base)) return url
  const rel = url.slice(base.length).split(/[?#]/)[0] ?? ''
  const sep = tg.root.includes('\\') ? '\\' : '/'
  const parts = rel.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return p
    }
  })
  return parts.length ? `${tg.root.replace(/[\\/]$/, '')}${sep}${parts.join(sep)}` : tg.root
}

const address = computed(() => (current.value ? toSource(current.value) : props.url))

async function setWatch(root: string | null): Promise<void> {
  if (watchedRoot === root) return
  if (watchedRoot) void unwatchRoot(watchedRoot)
  watchedRoot = root
  if (root && !(await watchRoot(root)) && watchedRoot === root) watchedRoot = null
}

async function open(input: string): Promise<void> {
  failure.value = null
  notice.value = null
  denied.value = null
  const parsed = parseAddress(input)
  if (!parsed) {
    notice.value = t('workspace.browser.badAddress')
    return
  }
  let url: string
  if (parsed.kind === 'url') {
    target.value = null
    url = parsed.url
  } else {
    let res = await previewUrl(parsed.path)
    // Restored panes: the terminal whose folder makes this path readable may not have reported in yet.
    if (!res) res = await new Promise<PreviewTarget | null>((done) => setTimeout(() => done(previewUrl(parsed.path)), 1500))
    if (!res) {
      notice.value = t('workspace.browser.notAllowed')
      denied.value = parsed.path
      return
    }
    target.value = res
    url = res.url
  }
  void setWatch(live.value && target.value ? target.value.root : null)
  if (!initialSrc.value || !ready) {
    initialSrc.value = url
    return
  }
  current.value = url
  webview.value?.loadURL(url).catch(() => undefined)
}

function syncNav(): void {
  const wv = webview.value
  if (!wv || !ready) return
  canBack.value = wv.canGoBack()
  canForward.value = wv.canGoForward()
}

function onNavigate(e: Event): void {
  const { url, isMainFrame } = e as Event & { url: string; isMainFrame?: boolean }
  if (isMainFrame === false) return
  current.value = url
  failure.value = null
  syncNav()
  emit('navigate', toSource(url))
}

function onDomReady(): void {
  const wv = webview.value
  if (!wv) return
  ready = true
  wv.setZoomFactor(zoom.value / 100)
  syncNav()
  if (pendingScroll !== null) {
    const y = pendingScroll
    pendingScroll = null
    wv.executeJavaScript(`window.scrollTo(0, ${y})`).catch(() => undefined)
  }
}

function onFail(e: Event): void {
  const { errorCode, errorDescription, validatedURL, isMainFrame } = e as Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }
  // -3 = aborted (a new navigation replaced this one)
  if (!isMainFrame || errorCode === -3) return
  failure.value = { url: validatedURL, error: errorDescription || String(errorCode) }
}

function bind(wv: WebviewEl): void {
  wv.addEventListener('dom-ready', onDomReady)
  wv.addEventListener('did-start-loading', () => (loading.value = true))
  wv.addEventListener('did-stop-loading', () => {
    loading.value = false
    syncNav()
  })
  wv.addEventListener('did-navigate', onNavigate)
  wv.addEventListener('did-navigate', () => (consoleEntries.value = []))
  wv.addEventListener('console-message', (e) => {
    const ev = e as Event & { level: unknown; message: string; line?: number; sourceId?: string }
    const level = consoleLevel(ev.level)
    if (level) consoleEntries.value = pushConsole(consoleEntries.value, { level, message: ev.message, line: ev.line, source: ev.sourceId, at: Date.now() })
  })
  wv.addEventListener('did-navigate-in-page', onNavigate)
  wv.addEventListener('did-fail-load', onFail)
  wv.addEventListener('page-title-updated', (e) => emit('title', (e as Event & { title: string }).title))
  wv.addEventListener('page-favicon-updated', (e) => {
    const icon = (e as Event & { favicons: string[] }).favicons.find((f) => /^https?:/i.test(f)) ?? null
    favicon.value = icon ?? undefined
    emit('favicon', icon)
  })
}

watch(webview, (wv, old) => {
  if (wv && wv !== old) bind(wv)
})

async function reloadKeepingScroll(): Promise<void> {
  const wv = webview.value
  if (!wv || !ready) return
  const y = Number(await wv.executeJavaScript('window.scrollY').catch(() => 0))
  pendingScroll = Number.isFinite(y) ? Math.max(0, Math.round(y)) : null
  wv.reloadIgnoringCache()
}

function reload(): void {
  if (failure.value) {
    const url = failure.value.url || current.value || initialSrc.value
    failure.value = null
    if (url) webview.value?.loadURL(url).catch(() => undefined)
    return
  }
  void reloadKeepingScroll()
}

const currentToken = (): string | null => {
  const tg = target.value
  if (!tg || !current.value.startsWith(`${tg.origin}/`)) return null
  return current.value.slice(tg.origin.length + 1).split('/')[0] ?? null
}

const offChange = onPreviewChanged((change) => {
  const token = currentToken()
  if (live.value && token && change.tokens.includes(token)) void reloadKeepingScroll()
})

function toggleLive(): void {
  live.value = !live.value
  void setWatch(live.value && target.value ? target.value.root : null)
}

function toggleDevtools(): void {
  const wv = webview.value
  if (!wv || !ready) return
  if (wv.isDevToolsOpened()) wv.closeDevTools()
  else wv.openDevTools()
}

function setDevice(id: DeviceId): void {
  device.value = id
  if (id === 'responsive') rotated.value = false
}

async function openFile(): Promise<void> {
  // A local page: its own folder (the main process walks up from the file path).
  const file = await pickFile('html', target.value ? address.value : props.cwd)
  if (file) await open(file)
}

function note(text: string): void {
  handoffNote.value = text
  if (noteTimer) clearTimeout(noteTimer)
  noteTimer = setTimeout(() => (handoffNote.value = null), 4000)
}

const pageUrl = (): string => webview.value?.getURL() || current.value || initialSrc.value || ''

async function screenshot(): Promise<void> {
  const wv = webview.value
  if (!wv || !ready) return note(t('workspace.handoff.noPage'))
  let ok = false
  try {
    if (hasCaptureGuest) ok = await captureGuest(wv.getWebContentsId())
    if (!ok) {
      const image = await wv.capturePage()
      ok = !image.isEmpty() && (await clipboardImage(image.toDataURL()))
    }
  } catch {
    ok = false
  }
  if (!ok) return note(t('workspace.handoff.screenshotFailed'))
  emit('insertImage')
  note(t('workspace.handoff.screenshotReady'))
}

function insertConsole(list: ConsoleEntry[]): void {
  if (!list.length) return
  emit('insertText', formatConsoleBlock(list, pageUrl()))
  note(t('workspace.handoff.inserted'))
}

async function pickElement(): Promise<void> {
  const wv = webview.value
  if (!wv || !ready) return note(t('workspace.handoff.noPage'))
  if (picking.value) return cancelPick()
  picking.value = true
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ccm-focus').trim()
  wv.focus()
  try {
    const url = pageUrl()
    const pick = asElementPick(await wv.executeJavaScript(pickerScript(color), true), url)
    if (pick) {
      emit('insertText', formatElementBlock(pick))
      note(t('workspace.handoff.inserted'))
    }
  } catch {
    // page navigated or blocked script; nothing picked
  } finally {
    picking.value = false
  }
}

function cancelPick(): void {
  webview.value?.executeJavaScript(PICKER_CANCEL_SCRIPT).catch(() => undefined)
  picking.value = false
}

function onHandoff(action: HandoffAction, anchor: DOMRect): void {
  if (action === 'screenshot') void screenshot()
  else if (action === 'pick') void pickElement()
  else consoleAnchor.value = anchor
}

function onHostKey(e: KeyboardEvent): void {
  if (picking.value && e.key === 'Escape') {
    e.preventDefault()
    cancelPick()
  }
}

watch(zoom, (z) => {
  if (ready) webview.value?.setZoomFactor(z / 100)
})

const frame = computed(() => {
  const d = DEVICES.find((x) => x.id === device.value) ?? DEVICES[0]!
  return frameFit(d, rotated.value, stageSize.value.w, stageSize.value.h)
})

const frameStyle = computed(() => {
  const f = frame.value
  if (!f) return { inset: '0' }
  return {
    left: '50%',
    top: '50%',
    width: `${f.width}px`,
    height: `${f.height}px`,
    transform: `translate(-50%, -50%) scale(${f.scale})`,
  }
})

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  window.addEventListener('keydown', onHostKey, true)
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) stageSize.value = { w: entry.contentRect.width, h: entry.contentRect.height }
  })
  if (stage.value) resizeObserver.observe(stage.value)
  if (props.url) await open(props.url)
})

watch(
  () => props.url,
  (url) => {
    if (url && url !== address.value) void open(url)
  },
)

watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    syncNav()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onHostKey, true)
  if (noteTimer) clearTimeout(noteTimer)
  if (picking.value) cancelPick()
  offChange()
  resizeObserver?.disconnect()
  void setWatch(null)
})
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card" :aria-label="t('workspace.browser.title')">
    <BrowserToolbar
      ref="toolbar"
      :address="address"
      :can-back="canBack"
      :can-forward="canForward"
      :loading="loading"
      :live-available="!!target"
      :live="live"
      :device="device"
      :rotated="rotated"
      :zoom="zoom"
      :favicon="favicon"
      @back="webview?.goBack()"
      @forward="webview?.goForward()"
      @reload="reload"
      @stop="webview?.stop()"
      @navigate="open"
      @live="toggleLive"
      @device="setDevice"
      @rotate="rotated = !rotated"
      @zoom="(z) => (zoom = z)"
      @external="openExternal(current || initialSrc || '')"
      @devtools="toggleDevtools"
      @open-file="openFile"
      :can-handoff="hasPreview"
      :console-count="consoleEntries.length"
      :picking="picking"
      @handoff="onHandoff"
    >
      <template #end><slot name="toolbar-end" /></template>
    </BrowserToolbar>
    <ConsolePopover
      v-if="consoleAnchor"
      :anchor="consoleAnchor"
      :entries="consoleEntries"
      :trigger="toolbar?.handoffButton"
      @insert="insertConsole"
      @clear="consoleEntries = []"
      @close="consoleAnchor = null"
    />
    <p v-if="picking" class="flex shrink-0 items-center gap-1.5 border-b border-line bg-accent-soft px-3 py-1.5 text-xs text-accent-ink" role="status">
      <MousePointerClick :size="13" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ t('workspace.handoff.picking') }}</span>
      <button type="button" class="ccm-btn-plain shrink-0 text-xs text-accent-ink" @click="cancelPick">{{ t('workspace.handoff.cancelPick') }}</button>
    </p>
    <Transition name="ccm-fade">
      <p v-if="handoffNote && !picking" class="flex shrink-0 items-center gap-1.5 border-b border-line bg-raised px-3 py-1.5 text-xs text-ink" role="status">
        <span class="min-w-0 truncate">{{ handoffNote }}</span>
      </p>
    </Transition>
    <p v-if="notice && !(denied && !initialSrc)" class="flex shrink-0 items-center gap-1.5 border-b border-line bg-st-waiting-soft px-3 py-1.5 text-xs text-ink" role="status">
      <CircleAlert :size="13" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ notice }}</span>
      <AccessPrompt v-if="denied" :path="denied" compact class="ml-auto" @granted="open(denied!)" />
    </p>
    <div ref="stage" class="relative min-h-0 flex-1 overflow-hidden" :class="frame ? 'bg-canvas' : 'bg-surface'">
      <div v-if="!hasPreview" class="grid size-full place-items-center p-6 text-center text-sm text-ink-muted">{{ t('workspace.browser.unavailable') }}</div>
      <div v-else-if="denied && !initialSrc" class="grid size-full place-items-center p-6" data-access-denied>
        <div class="flex max-w-sm min-w-0 flex-col items-center gap-2 text-center">
          <Lock :size="26" class="text-ink-muted" aria-hidden="true" />
          <p class="text-sm font-semibold text-ink">{{ t('workspace.browser.notAllowed') }}</p>
          <p class="max-w-full truncate font-mono text-2xs text-ink-faint" :title="denied">{{ denied }}</p>
          <AccessPrompt :path="denied" @granted="open(denied!)" />
        </div>
      </div>
      <div v-else-if="!initialSrc" class="grid size-full place-items-center p-6">
        <div class="flex max-w-xs flex-col items-center gap-3 text-center">
          <Globe :size="28" class="text-agent-browser" aria-hidden="true" />
          <p class="text-sm text-ink-muted">{{ t('workspace.browser.empty') }}</p>
          <button type="button" class="ccm-btn" @click="openFile">{{ t('workspace.browser.openFile') }}</button>
        </div>
      </div>
      <div
        v-else
        class="browser-frame absolute origin-center overflow-hidden bg-page"
        :class="frame ? 'rounded-control shadow-pop' : ''"
        :style="frameStyle"
      >
        <webview ref="webview" :src="initialSrc" :partition="PARTITION" class="size-full" />
      </div>
      <Transition name="ccm-fade">
        <div v-if="failure" class="absolute inset-0 grid place-items-center bg-surface p-6" role="alert">
          <div class="flex max-w-sm flex-col items-center gap-2 text-center">
            <CircleAlert :size="24" class="text-st-error" aria-hidden="true" />
            <p class="text-sm font-semibold text-ink">{{ t('workspace.browser.loadFailed', { url: failure.url }) }}</p>
            <p class="break-all font-mono text-2xs text-ink-faint">{{ failure.error }}</p>
            <button type="button" class="ccm-btn mt-1" @click="reload">{{ t('workspace.browser.retry') }}</button>
          </div>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
/* Frame resizes on device change animate as a transform only (never width/height). */
.browser-frame {
  transition: transform var(--ccm-dur-base, 220ms) var(--ease-out-quint, cubic-bezier(0.22, 1, 0.36, 1));
}
</style>
