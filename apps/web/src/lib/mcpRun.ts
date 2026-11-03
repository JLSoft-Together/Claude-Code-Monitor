import {
  isRunLive,
  MCP_LOG_LINES_MAX,
  runPhase,
  type McpPageResult,
  type McpRunCall,
  type McpRunSessionInfo,
  type RunConfig,
  type RunLogLine,
  type RunSession,
} from '@ccm/shared'
import type { useRunStore } from '../stores/run'
import { crashBlocks } from './runCrash'

type RunStore = ReturnType<typeof useRunStore>
type Call<T extends McpRunCall['tool']> = Extract<McpRunCall, { tool: T }>

const SESSIONS_MAX = 5
const ERRORS_MAX = 20
const ERROR_LINE = /\b(error|exception|fatal|failed|failure)\b/i

/** Main gives the page 5 s to answer; a trust confirm or a slow stop keeps going after we reply `waiting`. */
export const RUN_REPLY_MS = 4_000

const within = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])

export const isErrorLine =(l: RunLogLine): boolean => l.level === 'E' || l.level === 'F' || ERROR_LINE.test(l.text)

/**
 * Page side of run_app / run_status / run_log (docs §11w): the pane's folder is the Run root, configs and devices
 * only from the lists Orrery shows, actions through the same store calls as the Run bar's buttons.
 */
export function createRunCalls(run: RunStore) {
  function lastError(s: RunSession): string | null {
    if (s.failure) return s.failure.detail ? `${s.failure.code}: ${s.failure.detail}` : s.failure.code
    const build = run.errorsFor(s.id).filter((e) => e.severity === 'error').at(-1)
    if (build) return `${build.file}:${build.line}:${build.col} ${build.message}`
    const crash = crashBlocks(run.linesFor(s.id)).at(-1)
    if (crash) return `${crash.exception}${crash.message ? `: ${crash.message}` : ''}`
    if (s.state !== 'failed') return null
    const lines = run.linesFor(s.id)
    for (let i = lines.length - 1; i >= 0; i--) if (isErrorLine(lines[i]!)) return lines[i]!.text
    return null
  }

  const info = (s: RunSession | null | undefined): McpRunSessionInfo | null =>
    s
      ? {
          id: s.id,
          configId: s.configId,
          configName: s.configName,
          type: s.type,
          deviceId: s.deviceId,
          deviceName: s.deviceName,
          state: runPhase(s.state),
          rawState: s.state,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          appId: s.appId,
          lastError: lastError(s),
        }
      : null

  /** Pinned device, else the asked one if this config can target it, else the Run bar's pick; 'device' = not allowed. */
  function deviceFor(root: string, cfg: RunConfig, asked: string | undefined): string | null | 'device' {
    if (cfg.type === 'custom') return null
    if (cfg.device !== 'selected') return asked && asked !== cfg.device ? 'device' : cfg.device
    if (asked) return run.devicesFor(cfg).some((d) => d.id === asked) ? asked : 'device'
    return run.selectedDevice(root, cfg)?.id ?? null
  }

  async function app(call: Call<'run_app'>): Promise<McpPageResult> {
    const root = call.cwd
    const action = call.action
    const out = (session: RunSession | null | undefined, refused?: { code: string; detail?: string }): McpPageResult => ({
      ok: true,
      tool: 'run_app',
      action,
      ...(refused ? { refused } : {}),
      session: info(session),
    })
    await run.ensure(true)
    const configs = await run.loadConfigs(root)
    const cfg = call.config ? configs.find((c) => c.id === call.config) : run.selectedConfig(root)
    if (call.config && !cfg) return out(null, { code: 'config' })
    const device = cfg ? deviceFor(root, cfg, call.device) : null
    if (device === 'device') return out(null, { code: 'device' })
    const pair = cfg ? run.sessionOf(root, cfg.id, device) : null

    if (action === 'stop' || action === 'reload') {
      const target = call.config || call.device ? pair : run.focusedSession(root)
      const live = target && isRunLive(target.state) ? target : !call.config && !call.device ? run.liveSessionsFor(root)[0] : undefined
      if (!live) return out(null, { code: 'no-session' })
      if (action === 'reload' && live.state !== 'running') return out(live, { code: 'not-running' })
      const res = await within(action === 'stop' ? run.stop(live.id, root) : run.reload(live.id, call.full === true, root), RUN_REPLY_MS)
      if (!res) return out(run.sessions[live.id] ?? live, { code: 'waiting' })
      return res.ok ? out(run.sessions[live.id] ?? live) : out(live, res.error)
    }

    if (!cfg) return out(null, { code: 'no-config' })
    if (action === 'start' && pair && isRunLive(pair.state)) return out(pair, { code: 'running' })
    const res = await within(run.startConfig(root, cfg.id, device), RUN_REPLY_MS)
    if (!res) return out(pair, { code: 'waiting' })
    if (!res.ok) return out(pair, res.error)
    return out(res.sessionId ? run.sessions[res.sessionId] : null)
  }

  async function status(call: Call<'run_status'>): Promise<McpPageResult> {
    const root = call.cwd
    await run.ensure(true)
    const configs = await run.loadConfigs(root)
    const selected = run.selectedConfig(root)
    const device = selected ? run.selectedDevice(root, selected) : null
    return {
      ok: true,
      tool: 'run_status',
      configs: configs.map((c) => ({ id: c.id, name: c.name, type: c.type, selected: c.id === selected?.id, ...(c.type !== 'custom' && c.device !== 'selected' ? { device: c.device } : {}) })),
      devices: run.devices.map((d) => ({ serial: d.id, name: d.name, platform: d.platform, state: d.state, selected: d.id === device?.id })),
      sessions: run.sessionsFor(root).slice(0, SESSIONS_MAX).map((s) => info(s)!),
      focused: run.focusedSession(root)?.id ?? null,
    }
  }

  async function log(call: Call<'run_log'>): Promise<McpPageResult> {
    await run.ensure()
    const s = run.focusedSession(call.cwd)
    if (!s) return { ok: true, tool: 'run_log', session: null, lines: [], errors: [], partial: false }
    const n = Math.max(1, Math.min(MCP_LOG_LINES_MAX, Math.floor(call.lines) || 1))
    const all = run.linesFor(s.id)
    const lines = (call.errorsOnly ? all.filter(isErrorLine) : all).slice(-n)
    const errors = run.errorsFor(s.id).filter((e) => !call.errorsOnly || e.severity === 'error').slice(-ERRORS_MAX)
    return {
      ok: true,
      tool: 'run_log',
      session: info(s),
      lines: lines.map((l) => ({ stream: l.stream, ...(l.level ? { level: l.level } : {}), text: l.text })),
      errors: errors.map((e) => ({ file: e.file, line: e.line, col: e.col, message: e.message, severity: e.severity })),
      partial: run.isRestored(s.id),
    }
  }

  return { app, status, log }
}
