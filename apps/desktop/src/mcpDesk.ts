import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import type { ResKillResult, ResKillTarget, ResourceReport } from '@ccm/shared'
import { DESK_ERRORS, DIAG_MAX, type McpDeskCall, type McpDeskError, type McpDeskResult } from '../../../packages/shared/src/mcpDesk'
import { isInsideOrSame } from './agentData/fsTree'
import { SHOT_MAX_BYTES } from './capture/files'
import type { AgentRenderOutcome } from './layout/ipc'
import type { LayoutDevice } from './layout/types'
import { paneScope, planFreePort, serversFor } from './resources/agentPorts'
import type { ProcRow } from './run/proc'
import { stringsFor } from './strings'
import type { TelegramNotifier } from './telegram/notifier'

export interface DeskDeps {
  render: ((file: string, opts: { device: LayoutDevice; night: boolean; slot: string }) => Promise<AgentRenderOutcome>) | null
  /** Capture folder `shots/` (v76 R4); null when the owner picked none. */
  writeShot: (png: Buffer, name: string) => Promise<string | null>
  /** Used without a capture folder. */
  fallbackDir: string
  report: () => ResourceReport | null
  procRows: () => Promise<ProcRow[] | null>
  home: string
  locale: () => string
  /** Resources v76 stop path (pid + creation time re-checked, one native confirm) with the agent's wording. */
  kill: (targets: ResKillTarget[], ask: { message: string; detail: (lines: string[]) => string; confirm: string }) => Promise<ResKillResult>
  now?: () => number
  platform?: NodeJS.Platform
  telegram?: () => TelegramNotifier | null
  confirm?: (spec: { message: string; detail: string; buttons: string[] }) => Promise<number>
}

export const LAYOUT_PRESETS: Record<'phone' | 'tablet', LayoutDevice> = {
  phone: { width: 1080, height: 2340, density: 440 },
  tablet: { width: 1600, height: 2560, density: 320 },
}
const FALLBACK_KEEP = 20

const deskError = (code: string): McpDeskError => ((DESK_ERRORS as readonly string[]).includes(code) ? (code as McpDeskError) : 'failed')

const realOr = (p: string): string => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

async function keepNewest(dir: string, keep: number): Promise<void> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => /^layout-.*\.png$/.test(n))
  const files = await Promise.all(names.map(async (n) => ({ file: path.join(dir, n), at: (await fs.stat(path.join(dir, n)).catch(() => null))?.mtimeMs ?? 0 })))
  for (const f of files.sort((a, b) => b.at - a.at).slice(keep)) await fs.rm(f.file, { force: true }).catch(() => undefined)
}

/** Main-process side of the WP-5 MCP tools; the PTY host already checked the token, the arguments and the rate. */
export function createDesk(deps: DeskDeps): (call: McpDeskCall) => Promise<McpDeskResult> {
  const platform = deps.platform ?? process.platform
  const now = deps.now ?? Date.now
  let confirming = false

  async function previewLayout(call: Extract<McpDeskCall, { tool: 'preview_layout' }>): Promise<McpDeskResult> {
    if (!deps.render) return { ok: false, error: 'unavailable' }
    // The host resolved the path; checked again here since this process reads the file.
    if (!isInsideOrSame(realOr(call.cwd), realOr(call.path), platform)) return { ok: false, error: 'outside' }
    const device = LAYOUT_PRESETS[call.device === 'tablet' ? 'tablet' : 'phone']
    const r = await deps.render(realOr(call.path), { device, night: call.night === true, slot: call.from })
    if (!r.ok) return { ok: false, error: deskError(r.code), ...(r.retryInSec ? { retryInSec: r.retryInSec } : {}), ...(r.detail && r.code === 'render-failed' ? { detail: r.detail } : {}) }
    const buf = await fs.readFile(r.png).catch(() => null)
    if (!buf || buf.length > SHOT_MAX_BYTES) return { ok: false, error: 'failed' }
    const name = `layout-${path.basename(call.path, path.extname(call.path))}${call.night ? '-dark' : ''}`
    let saved = await deps.writeShot(buf, name).catch(() => null)
    if (!saved) {
      await fs.mkdir(deps.fallbackDir, { recursive: true }).catch(() => undefined)
      const file = path.join(deps.fallbackDir, `${name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60)}-${now()}.png`)
      saved = (await fs.writeFile(file, buf).then(() => true, () => false)) ? file : null
      if (saved) await keepNewest(deps.fallbackDir, FALLBACK_KEEP)
    }
    if (!saved) return { ok: false, error: 'failed' }
    return { ok: true, tool: 'preview_layout', png: saved, width: r.width, height: r.height, renderMs: r.renderMs, frameworkOnly: r.frameworkOnly, diagnostics: r.diagnostics.slice(0, DIAG_MAX) }
  }

  async function scopeFor(call: McpDeskCall) {
    return paneScope(realOr(call.cwd), call.pid, call.pid ? await deps.procRows() : null, deps.home, platform)
  }

  async function freePort(call: Extract<McpDeskCall, { tool: 'free_port' }>): Promise<McpDeskResult> {
    if (confirming) return { ok: false, error: 'confirm-open' }
    const plan = planFreePort(deps.report(), await scopeFor(call), call.port, platform)
    if (!plan.ok) return plan
    const text = stringsFor(deps.locale())
    const pane = call.name.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80)
    confirming = true
    let res: ResKillResult
    try {
      res = await deps.kill(plan.targets, { message: text.freePortTitle(pane, call.port), detail: text.freePortDetail, confirm: text.freePortConfirm })
    } finally {
      confirming = false
    }
    if (!res.ok) return { ok: false, error: res.error === 'invalid' ? 'failed' : deskError(res.error) }
    return { ok: true, tool: 'free_port', port: call.port, stopped: plan.targets.map((t) => ({ pid: t.pid, name: (t.label ?? String(t.pid)).replace(/ :\d+$/, '') })) }
  }

  async function telegram(call: Extract<McpDeskCall, { tool: 'telegram_notify' | 'telegram_send' | 'telegram_receive' }>): Promise<McpDeskResult> {
    const tg = deps.telegram?.()
    if (!tg) return { ok: false, error: 'unavailable' }
    const cwd = realOr(call.cwd)
    if (call.tool === 'telegram_send') {
      const res = await tg.report(cwd, call.text, call.file ? realOr(call.file) : undefined, call.from)
      if (!res.ok) return { ok: false, error: deskError(res.error), detail: res.error }
      return { ok: true, tool: 'telegram_send', topic: res.topic, ...(res.file ? { file: res.file } : {}), ...(res.linkOnly ? { linkOnly: true } : {}) }
    }
    if (call.tool === 'telegram_receive') {
      const before = tg.state()
      if (call.state === 'on' && !before.configured) return { ok: false, error: 'telegram-config' }
      if (call.state === 'on' && !before.owner) return { ok: false, error: 'not-paired' }
      if (call.state === 'on' && !before.receiving) {
        if (!deps.confirm) return { ok: false, error: 'unavailable' }
        if (confirming) return { ok: false, error: 'confirm-open' }
        const text = stringsFor(deps.locale())
        const pane = call.name.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80)
        confirming = true
        let response: number
        try {
          response = await deps.confirm({ message: text.tgReceiveAskTitle(pane), detail: text.tgReceiveAskDetail(before.owner?.name ?? ''), buttons: [text.tgReceiveAskConfirm, text.quitCancel] })
        } catch {
          response = -1
        } finally {
          confirming = false
        }
        if (response !== 0) return { ok: false, error: 'cancelled' }
        if (!tg.state().owner) return { ok: false, error: 'not-paired' }
      }
      if (call.state !== 'status' && !tg.set({ receiving: call.state === 'on' }).ok) return { ok: false, error: 'failed' }
      const s = tg.state()
      return { ok: true, tool: 'telegram_receive', receiving: s.receiving, paired: !!s.owner, ...(s.owner ? { owner: s.owner.name } : {}) }
    }
    if (call.state !== 'status') {
      if (call.state === 'on' && !tg.state().configured) return { ok: false, error: 'telegram-config' }
      const set = tg.set({ enabled: call.state === 'on' })
      if (!set.ok) return { ok: false, error: 'failed' }
    }
    const state = tg.state()
    return { ok: true, tool: 'telegram_notify', enabled: state.enabled, configured: state.configured, projects: state.routes.map((r) => r.label), routed: tg.routeFor(cwd) !== null }
  }

  return async (call) => {
    if (call.tool === 'preview_layout') return previewLayout(call)
    if (call.tool === 'free_port') return freePort(call)
    if (call.tool === 'telegram_notify' || call.tool === 'telegram_send' || call.tool === 'telegram_receive') return telegram(call)
    if (call.tool === 'list_servers') {
      const report = deps.report()
      if (!report) return { ok: false, error: 'no-report' }
      return { ok: true, tool: 'list_servers', at: report.at, ...serversFor(report, await scopeFor(call), now(), platform) }
    }
    return { ok: false, error: 'unavailable' }
  }
}
