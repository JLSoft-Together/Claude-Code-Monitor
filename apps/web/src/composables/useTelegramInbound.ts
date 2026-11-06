import { watch } from 'vue'
import { cleanNoteText, isSessionId, type SessionTarget, type TelegramPaneLink, type TelegramInbound, type TelegramInboundResult, type TelegramResumeItem, type TerminalSession, type SessionOpenError } from '@ccm/shared'
import { i18n } from '../i18n'
import { telegramPanes } from '../lib/telegram'
import { baseName } from '../lib/preview'
import { useInboxStore } from '../stores/inbox'
import { useTerminalsStore } from '../stores/terminals'
import { useToastsStore } from '../stores/toasts'
import { agentLive, isTerm, useWorkspaceStore, workCwd, type Pane } from '../stores/workspace'
import { handleOrrery, hasOrrery } from './useOrreryApi'
import { useSessionActions, type ActFail } from './useSessionActions'

export { agentLive }
export { keyOf, keysReady } from './useSessionActions'

const TOAST_MS = 6000
const RESUME_MAX = 8
let installed = false

type Req<A extends TelegramInbound['action']> = Extract<TelegramInbound, { action: A }>

const dirKey = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
const within = (dir: string, root: string): boolean => dirKey(dir) === dirKey(root) || dirKey(dir).startsWith(`${dirKey(root)}\\`)
const owns = (dir: string, project: string, nested: string[] = []): boolean => within(dir, project) && !nested.some((n) => within(n, project) && within(dir, n))

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
  if (installed || !hasOrrery()) return
  installed = true
  const workspace = useWorkspaceStore()
  const terminals = useTerminalsStore()
  const inbox = useInboxStore()
  const toasts = useToastsStore()

  const act = useSessionActions()
  const { sessionOf, paneInfos: infos } = act
  const nameOf = (p: Pane): string => act.nameOf(p, { title: true })
  const targetOf = (req: Req<'send'> | Req<'keys'> | Req<'tail'>): SessionTarget => ({
    project: req.project,
    nested: req.nested,
    ...(req.target ? (req.target.kind === 'terminal' ? { terminalId: req.target.terminalId } : { sessionId: req.target.sessionId }) : {}),
  })
  const fail = (f: ActFail): TelegramInboundResult => ({ ok: false, error: f.error, ...(f.panes ? { panes: infos(f.panes) } : {}) })
  const log = (p: Pane, from: string, text: string) => {
    const s = sessionOf(p)
    const note = cleanNoteText(i18n.global.t('telegram.inbound.note', { from, text }))
    if (s && note) inbox.addNote(s.id, { text: note, level: 'info', at: new Date().toISOString(), merged: 0 })
  }
  const toast = (name: string, text: string) => toasts.push({ kind: 'info', text: i18n.global.t('telegram.inbound.toast', { name }), detail: text.slice(0, 200), timeoutMs: TOAST_MS })

  async function keys(req: Req<'keys'>): Promise<TelegramInboundResult> {
    const out = await act.keys(targetOf(req), req)
    if (!out.ok) return fail(out)
    log(out.pane, 'Telegram', req.key === 'option' ? `option ${req.option}` : req.key)
    return { ok: true, action: 'keys', name: nameOf(out.pane), key: req.key, ...(req.option ? { option: req.option } : {}) }
  }

  function tail(req: Req<'tail'>): TelegramInboundResult {
    const out = act.tail(targetOf(req), req.lines)
    return out.ok ? { ok: true, action: 'tail', name: nameOf(out.pane), text: out.text } : fail(out)
  }

  function send(req: Req<'send'>): TelegramInboundResult {
    const out = act.send(targetOf(req), req.text)
    if (!out.ok) return fail(out)
    const session = sessionOf(out.pane)
    const name = nameOf(out.pane)
    log(out.pane, req.from, req.text)
    toast(name, req.text)
    return { ok: true, action: 'send', name, queued: session?.status !== 'idle', ...(session ? { terminalId: session.id } : {}) }
  }

  function all(req: Req<'all'>): TelegramInboundResult {
    const out = act.sendAll(req, req.text)
    if (!out.ok) return fail(out)
    const names = out.panes.map((p) => {
      log(p, req.from, req.text)
      return nameOf(p)
    })
    toast(names.join(', '), req.text)
    return { ok: true, action: 'all', names }
  }

  const openError = (error: SessionOpenError): TelegramInboundResult => ({ ok: false, error: error === 'live' ? 'busy' : 'unavailable' })

  function create(req: Req<'new'>): TelegramInboundResult {
    const res = workspace.openSession({ preset: 'claude', cwd: req.project, prompt: req.text }, { source: 'telegram' })
    if (!res.ok) return openError(res.error)
    const name = baseName(req.project) || 'Claude'
    toast(name, req.text ?? '')
    return { ok: true, action: 'new', name }
  }

  function resumeList(req: Req<'resumeList'>): TelegramInboundResult {
    const open = new Set(terminals.list.flatMap((t) => (t.claudeSessionId && workspace.sessionLive(t.claudeSessionId) ? [t.claudeSessionId] : [])))
    return { ok: true, action: 'resumeList', items: resumeItems(terminals.list, req.project, req.nested ?? [], open) }
  }

  function resume(req: Req<'resume'>): TelegramInboundResult {
    if (!owns(req.cwd, req.project, req.nested)) return { ok: false, error: 'gone' }
    // A remote resume never takes over a pane already running it (openSession would focus that pane).
    if (workspace.sessionLive(req.sessionId)) return { ok: false, error: 'busy' }
    const res = workspace.openSession({ preset: 'claude', cwd: req.cwd, resume: req.sessionId }, { source: 'telegram' })
    if (!res.ok) return openError(res.error)
    const name = baseName(req.cwd) || 'Claude'
    toast(name, '--resume')
    return { ok: true, action: 'resume', name }
  }

  handleOrrery('session.status', (req) => ({ ok: true, action: 'status', panes: infos(act.status(req)) }))
  handleOrrery('session.keys', keys)
  handleOrrery('session.tail', tail)
  handleOrrery('session.send', send)
  handleOrrery('session.sendAll', all)
  handleOrrery('session.create', create)
  handleOrrery('session.resumeList', resumeList)
  handleOrrery('session.resume', resume)

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
    if (!isTerm(p) || !isSessionId(p.agentSessionId) || !agentLive(p)) return []
    const cwd = workCwd(p)
    return [{ agent: p.agentSessionId.toLowerCase(), ...(p.sessionId ? { pane: p.sessionId } : {}), ...(p.terminalId ? { terminal: p.terminalId } : {}), ...(nameOf ? { name: nameOf(p) } : {}), ...(cwd ? { cwd } : {}) }]
  })
}
