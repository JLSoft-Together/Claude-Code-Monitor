import { describe, expect, it } from 'vitest'
import { findAction, isSeparator } from './menu'
import { GO_PEER, nodeMenu, PEER_MENU_FLAT, peerTarget, type NodeMenuState } from './mapMenu'

const base: NodeMenuState = {
  scope: 'map',
  agent: true,
  workspace: 'off',
  canJump: false,
  sessionId: true,
  cwd: true,
  branch: false,
  description: false,
  children: 0,
  collapsed: false,
  picked: 0,
  detailsOpen: false,
}
const t = (k: string, a?: Record<string, unknown>) => (a ? `${k}:${JSON.stringify(a)}` : k)

describe('map menu peers', () => {
  it('adds a go-to entry per warm peer after the map entries', () => {
    const menu = nodeMenu({ ...base, peers: [{ terminalId: 't2', name: 'api' }, { terminalId: 't3', name: 'web' }] }, t, false)
    const go = findAction(menu, `${GO_PEER}t2`)
    expect(go?.label).toBe('peer.goTo:{"name":"api"}')
    expect(findAction(menu, `${GO_PEER}t3`)).not.toBeNull()
    const ids = menu.map((e) => (isSeparator(e) ? '-' : e.id))
    expect(ids.slice(-3)).toEqual(['-', `${GO_PEER}t2`, `${GO_PEER}t3`])
  })

  it('nests many peers in a submenu and leaves cards and lone sessions alone', () => {
    const many = Array.from({ length: PEER_MENU_FLAT + 1 }, (_, i) => ({ terminalId: `t${i}`, name: `s${i}` }))
    const menu = nodeMenu({ ...base, peers: many }, t, false)
    const group = findAction(menu, 'go-peer')
    expect(group?.children).toHaveLength(many.length)
    expect(findAction(menu, `${GO_PEER}t4`)).not.toBeNull()
    expect(nodeMenu({ ...base, scope: 'card', peers: many }, t, false).some((e) => !isSeparator(e) && e.id.startsWith('go-peer'))).toBe(false)
    expect(nodeMenu(base, t, false).some((e) => !isSeparator(e) && e.id.startsWith('go-peer'))).toBe(false)
  })

  it('reads the target session back from the entry id', () => {
    expect(peerTarget(`${GO_PEER}pid:42`)).toBe('pid:42')
    expect(peerTarget('go-peer')).toBeNull()
    expect(peerTarget(GO_PEER)).toBeNull()
    expect(peerTarget('details')).toBeNull()
  })
})
