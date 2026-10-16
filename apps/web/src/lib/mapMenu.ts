import { AppWindow, ChevronsDownUp, ChevronsUpDown, ClipboardCopy, Copy, Crosshair, Eye, EyeOff, Info, LayoutGrid, ListTree, Mail, Maximize, ScanSearch, Search, SquareTerminal } from 'lucide-vue-next'
import type { MenuAction, MenuEntry } from './menu'
import { keyCombo } from './shortcuts'

export type NodeAction =
  | 'show-in-workspace'
  | 'reopen'
  | 'reopen-confirm'
  | 'jump'
  | 'copy-summary'
  | 'copy-name'
  | 'copy-agent-id'
  | 'copy-session-id'
  | 'copy-cwd'
  | 'copy-branch'
  | 'copy-description'
  | 'copy-session-tree'
  | 'copy-picked'
  | 'zoom-node'
  | 'show-session'
  | 'details'
  | 'toggle-subtree'
  | `go-peer:${string}`

export type CanvasAction = 'fit' | 'reset-layout' | 'expand-all' | 'collapse-all' | 'toggle-finished' | 'copy-map' | 'find'

export interface NodeMenuState {
  /** `card`: a session card on the dashboard, without the map-only entries (zoom, show session, fold, picked). */
  scope: 'map' | 'card'
  /** False for a card whose session has no main agent yet: nothing agent-level to copy or show. */
  agent: boolean
  workspace: 'show' | 'reopen' | 'reopen-live' | 'none' | 'off'
  canJump: boolean
  sessionId: boolean
  cwd: boolean
  branch: boolean
  description: boolean
  children: number
  collapsed: boolean
  picked: number
  detailsOpen: boolean
  peers?: readonly { terminalId: string; name: string }[]
}

export const GO_PEER = 'go-peer:'
export const PEER_MENU_FLAT = 4

export function peerTarget(id: string): string | null {
  return id.startsWith(GO_PEER) && id.length > GO_PEER.length ? id.slice(GO_PEER.length) : null
}

type T = (key: string, args?: Record<string, unknown>) => string

export function nodeMenu(s: NodeMenuState, t: T, mac: boolean): MenuEntry[] {
  const out: MenuEntry[] = []
  const map = s.scope === 'map'
  if (s.workspace === 'show') out.push({ id: 'show-in-workspace', label: t('workspace.reopen.show'), icon: SquareTerminal, shortcut: map ? keyCombo(['Shift', 'Enter'], mac) : undefined })
  else if (s.workspace === 'reopen') out.push({ id: 'reopen', label: t('workspace.reopen.action'), icon: SquareTerminal })
  else if (s.workspace === 'reopen-live')
    out.push({
      id: 'reopen',
      label: t('workspace.reopen.action'),
      icon: SquareTerminal,
      children: [{ id: 'reopen-confirm', label: t('workspace.reopen.confirm'), hint: t('workspace.reopen.liveWarning'), wrapHint: true }],
    })
  else if (s.workspace === 'none') out.push({ id: 'reopen', label: t('workspace.reopen.action'), icon: SquareTerminal, disabled: true, hint: t('agentMenu.noWorkspace') })
  if (s.canJump) out.push({ id: 'jump', label: t('terminal.jumpTitle'), icon: AppWindow })
  if (out.length) out.push({ separator: true })

  out.push({ id: 'copy-summary', label: t('map.menu.copySummary'), icon: ClipboardCopy, shortcut: keyCombo(['Mod', 'C'], mac), disabled: !s.agent })
  out.push({
    id: 'copy',
    label: t('map.menu.copy'),
    icon: Copy,
    children: [
      { id: 'copy-name', label: t('map.menu.copyName'), disabled: !s.agent },
      { id: 'copy-agent-id', label: t('map.menu.copyAgentId'), disabled: !s.agent },
      { id: 'copy-session-id', label: t('map.menu.copySessionId'), disabled: !s.sessionId },
      { id: 'copy-cwd', label: t('map.menu.copyCwd'), disabled: !s.cwd },
      { id: 'copy-branch', label: t('map.menu.copyBranch'), disabled: !s.branch },
      ...(s.description ? [{ id: 'copy-description', label: t('map.menu.copyDescription') }] : []),
      { separator: true },
      { id: 'copy-session-tree', label: t('map.menu.copySessionTree') },
    ],
  })
  if (map && s.picked > 1) out.push({ id: 'copy-picked', label: t('map.menu.copyPicked', { n: s.picked }), icon: ListTree })
  if (map || s.agent) out.push({ separator: true })
  if (s.agent)
    out.push({ id: 'details', label: t(s.detailsOpen ? 'map.menu.hideDetails' : 'agentMenu.details'), icon: Info, shortcut: map ? keyCombo(['Enter'], mac) : undefined })
  if (!map) return out
  out.push({ id: 'zoom-node', label: t('map.menu.zoomNode'), icon: ScanSearch })
  out.push({ id: 'show-session', label: t('agentMenu.focus'), icon: Crosshair })
  if (s.children > 0 || s.collapsed)
    out.push({
      id: 'toggle-subtree',
      label: t(s.collapsed ? 'map.menu.expand' : 'map.menu.collapse'),
      icon: s.collapsed ? ChevronsUpDown : ChevronsDownUp,
      shortcut: 'Space',
    })
  const peers = s.peers ?? []
  if (peers.length) {
    out.push({ separator: true })
    const items: MenuAction[] = peers.map((p) => ({ id: `${GO_PEER}${p.terminalId}`, label: t('peer.goTo', { name: p.name }), icon: Mail }))
    if (peers.length <= PEER_MENU_FLAT) out.push(...items)
    else out.push({ id: 'go-peer', label: t('peerMap.goToMenu'), icon: Mail, children: items.map((e) => ({ ...e, icon: undefined })) })
  }
  return out
}

export interface CanvasMenuState {
  hasNodes: boolean
  anyCollapsed: boolean
  anyParent: boolean
  hideFinished: boolean
}

export function canvasMenu(s: CanvasMenuState, t: T, mac: boolean): MenuEntry[] {
  return [
    { id: 'fit', label: t('map.fit'), icon: Maximize, shortcut: 'F', disabled: !s.hasNodes },
    { id: 'reset-layout', label: t('map.reset'), icon: LayoutGrid, disabled: !s.hasNodes },
    { separator: true },
    { id: 'expand-all', label: t('map.menu.expandAll'), icon: ChevronsUpDown, disabled: !s.anyCollapsed },
    { id: 'collapse-all', label: t('map.menu.collapseAll'), icon: ChevronsDownUp, disabled: !s.anyParent },
    { id: 'toggle-finished', label: t(s.hideFinished ? 'map.showFinished' : 'map.hideFinished'), icon: s.hideFinished ? Eye : EyeOff },
    { separator: true },
    { id: 'copy-map', label: t('map.menu.copyMap'), icon: ListTree, disabled: !s.hasNodes },
    { id: 'find', label: t('map.find.open'), icon: Search, shortcut: keyCombo(['Mod', 'F'], mac), disabled: !s.hasNodes },
  ]
}
