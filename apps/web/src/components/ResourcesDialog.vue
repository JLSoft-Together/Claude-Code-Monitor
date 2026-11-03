<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Check,
  Copy,
  Cpu,
  Globe,
  Hammer,
  Hourglass,
  LoaderCircle,
  Plug,
  Server,
  Smartphone,
  SquareTerminal,
  TriangleAlert,
  Unlink,
  X,
  CircleSlash,
  Bot,
  Activity,
} from 'lucide-vue-next'
import type { ResKillTarget, ServerRes, SessionRes } from '@ccm/shared'
import { now, relativeTime } from '../lib/format'
import { retireOverlay } from '../lib/motion'
import { formatBytes, formatCpu, hasResKill, isBusyDaemon, isDaemonKind, localUrl, portRows, resKill, spanParts, type PortRow, type ResTab } from '../lib/resources'
import { projectOf } from '../lib/sidebarRows'
import { displayTitle } from '../lib/title'
import { hasTerminals } from '../lib/desktop'
import { useConnectionStore } from '../stores/connection'
import { useResourcesStore } from '../stores/resources'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'
import SegmentedControl from './ui/SegmentedControl.vue'

const { t, locale } = useI18n()
const res = useResourcesStore()
const terminals = useTerminalsStore()
const connection = useConnectionStore()
const ui = useUiStore()
const workspace = useWorkspaceStore()

const dialog = ref<HTMLElement | null>(null)
const report = computed(() => res.report)
let restoreFocus: HTMLElement | null = null

const ram = (b: number | null | undefined): string => formatBytes(b, locale.value)
const cpu = (p: number | null | undefined): string => formatCpu(p, locale.value)
const span = (since: number | null): string => {
  if (since === null) return ''
  const s = spanParts(now.value - since)
  return t(`resources.span.${s.unit}`, { a: s.a, b: s.b })
}
const sessionName = (id: string | null): string => {
  const term = id ? terminals.byId[id] : undefined
  return term ? displayTitle(term) : (id ?? '')
}
const sessionProject = (id: string): string => projectOf(terminals.byId[id]?.cwd) ?? ''

const sessions = computed(() => (report.value?.sessions ?? []).filter((s) => !res.onlyForgotten || s.forgotten))
const servers = computed(() => (report.value?.servers ?? []).filter((s) => !isDaemonKind(s.kind) && (!res.onlyForgotten || s.forgotten)))
const daemons = computed(() => (report.value?.servers ?? []).filter((s) => isDaemonKind(s.kind) && (!res.onlyForgotten || s.forgotten)))
const ports = computed(() => portRows(report.value).filter((p) => !res.onlyForgotten || p.server?.forgotten))

const counts = computed(() => ({
  sessions: report.value?.sessions.length ?? 0,
  servers: (report.value?.servers ?? []).filter((s) => !isDaemonKind(s.kind)).length,
  daemons: (report.value?.servers ?? []).filter((s) => isDaemonKind(s.kind)).length,
  ports: portRows(report.value).length,
}))
const tabOptions = computed(() =>
  (['sessions', 'servers', 'daemons', 'ports'] as ResTab[]).map((v) => ({ value: v, label: `${t(`resources.tabs.${v}`)} ${counts.value[v]}` })),
)

const paneOf = (sessionId: string) => (hasTerminals ? workspace.paneByTerminal.get(sessionId) : undefined)

const forgottenTargets = computed(() => {
  const r = report.value
  if (!r) return { targets: [] as ResKillTarget[], panes: 0 }
  const targets: ResKillTarget[] = []
  let panes = 0
  for (const s of r.sessions) {
    if (!s.forgotten || !s.start) continue
    if (paneOf(s.sessionId)) panes++
    else targets.push({ pid: s.pid, start: s.start, label: sessionName(s.sessionId) })
  }
  for (const s of r.servers) if (s.forgotten && s.start && !isBusyDaemon(s, now.value)) targets.push({ pid: s.pid, start: s.start, label: serverLabel(s) })
  return { targets: targets.slice(0, 50), panes }
})

function serverLabel(s: ServerRes): string {
  const d = s.daemon
  if (!d) return s.name
  const v = d.type === 'emulator' ? (d.avd ?? d.serial ?? '') : (d.version ?? '')
  return t(`resources.daemon.${d.type}`, { v }).trim()
}

const KIND_ICON: Record<string, Component> = { shell: SquareTerminal, 'dev-server': Globe, other: Server, daemon: Hammer, emulator: Smartphone }

type Badge = { key: 'forgotten' | 'orphan' | 'building' | 'outside' | 'unknown' | 'active'; icon: Component; cls: string }
function badgeOf(row: { forgotten: boolean; orphan?: boolean; cpuPct: number | null; kind?: ServerRes['kind']; lastBusyAt?: number | null }): Badge {
  if (row.orphan) return { key: 'orphan', icon: Unlink, cls: 'text-warning' }
  if (row.forgotten) return { key: 'forgotten', icon: Hourglass, cls: 'text-warning' }
  if (row.kind && isBusyDaemon({ kind: row.kind, lastBusyAt: row.lastBusyAt ?? null }, now.value)) return { key: 'building', icon: Hammer, cls: 'text-ink-muted' }
  if (row.cpuPct === null) return { key: 'unknown', icon: CircleSlash, cls: 'text-ink-faint' }
  return { key: 'active', icon: Activity, cls: 'text-ink-muted' }
}
const badgeHint = (b: Badge): string => (b.key === 'active' ? '' : t(`resources.stateHint.${b.key}`, { n: report.value?.idleMinutes ?? 60 }))

const busy = ref(false)
const message = ref<{ text: string; ok: boolean } | null>(null)

async function stop(targets: ResKillTarget[]): Promise<void> {
  if (!targets.length || busy.value) return
  busy.value = true
  message.value = null
  const r = await resKill(targets)
  busy.value = false
  if (r.ok) message.value = { text: t('resources.result.ok', { n: r.killed }, r.killed), ok: true }
  else if (r.error !== 'cancelled') message.value = { text: t(`resources.result.${r.error}`), ok: false }
}

function stopSession(s: SessionRes): void {
  const pane = paneOf(s.sessionId)
  if (pane) {
    res.open = false
    ui.setView('workspace')
    workspace.activate(pane.key)
    // Same path as closing the pane by hand: the busy-pane sheet asks, undo close brings the agent back with --resume.
    workspace.requestClose([pane.key], () => true)
    return
  }
  if (s.start) void stop([{ pid: s.pid, start: s.start, label: sessionName(s.sessionId) }])
}

const stopServer = (s: ServerRes): Promise<void> => stop([{ pid: s.pid, start: s.start, label: serverLabel(s) }])

function openUrl(port: number): void {
  res.open = false
  ui.setView('workspace')
  workspace.openBrowser(localUrl(port))
}

const copiedKey = ref<string | null>(null)
async function copyUrl(row: PortRow): Promise<void> {
  try {
    await navigator.clipboard.writeText(localUrl(row.port))
    copiedKey.value = row.key
    window.setTimeout(() => copiedKey.value === row.key && (copiedKey.value = null), 1500)
  } catch {
    copiedKey.value = null
  }
}

const sampledAgo = computed(() => relativeTime(report.value?.at, locale.value, now.value) ?? '')

function conflictText(c: { port: number; holder: { name: string; sessionId: string | null } | null }): string {
  if (!c.holder) return t('resources.conflictUnknown', { port: c.port })
  if (c.holder.sessionId) return t('resources.conflictSession', { port: c.port, holder: c.holder.name, session: sessionName(c.holder.sessionId) })
  return t('resources.conflict', { port: c.port, holder: c.holder.name })
}

function close(): void {
  res.open = false
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => res.open,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      message.value = null
      await nextTick()
      const focus = res.focusPort !== null ? dialog.value?.querySelector<HTMLElement>(`[data-res-port="${res.focusPort}"]`) : null
      if (focus) {
        focus.scrollIntoView({ block: 'center' })
        focus.focus()
      } else dialog.value?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="res.open" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ccm-scrim px-4 py-[5vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="res-title"
          class="flex max-h-[90vh] w-full max-w-[880px] min-w-0 flex-col ccm-sheet"
          data-resources-dialog
          @keydown="trap"
        >
          <div class="flex items-start gap-2 border-b border-line px-5 py-4">
            <Cpu :size="18" class="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="res-title" class="text-base font-semibold">{{ t('resources.title') }}</h2>
              <p v-if="report" class="text-2xs text-ink-muted tabular">
                {{ t('resources.summary', { ram: ram(report.totals.ramBytes), cpu: cpu(report.totals.cpuPct) }) }}<template v-if="report.totals.forgotten">.
                  <span class="text-warning">{{ t('resources.summaryForgotten', { n: report.totals.forgotten, ram: ram(report.totals.forgottenRamBytes) }, report.totals.forgotten) }}</span></template
                ><template v-if="sampledAgo">, {{ t('resources.sampled', { ago: sampledAgo }) }}</template>
              </p>
            </div>
            <button type="button" class="ccm-btn-plain" :aria-label="t('resources.close')" :title="t('resources.close')" @click="close">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <p v-if="connection.state !== 'connected' && !report" class="px-5 py-6 text-sm text-st-error">{{ t('resources.offline') }}</p>
          <p v-else-if="!report" class="px-5 py-6 text-sm text-ink-muted">{{ t('resources.noData') }}</p>
          <template v-else>
            <ul v-if="res.conflicts.length" class="flex flex-col gap-1 border-b border-line px-5 py-2" aria-label="conflicts">
              <li v-for="c in res.conflicts" :key="`${c.sessionId}|${c.port}|${c.at}`" class="flex flex-wrap items-center gap-2 rounded-inner bg-warning-soft px-3 py-1.5 text-xs" data-res-conflict>
                <TriangleAlert :size="14" class="shrink-0 text-warning" aria-hidden="true" />
                <span class="min-w-0 flex-1 text-ink">{{ conflictText(c) }}</span>
                <button type="button" class="ccm-btn h-6 text-2xs" @click="res.show('ports', c.port)">{{ t('resources.conflictShow') }}</button>
                <button type="button" class="ccm-btn-plain h-6 text-2xs" @click="res.dismissConflict(c)">{{ t('resources.conflictDismiss') }}</button>
              </li>
            </ul>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
              <SegmentedControl v-model="res.tab" :options="tabOptions" :label="t('resources.tabs.label')" class="max-w-full overflow-hidden" />
              <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                <input v-model="res.onlyForgotten" type="checkbox" class="size-3.5 accent-(--ccm-accent)" data-res-only-forgotten />
                {{ t('resources.onlyForgotten') }}
              </label>
              <button
                v-if="hasResKill"
                type="button"
                class="ccm-btn-danger ml-auto"
                :disabled="busy || !forgottenTargets.targets.length"
                :title="t('resources.stopAllHint')"
                data-res-stop-all
                @click="stop(forgottenTargets.targets)"
              >
                <LoaderCircle v-if="busy" :size="14" class="ccm-spin" aria-hidden="true" />
                {{ t('resources.stopAll', { n: forgottenTargets.targets.length }) }}
              </button>
            </div>
            <p v-if="forgottenTargets.panes" class="-mt-1 px-5 pb-2 text-2xs text-ink-muted">{{ t('resources.stopAllPanes', { n: forgottenTargets.panes }, forgottenTargets.panes) }}</p>
            <p v-if="message" role="status" class="px-5 pb-2 text-xs" :class="message.ok ? 'text-success' : 'text-st-error'" data-res-message>{{ message.text }}</p>

            <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto border-t border-line px-5">
              <template v-if="res.tab === 'sessions'">
                <p v-if="!sessions.length" class="py-6 text-sm text-ink-muted">{{ res.onlyForgotten ? t('resources.empty.forgotten') : t('resources.empty.sessions') }}</p>
                <ul v-else class="divide-y divide-line">
                  <li v-for="s in sessions" :key="s.sessionId" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" :data-res-session="s.sessionId">
                    <Bot :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
                    <div class="min-w-0 flex-1 basis-52">
                      <p class="truncate text-sm font-medium text-ink" :title="sessionName(s.sessionId)">{{ sessionName(s.sessionId) }}</p>
                      <p class="truncate text-2xs text-ink-faint">{{ [sessionProject(s.sessionId), s.name, `pid ${s.pid}`].filter(Boolean).join(', ') }}</p>
                    </div>
                    <span class="inline-flex shrink-0 items-center gap-1 text-2xs" :class="badgeOf(s).cls" :title="badgeHint(badgeOf(s))">
                      <component :is="badgeOf(s).icon" :size="12" aria-hidden="true" />{{ t(`resources.state.${badgeOf(s).key}`) }}<template v-if="s.idleSinceMs !== null">, {{ t('resources.idleFor', { span: span(s.idleSinceMs) }) }}</template>
                    </span>
                    <span class="w-16 shrink-0 text-right text-xs text-ink tabular" :title="t('resources.col.ram')">{{ ram(s.ramBytes) }}</span>
                    <span class="w-14 shrink-0 text-right text-xs text-ink-muted tabular" :title="t('resources.col.cpu')">{{ cpu(s.cpuPct) }}</span>
                    <button
                      v-if="paneOf(s.sessionId)"
                      type="button"
                      class="ccm-btn h-6 shrink-0 text-2xs"
                      :title="t('resources.closePaneTitle')"
                      @click="stopSession(s)"
                    >
                      {{ t('resources.closePane') }}
                    </button>
                    <button
                      v-else-if="hasResKill && s.start"
                      type="button"
                      class="ccm-btn h-6 shrink-0 text-2xs text-st-error"
                      :disabled="busy"
                      :title="t('resources.stopTitle', { name: sessionName(s.sessionId) })"
                      @click="stopSession(s)"
                    >
                      {{ t('resources.stop') }}
                    </button>
                  </li>
                </ul>
              </template>

              <template v-else-if="res.tab === 'servers' || res.tab === 'daemons'">
                <p v-if="!(res.tab === 'servers' ? servers : daemons).length" class="py-6 text-sm text-ink-muted">
                  {{ res.onlyForgotten ? t('resources.empty.forgotten') : t(`resources.empty.${res.tab}`) }}
                </p>
                <ul v-else class="divide-y divide-line">
                  <li v-for="s in res.tab === 'servers' ? servers : daemons" :key="`${s.pid}:${s.start}`" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" :data-res-server="s.pid">
                    <component :is="KIND_ICON[s.kind] ?? Server" :size="16" class="shrink-0 text-ink-muted" :aria-label="t(`resources.kind.${s.kind}`)" />
                    <div class="min-w-0 flex-1 basis-52">
                      <p class="flex min-w-0 items-baseline gap-2 text-sm">
                        <span class="truncate font-medium text-ink">{{ serverLabel(s) }}</span>
                        <span v-for="p in s.ports" :key="p.port" class="shrink-0 rounded-inner bg-fill px-1 text-2xs text-ink-muted tabular">:{{ p.port }}</span>
                      </p>
                      <p class="truncate text-2xs text-ink-faint" :title="s.cmd">
                        {{
                          [
                            s.daemon?.jdk ? t('resources.jdk', { v: s.daemon.jdk }) : '',
                            s.sessionId ? (s.daemon ? t('resources.lastSession', { name: sessionName(s.sessionId) }) : sessionName(s.sessionId)) : s.daemon ? '' : t('resources.noSession'),
                            s.cmd || s.name,
                          ]
                            .filter(Boolean)
                            .join(', ')
                        }}
                      </p>
                    </div>
                    <span class="inline-flex shrink-0 items-center gap-1 text-2xs" :class="badgeOf(s).cls" :title="badgeHint(badgeOf(s))">
                      <component :is="badgeOf(s).icon" :size="12" aria-hidden="true" />{{ t(`resources.state.${badgeOf(s).key}`) }}<template v-if="s.idleSinceMs !== null && !s.orphan">, {{ t('resources.idleFor', { span: span(s.idleSinceMs) }) }}</template>
                    </span>
                    <span class="w-16 shrink-0 text-right text-xs text-ink tabular" :title="t('resources.col.ram')">{{ ram(s.ramBytes) }}</span>
                    <span class="w-14 shrink-0 text-right text-xs text-ink-muted tabular" :title="t('resources.col.cpu')">{{ cpu(s.cpuPct) }}</span>
                    <button
                      v-if="hasResKill && s.start"
                      type="button"
                      class="ccm-btn h-6 shrink-0 text-2xs text-st-error"
                      :disabled="busy || isBusyDaemon(s, now)"
                      :title="isBusyDaemon(s, now) ? t('resources.stateHint.building') : t('resources.stopTitle', { name: serverLabel(s) })"
                      @click="stopServer(s)"
                    >
                      {{ t('resources.stop') }}
                    </button>
                  </li>
                </ul>
              </template>

              <template v-else>
                <p v-if="!ports.length" class="py-6 text-sm text-ink-muted">{{ res.onlyForgotten ? t('resources.empty.forgotten') : t('resources.empty.ports') }}</p>
                <ul v-else class="divide-y divide-line">
                  <li
                    v-for="p in ports"
                    :key="p.key"
                    class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-inner py-2 outline-2 -outline-offset-2 outline-transparent focus-visible:outline-accent"
                    :class="res.focusPort === p.port ? 'bg-accent-soft' : ''"
                    :tabindex="res.focusPort === p.port ? 0 : -1"
                    :data-res-port="p.port"
                  >
                    <Plug :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
                    <span class="w-14 shrink-0 font-mono text-sm font-medium text-ink tabular">{{ p.port }}</span>
                    <div class="min-w-0 flex-1 basis-44">
                      <p class="truncate text-sm text-ink">{{ p.name || `pid ${p.pid}` }}</p>
                      <p class="truncate text-2xs text-ink-faint">{{ [p.address, p.sessionId ? sessionName(p.sessionId) : ''].filter(Boolean).join(', ') }}</p>
                    </div>
                    <span v-if="!p.server" class="inline-flex shrink-0 items-center gap-1 text-2xs text-ink-faint" :title="t('resources.stateHint.outside')">
                      <CircleSlash :size="12" aria-hidden="true" />{{ t('resources.state.outside') }}
                    </span>
                    <span v-else-if="p.server.forgotten" class="inline-flex shrink-0 items-center gap-1 text-2xs text-warning" :title="badgeHint(badgeOf(p.server))">
                      <component :is="badgeOf(p.server).icon" :size="12" aria-hidden="true" />{{ t(`resources.state.${badgeOf(p.server).key}`) }}
                    </span>
                    <span class="w-24 shrink-0 text-right text-2xs text-ink-muted tabular">{{ t('resources.connections', { n: p.established }, p.established) }}</span>
                    <span class="flex shrink-0 items-center gap-1">
                      <button v-if="hasTerminals" type="button" class="ccm-btn h-6 text-2xs" :title="t('resources.openUrlTitle', { url: localUrl(p.port) })" @click="openUrl(p.port)">
                        <Globe :size="12" aria-hidden="true" />{{ t('resources.openUrl') }}
                      </button>
                      <button type="button" class="ccm-btn h-6 text-2xs" :title="t('resources.copyTitle', { url: localUrl(p.port) })" @click="copyUrl(p)">
                        <Check v-if="copiedKey === p.key" :size="12" class="ccm-pop text-success" aria-hidden="true" /><Copy v-else :size="12" aria-hidden="true" />
                        {{ copiedKey === p.key ? t('resources.copied') : t('resources.copy') }}
                      </button>
                      <button
                        v-if="hasResKill && p.server && p.server.start"
                        type="button"
                        class="ccm-btn h-6 text-2xs text-st-error"
                        :disabled="busy || isBusyDaemon(p.server, now)"
                        :title="t('resources.stopTitle', { name: serverLabel(p.server) })"
                        @click="stopServer(p.server)"
                      >
                        {{ t('resources.stop') }}
                      </button>
                    </span>
                  </li>
                </ul>
              </template>
            </div>
            <p class="border-t border-line px-5 py-2.5 text-2xs text-ink-faint">{{ t('resources.estimate', { n: report.idleMinutes }) }}</p>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
