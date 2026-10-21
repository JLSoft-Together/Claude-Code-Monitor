import { computed, ref, watch, type Component, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, CornerDownRight, Mail, Send } from 'lucide-vue-next'
import type { GitDiffStat, PeerLink, TerminalSession, TerminalStatus } from '@ccm/shared'
import { now, relativeTime, shortPath } from '../lib/format'
import { isPeerNews, paneState, stateWord, type RailPeer, type RailState } from '../lib/rail/railModel'
import { waitDisplay } from '../lib/wait'
import { shellTitle } from '../lib/sidebarRows'
import { effectiveStatus, runningSubagents } from '../lib/subagents'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { otherEnd, usePeersStore } from '../stores/peers'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { baseName } from '../lib/preview'
import { isTerm, presetOf, tabTitle as titleOfTab, useWorkspaceStore, workCwd, type Pane, type Tab } from '../stores/workspace'

export interface PeerView {
  text: string
  short: string
  label: string
  action: string
  glyph: Component
  tone: string
  sweep: boolean
}

export type PanePeer = RailPeer & PeerView

const PEER_GLYPH: Record<RailPeer['dir'], Component> = { out: Send, in: Mail, both: ArrowRightLeft }

export const SWEEP_FRESH_MS = 2_000

export function usePeerSweep(source: () => Pick<RailPeer, 'at' | 'kind'> | null | undefined): Ref<number | null> {
  const key = ref<number | null>(null)
  watch(
    () => {
      const p = source()
      return p && p.kind === 'message' ? p.at : null
    },
    (at) => {
      if (!at) key.value = null
      else if (Date.now() - at < SWEEP_FRESH_MS) key.value = at
    },
    { immediate: true },
  )
  return key
}

export function usePeerSweeps(source: () => Record<string, Pick<RailPeer, 'at' | 'kind'> | null | undefined>): Ref<Record<string, number>> {
  const keys = ref<Record<string, number>>({})
  watch(
    () => {
      const out: Record<string, number> = {}
      for (const [k, p] of Object.entries(source())) if (p && p.kind === 'message') out[k] = p.at
      return out
    },
    (ats) => {
      const at = Date.now()
      const prev = keys.value
      const next: Record<string, number> = {}
      for (const [k, v] of Object.entries(ats)) {
        if (at - v < SWEEP_FRESH_MS) next[k] = v
        else if (prev[k] !== undefined) next[k] = prev[k]!
      }
      const same = Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => prev[k] === v)
      if (!same) keys.value = next
    },
    { immediate: true },
  )
  return keys
}

/** What the workspace shows about a pane, drawn from the monitor session linked to it. */
export function usePaneInfo() {
  const { t, locale } = useI18n()
  const terminals = useTerminalsStore()
  const agents = useAgentsStore()
  const workspace = useWorkspaceStore()
  const peers = usePeersStore()
  const ui = useUiStore()
  const minute = computed(() => Math.floor(now.value / 60_000))

  function sessionOf(pane: Pane | undefined): TerminalSession | undefined {
    const term = pane?.terminalId ? terminals.byId[pane.terminalId] : undefined
    return term && term.status !== 'stale' ? term : undefined
  }

  /** Browser: host[:port] or file name; file: name; changes: "Changes (N)". */
  function viewLabel(pane: Pane): string {
    if (pane.kind === 'file') return pane.path ? baseName(pane.path) : t('workspace.viewer.title')
    if (pane.kind === 'log') return pane.root ? `${t('workspace.log.title')}: ${baseName(pane.root)}` : t('workspace.log.title')
    if (pane.kind === 'changes') return pane.count ? t('workspace.changes.titleCount', { n: pane.count }) : t('workspace.changes.title')
    if (pane.kind === 'run') return pane.cwd ? t('run.titleIn', { name: baseName(pane.cwd) }) : t('run.title')
    const url = pane.url ?? ''
    if (/^https?:\/\//i.test(url)) {
      try {
        return new URL(url).host
      } catch {
        return url
      }
    }
    return url ? baseName(url) : t('workspace.open.browser')
  }

  /** Full URL / path / repo root, for tooltips. */
  function viewDetail(pane: Pane): string | undefined {
    if (pane.kind === 'file') return pane.path
    if (pane.kind === 'changes' || pane.kind === 'log') return pane.root ?? pane.cwd
    if (pane.kind === 'run') return pane.cwd
    return pane.url || undefined
  }

  function labelOf(pane: Pane): string {
    if (!isTerm(pane)) return viewLabel(pane)
    const session = sessionOf(pane)
    return session ? displayTitle(session) : t(`workspace.preset.${presetOf(pane)}`)
  }

  function titleOf(pane: Pane): string {
    return isTerm(pane) && presetOf(pane) === 'shell' && !sessionOf(pane) ? (shellTitle(pane) ?? labelOf(pane)) : labelOf(pane)
  }

  function tabTitle(tab: Tab): string {
    return titleOfTab(tab, (k) => workspace.panes.find((p) => p.key === k), titleOf)
  }

  function subagentsOf(pane: Pane | undefined): number {
    return pane?.terminalId && sessionOf(pane) ? runningSubagents(agents.byTerminal[pane.terminalId]) : 0
  }

  function statusOf(pane: Pane | undefined): TerminalStatus | undefined {
    const session = sessionOf(pane)
    return session ? effectiveStatus(session.status, subagentsOf(pane)) : undefined
  }

  function railStateOf(pane: Pane | undefined): RailState | null {
    if (!pane || !isTerm(pane)) return null
    const s = sessionOf(pane)
    return paneState(pane, s ? { status: s.status, title: '', subagents: subagentsOf(pane) } : undefined)
  }

  function stateText(pane: Pane | undefined): string | null {
    const state = railStateOf(pane)
    if (!state || !pane) return null
    if (state === 'asked') {
      const s = sessionOf(pane)
      const wait = s?.status === 'waiting' ? waitDisplay(s.waitingFor, undefined, t) : null
      if (wait) return wait.text
    }
    const w = stateWord(state, subagentsOf(pane))
    return w.n === undefined ? t(w.key) : t(w.key, { n: w.n }, w.n)
  }

  function activityOf(pane: Pane | undefined): { tool: string | null; since?: string; diff?: GitDiffStat } | null {
    const s = sessionOf(pane)
    if (!s) return null
    const tool = s.status === 'working' ? (agents.mainOf(s.id)?.currentTool ?? null) : null
    return { tool, since: s.statusSince, diff: s.diff }
  }

  /** "Claude Code · …/repo/src": names what closing would stop. */
  function describe(pane: Pane): string {
    if (!isTerm(pane)) return viewLabel(pane)
    const dir = workCwd(pane)
    const where = dir ? shortPath(dir) : ''
    const session = sessionOf(pane)
    const what = session ? `${t(`workspace.preset.${presetOf(pane)}`)} — ${displayTitle(session)}` : t(`workspace.preset.${presetOf(pane)}`)
    return where ? `${what} · ${where}` : what
  }

  /**
   * Closing would kill something the user may care about: an agent, an agent found running in a shell, or
   * whatever a command started there (`npm run dev` has no monitor session, so any entered command counts).
   */
  function isBusy(pane: Pane): boolean {
    if (!isTerm(pane) || (pane.state !== 'running' && pane.state !== 'starting')) return false
    return presetOf(pane) !== 'shell' || !!pane.ranCommand || !!sessionOf(pane)
  }

  function linkedId(pane: Pane | undefined): string | null {
    return pane?.terminalId && sessionOf(pane) ? pane.terminalId : null
  }

  function railPeerOf(pane: Pane | undefined): RailPeer | undefined {
    const r = peers.recentOf(linkedId(pane))
    if (!r) return undefined
    const other = r.others[0] ?? null
    return {
      dir: r.dir,
      kind: r.kind,
      other,
      name: other ? displayTitle(terminals.byId[other]) : '',
      inside: !!other && workspace.paneByTerminal.has(other),
      peers: r.others.length,
      n: r.n,
      at: r.at,
      until: r.until,
    }
  }

  function peerSentence(p: Pick<RailPeer, 'dir' | 'kind' | 'peers'>, name: string): string {
    const someone = name || t('peerWs.someone')
    if (p.kind === 'opened') return t('peer.openedBy', { name: someone })
    if (p.dir === 'both') return t('peer.talking', { name: someone })
    if (p.dir === 'out') return p.peers > 1 ? t('peer.sentMany', { n: p.peers }, p.peers) : name ? t('peer.sent', { name }) : t('peer.outside')
    return p.peers > 1 ? t('peer.receivedMany', { n: p.peers }, p.peers) : name ? t('peer.received', { name }) : t('peer.fromUnknown')
  }

  function peerView(p: RailPeer): PeerView {
    const someone = p.name || t('peerWs.someone')
    const named = p.name && !p.inside ? t('peer.outsideWorkspace', { name: p.name }) : p.name
    const who = p.peers > 1 ? t('peerWs.sessions', { n: p.peers }, p.peers) : someone
    const action = !p.other ? '' : p.inside ? t('peer.goTo', { name: someone }) : t('peerWs.openMonitor', { name: someone })
    return {
      text: peerSentence(p, p.name),
      short: t(`peerWs.short.${p.kind === 'opened' ? 'opened' : p.dir}`, { name: who }),
      label: peerSentence(p, named),
      action,
      glyph: p.kind === 'opened' ? CornerDownRight : PEER_GLYPH[p.dir],
      tone: p.kind === 'opened' ? 'text-ink-muted' : 'text-peer',
      sweep: p.kind === 'message',
    }
  }

  function peerOf(pane: Pane | undefined): PanePeer | null {
    const p = railPeerOf(pane)
    return p ? { ...p, ...peerView(p) } : null
  }

  function peerNewsOf(list: readonly (Pane | undefined)[]): PanePeer | null {
    let best: PanePeer | null = null
    for (const pane of list) {
      const p = peerOf(pane)
      if (p && isPeerNews(p) && (!best || p.at > best.at)) best = p
    }
    return best
  }

  function nameOf(terminalId: string): string {
    const name = displayTitle(terminals.byId[terminalId]) || t('peerWs.someone')
    return workspace.paneByTerminal.has(terminalId) ? name : t('peer.outsideWorkspace', { name })
  }

  function ago(iso: string): string {
    const at = Date.parse(iso)
    return Number.isFinite(at) ? (relativeTime(at, locale.value, Math.max(at, minute.value * 60_000)) ?? '') : ''
  }

  function coordinatingOf(pane: Pane | undefined): { n: number; label: string } | null {
    const id = linkedId(pane)
    if (!id) return null
    const role = peers.roleOf(id)
    if (!role.coordinating) return null
    return { n: role.coordinating, label: t('peer.coordinatingLabel', { n: role.coordinating, names: role.sentTo.map(nameOf).join(', ') }, role.coordinating) }
  }

  function peerLines(pane: Pane | undefined): string[] {
    const id = linkedId(pane)
    if (!id) return []
    const lines: string[] = []
    const messages = peers
      .linksOf(id)
      .filter((l: PeerLink) => l.kind === 'message')
      .sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt))
      .slice(0, 3)
    for (const l of messages) {
      const name = nameOf(otherEnd(l, id)!)
      const mine = (l.lastDir === 'ab') === (l.a === id)
      const when = ago(l.lastAt)
      const sentence = mine ? t('peer.sent', { name }) : t('peer.received', { name })
      lines.push(when ? `${sentence} · ${when}` : sentence)
    }
    const role = peers.roleOf(id)
    const coordinating = coordinatingOf(pane)
    if (coordinating) lines.push(coordinating.label)
    if (role.openedBy) lines.push(t('peer.openedBy', { name: nameOf(role.openedBy) }))
    if (role.opened.length) lines.push(t('peer.openedList', { names: role.opened.map(nameOf).join(', ') }))
    return lines
  }

  function goToPeer(terminalId: string | null | undefined): void {
    if (!terminalId) return
    const pane = workspace.paneByTerminal.get(terminalId)
    if (pane) {
      workspace.activate(pane.key)
      ui.setView('workspace')
      return
    }
    ui.setView('monitor')
    ui.focusTerminal(terminalId)
  }

  return {
    sessionOf,
    labelOf,
    titleOf,
    tabTitle,
    subagentsOf,
    statusOf,
    railStateOf,
    stateText,
    activityOf,
    viewLabel,
    viewDetail,
    describe,
    isBusy,
    railPeerOf,
    peerView,
    peerOf,
    peerNewsOf,
    peerLines,
    coordinatingOf,
    goToPeer,
  }
}
