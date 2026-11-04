import { watch } from 'vue'
import { cleanNoteText, isSessionId, parseInbound, uniquePaneNames, type TelegramPaneLink, waitReason, type TelegramInbound, type TelegramInboundResult, type TelegramKey, type TelegramPaneInfo, type TelegramResumeItem, type TerminalSession } from '@ccm/shared'
import { i18n } from '../i18n'
import { desktop } from '../lib/desktop'
import { telegramPanes } from '../lib/telegram'
import { baseName } from '../lib/preview'
import { useAgentsStore } from '../stores/agents'
import { useInboxStore } from '../stores/inbox'
import { useTerminalsStore } from '../stores/terminals'
import { useToastsStore } from '../stores/toasts'
import { isTerm, presetOf, useWorkspaceStore, workCwd, type Pane } from '../stores/workspace'

const TOAST_MS = 6000
const KEYS = { approve: '1', deny: '\x1b', stop: '\x1b' } as const
const RESUME_MAX = 8
const TYPED_MS = 1500
let installed = false

type Req<A extends TelegramInbound['action']> = Extract<TelegramInbound, { action: A }>

const dirKey = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
const within = (dir: string, root: string): boolean => dirKey(dir) === dirKey(root) || dirKey(dir).startsWith(`${dirKey(root)}\\`)
const owns = (dir: string, project: string, nested: string[] = []): boolean => within(dir, project) && !nested.some((n) => within(n, project) && within(dir, n))

export function keysReady(req: { key: TelegramKey; since?: number; tool?: string }, s: Pick<TerminalSession, 'status' | 'statusSince' | 'waitingFor'> | undefined, claude: boolean, tool?: string): boolean {
  if (!s) return false
  const ready = req.key === 'stop' ? s.status === 'working' : s.status === 'waiting' && waitReason(s.waitingFor) === 'permission' && claude
  if (!ready) return false
  if (req.since !== undefined && (!s.statusSince || Date.parse(s.statusSince) !== req.since)) return false
  return req.key === 'stop' || !req.tool || !tool || req.tool === tool
}

export function resumeItems(list: readonly TerminalSession[], project: string, nested: string[], open: Set<string>): TelegramResumeItem[] {
  const seen = new Set<string>()
  return list
    .filter((t) => !!t.endedAt && !!t.claudeSessionId && !!t.cwd && owns(t.cwd, project, nested) && !open.has(t.claudeSessionId))
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
    .filter((t) => !seen.has(t.claudeSessionId!) && !!seen.add(t.claudeSessionId!))
    .slice(0, RESUME_MAX)
    .map((t) => ({ id: t.claudeSessionId!, name: t.alias || baseName(t.cwd ?? '') || 'Claude', cwd: t.cwd!, endedAt: t.endedAt! }))
}

export function installTelegramInbound(): void {
  if (installed || !desktop?.onTelegramInbound) return
  installed = true
  const workspace = useWorkspaceStore()
  const terminals = useTerminalsStore()
  const agents = useAgentsStore()
  const inbox = useInboxStore()
  const toasts = useToastsStore()

  const sessionOf = (p: Pane) => {
    const t = p.terminalId ? terminals.byId[p.terminalId] : undefined
    return t && t.status !== 'stale' ? t : undefined
  }
  const nameOf = (p: Pane): string => sessionOf(p)?.alias || sessionOf(p)?.title || workspace.tabOf(p.key)?.name || baseName(workCwd(p) ?? p.cwd ?? '') || 'Agent'
  const info = (p: Pane): TelegramPaneInfo => {
    const s = sessionOf(p)
    const tool = s && s.status === 'working' ? agents.mainOf(s.id)?.currentTool : undefined
    const since = s?.statusSince ? Date.parse(s.statusSince) : NaN
    return { name: nameOf(p), status: s?.status ?? 'unknown', ...(s ? { terminalId: s.id } : {}), ...(tool ? { tool } : {}), ...(Number.isFinite(since) ? { since } : {}) }
  }
  const infos = (panes: Pane[]): TelegramPaneInfo[] => uniquePaneNames(panes.map(info))
  const targetOf = (req: Req<'send'> | Req<'keys'>) =>
    req.target ? (req.target.kind === 'terminal' ? { terminalId: req.target.terminalId } : { sessionId: req.target.sessionId }) : undefined
  const log = (p: Pane, from: string, text: string) => {
    const s = sessionOf(p)
    const note = cleanNoteText(i18n.global.t('telegram.inbound.note', { from, text }))
    if (s && note) inbox.addNote(s.id, { text: note, level: 'info', at: new Date().toISOString(), merged: 0 })
  }
  const toast = (name: string, text: string) => toasts.push({ kind: 'info', text: i18n.global.t('telegram.inbound.toast', { name }), detail: text.slice(0, 200), timeoutMs: TOAST_MS })

  async function keys(req: Req<'keys'>): Promise<TelegramInboundResult> {
    const target = targetOf(req)
    const candidates = workspace.telegramPanes(req.project, req.nested)
    const pane = target ? candidates.find((p) => (target.terminalId ? p.terminalId === target.terminalId : p.sessionId === target.sessionId)) : candidates.length === 1 ? candidates[0] : undefined
    if (!pane) return target ? { ok: false, error: 'gone' } : { ok: false, error: candidates.length ? 'many' : 'none', ...(candidates.length ? { panes: infos(candidates) } : {}) }
    const s = sessionOf(pane)
    const tool = s ? agents.mainOf(s.id)?.currentTool : undefined
    if (!keysReady(req, s, presetOf(pane) === 'claude', tool) || !pane.terminalId) return { ok: false, error: 'state' }
    const out = workspace.telegramKeys(req.project, KEYS[req.key], { terminalId: pane.terminalId }, req.nested)
    if (out === 'busy') return { ok: false, error: 'busy', panes: [info(pane)] }
    if (typeof out === 'string') return { ok: false, error: out }
    if (!(await workspace.telegramTyped(out.key, TYPED_MS))) return { ok: false, error: 'unavailable' }
    log(out, 'Telegram', req.key)
    return { ok: true, action: 'keys', name: nameOf(out), key: req.key }
  }

  function send(req: Req<'send'>): TelegramInboundResult {
    const out = workspace.telegramInbound(req.project, req.text, targetOf(req), req.nested)
    if (out === 'many') return { ok: false, error: 'many', panes: infos(workspace.telegramPanes(req.project, req.nested)) }
    if (typeof out === 'string') return { ok: false, error: out }
    if ('busy' in out) return { ok: false, error: 'busy', panes: [info(out.busy)] }
    const session = sessionOf(out)
    const name = nameOf(out)
    log(out, req.from, req.text)
    toast(name, req.text)
    return { ok: true, action: 'send', name, queued: session?.status !== 'idle', ...(session ? { terminalId: session.id } : {}) }
  }

  function all(req: Req<'all'>): TelegramInboundResult {
    const names: string[] = []
    const candidates = workspace.telegramPanes(req.project, req.nested)
    for (const p of candidates) {
      if (p.prefill || p.compact || !p.terminalId) continue
      const out = workspace.telegramInbound(req.project, req.text, { terminalId: p.terminalId }, req.nested)
      if (typeof out === 'object' && !('busy' in out)) {
        names.push(nameOf(out))
        log(out, req.from, req.text)
      }
    }
    if (!names.length) return { ok: false, error: candidates.length ? 'busy' : 'none' }
    toast(names.join(', '), req.text)
    return { ok: true, action: 'all', names }
  }

  function create(req: Req<'new'>): TelegramInboundResult {
    const pane = workspace.open('claude', req.project)
    if (req.text) workspace.update(pane.key, { prefill: req.text, prefillSubmit: true })
    const name = baseName(req.project) || 'Claude'
    toast(name, req.text ?? '')
    return { ok: true, action: 'new', name }
  }

  function openIds(): Set<string> {
    const ids = new Set<string>()
    for (const p of workspace.panes) {
      if (!isTerm(p)) continue
      if (p.agentSessionId) ids.add(p.agentSessionId)
      if (p.resume) ids.add(p.resume)
      const s = sessionOf(p)
      if (s?.claudeSessionId) ids.add(s.claudeSessionId)
    }
    return ids
  }

  function resumeList(req: Req<'resumeList'>): TelegramInboundResult {
    return { ok: true, action: 'resumeList', items: resumeItems(terminals.list, req.project, req.nested ?? [], openIds()) }
  }

  function resume(req: Req<'resume'>): TelegramInboundResult {
    if (!owns(req.cwd, req.project, req.nested)) return { ok: false, error: 'gone' }
    const live = terminals.list.some((t) => t.claudeSessionId === req.sessionId && t.status !== 'stale' && !t.endedAt)
    if (live || openIds().has(req.sessionId)) return { ok: false, error: 'busy' }
    workspace.open('claude', req.cwd, req.sessionId)
    const name = baseName(req.cwd) || 'Claude'
    toast(name, '--resume')
    return { ok: true, action: 'resume', name }
  }

  desktop.onTelegramInbound((raw): TelegramInboundResult | Promise<TelegramInboundResult> => {
    const req = parseInbound(raw)
    if (!req) return { ok: false, error: 'unavailable' }
    switch (req.action) {
      case 'status':
        return { ok: true, action: 'status', panes: infos(workspace.telegramPanes(req.project, req.nested)) }
      case 'keys':
        return keys(req)
      case 'send':
        return send(req)
      case 'all':
        return all(req)
      case 'new':
        return create(req)
      case 'resumeList':
        return resumeList(req)
      case 'resume':
        return resume(req)
    }
  })

  // Main routes a session's reports and its topic's commands by Claude session id; only the page knows which pane runs it.
  watch(
    () => paneLinks(workspace.panes, nameOf),
    (links, before) => {
      if (JSON.stringify(links) !== JSON.stringify(before)) void telegramPanes(links)
    },
    { immediate: true },
  )
}

export function paneLinks(panes: readonly Pane[], nameOf?: (p: Pane) => string): TelegramPaneLink[] {
  return panes.flatMap((p): TelegramPaneLink[] => {
    if (!isTerm(p) || !isSessionId(p.agentSessionId)) return []
    const cwd = workCwd(p)
    return [{ agent: p.agentSessionId.toLowerCase(), ...(p.sessionId ? { pane: p.sessionId } : {}), ...(p.terminalId ? { terminal: p.terminalId } : {}), ...(nameOf ? { name: nameOf(p) } : {}), ...(cwd ? { cwd } : {}) }]
  })
}
