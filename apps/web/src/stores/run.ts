import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import {
  isRunLive,
  type BuildError,
  type EnvIssue,
  type RunCommandPreview,
  type RunConfig,
  type RunDetectResult,
  type RunDevice,
  type RunEmulator,
  type RunEnv,
  type RunEvent,
  type RunLogLine,
  type RunProject,
  type RunResult,
  type RunSession,
  type RunState,
  type RunStream,
} from '@ccm/shared'
import { desktop, type RunSettings } from '../lib/desktop'
import { agentPaneFor, errorPrompt, inRoot } from '../lib/runUi'
import { dirKey } from './favorites'
import { useWorkspaceStore } from './workspace'

export { inRoot }

export const LOG_CAP = 5000
export const ERROR_CAP = 500
const ENDED_KEEP = 20
const FLUSH_MS = 60
const SELECTED_KEY = 'ccm.run.selected'

export interface RunSelection {
  config?: string
  device?: string
}

/** States where the build pipeline owns the session: Run waits, Stop cancels. */
export const RUN_BUSY_STATES: readonly RunState[] = ['before-launch', 'building', 'installing', 'launching', 'stopping']

/** A Flutter app (or plugin with `example/`) or an Android project with a runnable module. */
export function isRunnable(p: RunProject): boolean {
  if (p.kind === 'flutter') return p.type === 'app' || !!p.example
  return p.status === 'runnable' || p.modules.some((m) => m.launcher)
}

function loadSelected(): Record<string, RunSelection> {
  try {
    const raw = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, RunSelection> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const { config, device } = v as Record<string, unknown>
      out[k] = { config: typeof config === 'string' ? config : undefined, device: typeof device === 'string' ? device : undefined }
    }
    return out
  } catch {
    return {}
  }
}

const failed = (code: string): RunResult => ({ ok: false, error: { code } })

export const useRunStore = defineStore('run', () => {
  const projects = ref<Record<string, RunDetectResult>>({})
  const configs = ref<Record<string, RunConfig[]>>({})
  const envs = ref<Record<string, RunEnv | null>>({})
  const devices = ref<RunDevice[]>([])
  const devicesLoaded = ref(false)
  const emulators = ref<RunEmulator[]>([])
  const sessions = ref<Record<string, RunSession>>({})
  /** Session the bar's buttons and the log target, per project root. Runtime only. */
  const focus = ref<Record<string, string>>({})
  /** Last start / pub get refusal per project root, shown above the log. */
  const notices = ref<Record<string, EnvIssue | null>>({})
  const selected = ref<Record<string, RunSelection>>(loadSelected())
  /** Sessions picked up after a renderer reload: main keeps no log history, so their earlier output is gone. */
  const restored = ref<Record<string, true>>({})
  const isRestored = (sessionId: string): boolean => !!restored.value[sessionId]

  // Plain arrays behind a version counter: a log burst must not walk 5000 reactive rows.
  const logs = shallowRef(new Map<string, RunLogLine[]>())
  const errors = shallowRef(new Map<string, BuildError[]>())
  const logVersion = ref(0)
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flushLogs(): void {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    logVersion.value++
  }

  function scheduleFlush(): void {
    flushTimer ??= setTimeout(flushLogs, FLUSH_MS)
  }

  function appendLines(sessionId: string, lines: RunLogLine[]): void {
    if (!lines.length) return
    let list = logs.value.get(sessionId)
    if (!list) logs.value.set(sessionId, (list = []))
    for (const l of lines) list.push(l)
    if (list.length > LOG_CAP) list.splice(0, list.length - LOG_CAP)
    scheduleFlush()
  }

  function addError(sessionId: string, error: BuildError): void {
    let list = errors.value.get(sessionId)
    if (!list) errors.value.set(sessionId, (list = []))
    const same = list.some((e) => e.file === error.file && e.line === error.line && e.col === error.col && e.message === error.message)
    if (same) return
    list.push(error)
    if (list.length > ERROR_CAP) list.splice(0, list.length - ERROR_CAP)
    scheduleFlush()
  }

  function dropOutput(sessionId: string): void {
    logs.value.delete(sessionId)
    errors.value.delete(sessionId)
  }

  function putSession(next: RunSession): void {
    sessions.value[next.id] = next
    pruneEnded()
  }

  function pruneEnded(): void {
    const ended = Object.values(sessions.value)
      .filter((s) => !isRunLive(s.state))
      .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
    for (const s of ended.slice(ENDED_KEEP)) {
      delete sessions.value[s.id]
      delete restored.value[s.id]
      dropOutput(s.id)
      for (const [root, id] of Object.entries(focus.value)) if (id === s.id) delete focus.value[root]
    }
  }

  function handleEvent(event: RunEvent): void {
    switch (event.type) {
      case 'session':
        putSession(event.session)
        break
      // The session event always comes first; output for an unknown id would never be pruned.
      case 'log':
        if (sessions.value[event.sessionId]) appendLines(event.sessionId, event.lines)
        break
      case 'error':
        if (sessions.value[event.sessionId]) addError(event.sessionId, event.error)
        break
      case 'devices':
        devices.value = event.devices
        devicesLoaded.value = true
        break
      case 'projects':
        projects.value[dirKey(event.result.root)] = event.result
        break
      case 'configs':
        configs.value[dirKey(event.root)] = event.configs
        break
    }
  }

  let subscribed = false
  let devicesAsked = false

  /** Subscribes once and loads live sessions; devices start only when a run pane asks (trackers are lazy). */
  async function ensure(withDevices = false): Promise<void> {
    if (!subscribed && desktop?.onRunEvent) {
      subscribed = true
      desktop.onRunEvent(handleEvent)
      const list = await desktop.runSessions?.().catch(() => []) ?? []
      for (const s of list) {
        if (sessions.value[s.id]) continue
        putSession(s)
        restored.value[s.id] = true
      }
    }
    if (withDevices && !devicesAsked) {
      devicesAsked = true
      await refreshDevices()
    }
  }

  async function detect(root: string): Promise<RunDetectResult | null> {
    const res = await desktop?.runDetect?.(root).catch(() => null) ?? null
    if (res) projects.value[dirKey(root)] = res
    return res
  }

  const projectsFor = (root: string): RunProject[] => projects.value[dirKey(root)]?.projects ?? []
  const detected = (root: string): boolean => !!projects.value[dirKey(root)]
  const runnable = (root: string): boolean => projectsFor(root).some(isRunnable)

  async function loadConfigs(root: string): Promise<RunConfig[]> {
    const list = await desktop?.runConfigs?.(root).catch(() => []) ?? []
    configs.value[dirKey(root)] = list
    return list
  }

  const configsFor = (root: string): RunConfig[] => configs.value[dirKey(root)] ?? []

  // Plain copies: a reactive proxy is not IPC-cloneable.
  async function saveConfig(root: string, cfg: RunConfig): Promise<RunConfig | null> {
    return await desktop?.runConfigSave?.(root, JSON.parse(JSON.stringify(cfg)) as RunConfig).catch(() => null) ?? null
  }

  async function deleteConfig(root: string, id: string): Promise<boolean> {
    return await desktop?.runConfigDelete?.(root, id).catch(() => false) ?? false
  }

  async function importConfigs(root: string): Promise<RunConfig[]> {
    return await desktop?.runConfigImport?.(root).catch(() => []) ?? []
  }

  const envKey = (dir: string, kind: string): string => `${kind}:${dirKey(dir)}`
  const envDirs: Record<string, { dir: string; kind: 'flutter' | 'android' }> = {}

  async function loadEnv(dir: string, kind: 'flutter' | 'android', force = false): Promise<RunEnv | null> {
    const key = envKey(dir, kind)
    envDirs[key] = { dir, kind }
    if (!force && key in envs.value) return envs.value[key] ?? null
    const env = await desktop?.runEnv?.(dir, kind).catch(() => null) ?? null
    envs.value[key] = env
    return env
  }

  const envFor = (dir: string, kind: string): RunEnv | null => envs.value[envKey(dir, kind)] ?? null

  /** SDK / JDK folders set by the user; null field = auto-detect. */
  const settings = ref<RunSettings | null>(null)

  async function loadSettings(): Promise<RunSettings | null> {
    settings.value = await desktop?.runSettings?.().catch(() => null) ?? settings.value
    return settings.value
  }

  /** Saves, then re-checks every env already shown so banners clear (or appear) right away. */
  async function updateSettings(patch: Partial<RunSettings>): Promise<RunSettings | null> {
    const next = await desktop?.runSettingsSet?.(patch).catch(() => null) ?? null
    if (!next) return null
    settings.value = next
    const shown = Object.entries(envDirs)
    await Promise.all(shown.map(([, v]) => loadEnv(v.dir, v.kind, true)))
    return next
  }

  async function refreshDevices(): Promise<void> {
    const list = await desktop?.runDevices?.().catch(() => null)
    if (list) devices.value = list
    devicesLoaded.value = true
  }

  async function loadEmulators(): Promise<RunEmulator[]> {
    emulators.value = await desktop?.runEmulators?.().catch(() => []) ?? []
    return emulators.value
  }

  async function launchEmulator(e: RunEmulator, root?: string): Promise<RunResult> {
    return report(root, await desktop?.runLaunchEmulator?.(e.id, e.source).catch(() => failed('emulator-launch')) ?? failed('emulator-launch'))
  }

  /** A refused action shows above the log of `root`'s pane; success clears it. */
  function report(root: string | undefined, res: RunResult): RunResult {
    if (root) notices.value[dirKey(root)] = res.ok ? null : res.error
    return res
  }

  function persistSelected(): void {
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(selected.value))
    } catch {
      // storage blocked: the pick is just not remembered
    }
  }

  function select(root: string, patch: RunSelection): void {
    const key = dirKey(root)
    selected.value[key] = { ...selected.value[key], ...patch }
    persistSelected()
  }

  /** Saved pick when it still exists, else the first config. */
  function selectedConfig(root: string): RunConfig | null {
    const list = configsFor(root)
    const id = selected.value[dirKey(root)]?.config
    return list.find((c) => c.id === id) ?? list[0] ?? null
  }

  /** Devices a config can target: adb for Android, the Flutter daemon's list for Flutter. */
  function devicesFor(cfg: RunConfig | null): RunDevice[] {
    if (!cfg || cfg.type === 'custom') return []
    if (cfg.type === 'android') {
      const list = devices.value.filter((d) => d.platform.startsWith('android'))
      const adb = new Set(list.filter((d) => d.source === 'adb').map((d) => d.id))
      return list.filter((d) => d.source === 'adb' || !adb.has(d.id))
    }
    const flutter = devices.value.filter((d) => d.source === 'flutter')
    return flutter.length ? flutter : devices.value
  }

  function selectedDevice(root: string, cfg: RunConfig | null = selectedConfig(root)): RunDevice | null {
    const list = devicesFor(cfg)
    const id = selected.value[dirKey(root)]?.device
    return list.find((d) => d.id === id) ?? list.find((d) => d.state === 'ready') ?? null
  }

  /** Newest first. */
  function sessionsFor(root: string): RunSession[] {
    return Object.values(sessions.value)
      .filter((s) => inRoot(s.cwd, root))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  const liveSessionsFor = (root: string): RunSession[] => sessionsFor(root).filter((s) => isRunLive(s.state))

  /** The one session per (config, device): the owner's rule for parallel runs. */
  function sessionOf(root: string, configId: string, deviceId: string | null): RunSession | null {
    return sessionsFor(root).find((s) => s.configId === configId && (s.deviceId ?? null) === deviceId) ?? null
  }

  /** Picked in the switcher, else the newest live one, else the newest. */
  function focusedSession(root: string): RunSession | null {
    const picked = focus.value[dirKey(root)]
    const list = sessionsFor(root)
    return list.find((s) => s.id === picked) ?? list.find((s) => isRunLive(s.state)) ?? list[0] ?? null
  }

  function focusSession(root: string, id: string): void {
    focus.value[dirKey(root)] = id
  }

  function linesFor(sessionId: string, streams?: readonly RunStream[]): RunLogLine[] {
    const list = logs.value.get(sessionId) ?? []
    return streams ? list.filter((l) => streams.includes(l.stream)) : list
  }

  const errorsFor = (sessionId: string): BuildError[] => errors.value.get(sessionId) ?? []

  function clearLog(sessionId: string, streams: readonly RunStream[]): void {
    const list = logs.value.get(sessionId)
    if (!list) return
    logs.value.set(sessionId, list.filter((l) => !streams.includes(l.stream)))
    if (streams.includes('build')) errors.value.delete(sessionId)
    flushLogs()
  }

  async function start(root: string): Promise<RunResult> {
    const cfg = selectedConfig(root)
    if (!cfg) return failed('spawn')
    const device = cfg.type === 'custom' ? null : selectedDevice(root, cfg)
    const res = await desktop?.runStart?.({ root, configId: cfg.id, deviceId: device?.id ?? null }).catch(() => failed('spawn')) ?? failed('spawn')
    notices.value[dirKey(root)] = res.ok ? null : res.error
    if (res.ok && res.sessionId) focusSession(root, res.sessionId)
    return res
  }

  async function stop(sessionId: string, root?: string): Promise<RunResult> {
    return report(root, await desktop?.runStop?.(sessionId).catch(() => failed('session-missing')) ?? failed('session-missing'))
  }

  async function reload(sessionId: string, full: boolean, root?: string): Promise<RunResult> {
    return report(root, await desktop?.runReload?.(sessionId, full).catch(() => failed('reload-failed')) ?? failed('reload-failed'))
  }

  /** Re-detects afterwards so the "needs pub get" banner clears. */
  async function pubGet(root: string, dir: string): Promise<RunResult> {
    const res = await desktop?.runPubGet?.(dir).catch(() => failed('spawn')) ?? failed('spawn')
    notices.value[dirKey(root)] = res.ok ? null : res.error
    if (res.ok) await detect(root)
    return res
  }

  async function preview(root: string, cfg: RunConfig, deviceId: string | null): Promise<RunCommandPreview | null> {
    return await desktop?.runPreview?.(root, cfg, deviceId).catch(() => null) ?? null
  }

  const noticeFor = (root: string): EnvIssue | null => notices.value[dirKey(root)] ?? null
  const dismissNotice = (root: string): void => void (notices.value[dirKey(root)] = null)

  /** Pastes `@file:line:col message` into the input of the project's Claude / Codex pane (no Enter); false = no such pane. */
  function sendErrorToAgent(error: BuildError, root: string): boolean {
    const workspace = useWorkspaceStore()
    const pane = agentPaneFor(workspace.panes, root)
    if (!pane) return false
    workspace.insertInto(pane.key, errorPrompt(error, pane.cwd, desktop?.platform === 'win32'))
    return true
  }

  return {
    projects,
    configs,
    devices,
    devicesLoaded,
    emulators,
    sessions,
    selected,
    logVersion,
    handleEvent,
    flushLogs,
    ensure,
    detect,
    detected,
    projectsFor,
    runnable,
    loadConfigs,
    configsFor,
    saveConfig,
    deleteConfig,
    importConfigs,
    loadEnv,
    envFor,
    refreshDevices,
    loadEmulators,
    launchEmulator,
    select,
    selectedConfig,
    devicesFor,
    selectedDevice,
    sessionsFor,
    liveSessionsFor,
    sessionOf,
    focusedSession,
    focusSession,
    linesFor,
    errorsFor,
    isRestored,
    clearLog,
    start,
    stop,
    reload,
    pubGet,
    preview,
    noticeFor,
    dismissNotice,
    sendErrorToAgent,
    settings,
    loadSettings,
    updateSettings,
  }
})
