import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { ArrowRightLeft, CornerDownRight, Mail, Send } from 'lucide-vue-next'
import type { PeerLink, TerminalSession } from '@ccm/shared'
import { i18n } from '../i18n'
import { now } from '../lib/format'
import { openedLinkId, peerLinkId, usePeersStore } from '../stores/peers'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore, type Pane } from '../stores/workspace'
import { SWEEP_FRESH_MS, usePaneInfo, usePeerSweep } from './usePaneInfo'
import type { RailPeer } from '../lib/rail/railModel'

const T0 = Date.parse('2026-10-16T10:00:00.000Z')

const term = (id: string, title: string): TerminalSession => ({ id, title, status: 'idle', startedAt: new Date(T0).toISOString() }) as unknown as TerminalSession

const link = (a: string, b: string, over: Partial<PeerLink> = {}): PeerLink => ({
  id: peerLinkId(a, b),
  kind: 'message',
  a: a < b ? a : b,
  b: a < b ? b : a,
  ab: 1,
  ba: 0,
  firstAt: new Date(T0).toISOString(),
  lastAt: new Date(T0).toISOString(),
  lastDir: 'ab',
  ...over,
})

let pinia: Pinia

function withInfo() {
  let info!: ReturnType<typeof usePaneInfo>
  mount(
    defineComponent({
      setup() {
        info = usePaneInfo()
        return () => h('div')
      },
    }),
    { global: { plugins: [i18n, pinia] } },
  )
  return info
}

function linked(ws: ReturnType<typeof useWorkspaceStore>, terminalId: string): Pane {
  const p = ws.open('claude', `C:/work/${terminalId}`, undefined, { tab: true })
  ws.update(p.key, { state: 'running', terminalId })
  return ws.panes.find((x) => x.key === p.key)!
}

describe('usePaneInfo peers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    now.value = T0
    localStorage.clear()
    sessionStorage.clear()
    pinia = createPinia()
    setActivePinia(pinia)
    i18n.global.locale.value = 'en'
    useTerminalsStore().replaceAll([term('ta', 'api'), term('tb', 'web'), term('tc', 'docs')])
  })
  afterEach(() => vi.useRealTimers())

  it('words a message from a pane in the Workspace and goes there', () => {
    const ws = useWorkspaceStore()
    const a = linked(ws, 'ta')
    const b = linked(ws, 'tb')
    const info = withInfo()
    usePeersStore().upsert(link('ta', 'tb'))
    const got = info.peerOf(b)!
    expect(got).toMatchObject({ dir: 'in', kind: 'message', other: 'ta', name: 'api', inside: true, text: 'Message from api', label: 'Message from api', action: 'Go to api', tone: 'text-peer', sweep: true })
    expect(got.glyph).toBe(Mail)
    expect(info.peerOf(a)).toMatchObject({ dir: 'out', text: 'Sent to web' })
    expect(info.peerOf(a)!.glyph).toBe(Send)
    info.goToPeer(got.other)
    expect(ws.activeKey).toBe(a.key)
    expect(useUiStore().view).toBe('workspace')
  })

  it('names a session outside the Workspace and opens the Monitor for it', () => {
    const ws = useWorkspaceStore()
    const b = linked(ws, 'tb')
    const info = withInfo()
    usePeersStore().upsert(link('ta', 'tb'))
    const got = info.peerOf(b)!
    expect(got).toMatchObject({ inside: false, text: 'Message from api', label: 'Message from api (outside Workspace)', action: 'Show api in Monitor' })
    info.goToPeer(got.other)
    const ui = useUiStore()
    expect(ui.view).toBe('monitor')
    expect(ui.focusedTerminalId).toBe('ta')
  })

  it('reads talking, several receivers, opened-by and coordinating', () => {
    const ws = useWorkspaceStore()
    const a = linked(ws, 'ta')
    const b = linked(ws, 'tb')
    const info = withInfo()
    const peers = usePeersStore()
    peers.upsert(link('ta', 'tb'))
    peers.upsert(link('ta', 'tc'))
    expect(info.peerOf(a)).toMatchObject({ dir: 'out', peers: 2, text: 'Sent to 2 sessions', short: '→ 2 sessions' })
    expect(info.coordinatingOf(a)).toEqual({ n: 2, label: 'Coordinating 2 sessions: web, docs (outside Workspace)' })
    peers.patch({ id: peerLinkId('ta', 'tb'), ba: 1, lastDir: 'ba' })
    expect(info.peerOf(b)).toMatchObject({ dir: 'both', text: 'Talking with api', short: '⇄ api' })
    expect(info.peerOf(b)!.glyph).toBe(ArrowRightLeft)
    expect(info.peerLines(b)[0]).toMatch(/^Sent to api · /)
    expect(info.peerLines(a)[0]).toMatch(/^Message from web · /)

    vi.advanceTimersByTime(30_000)
    expect(info.peerOf(b)).toBeNull()
    peers.setOpened([{ ...link('ta', 'tb'), id: openedLinkId('ta', 'tb'), kind: 'opened', a: 'ta', b: 'tb' }])
    const opened = info.peerOf(b)!
    expect(opened).toMatchObject({ kind: 'opened', text: 'Opened by api', tone: 'text-ink-muted', sweep: false, short: '↳ api' })
    expect(opened.glyph).toBe(CornerDownRight)
    expect(info.peerLines(b)).toContain('Opened by api')

    i18n.global.locale.value = 'vi'
    expect(info.peerOf(b)!.text).toBe('Được mở bởi api')
  })

  it('finds the newest arriving message among panes', () => {
    const ws = useWorkspaceStore()
    const a = linked(ws, 'ta')
    const b = linked(ws, 'tb')
    const c = linked(ws, 'tc')
    const info = withInfo()
    const peers = usePeersStore()
    peers.upsert(link('ta', 'tb'))
    vi.advanceTimersByTime(1_000)
    peers.upsert(link('ta', 'tc'))
    expect(info.peerNewsOf([a, b])).toMatchObject({ other: 'ta', at: T0 })
    expect(info.peerNewsOf([a, b, c])).toMatchObject({ other: 'ta', at: T0 + 1_000, name: 'api' })
    expect(info.peerNewsOf([a])).toBeNull()
  })

  it('plays the sweep for a fresh message only, not for an old one seen on mount', async () => {
    const peer = ref<Pick<RailPeer, 'at' | 'kind'> | null>({ at: T0 - SWEEP_FRESH_MS - 1, kind: 'message' })
    let key!: ReturnType<typeof usePeerSweep>
    mount(defineComponent({ setup: () => ((key = usePeerSweep(() => peer.value)), () => h('div')) }))
    expect(key.value).toBeNull()
    peer.value = { at: T0, kind: 'message' }
    await nextTick()
    expect(key.value).toBe(T0)
    peer.value = { at: T0 - SWEEP_FRESH_MS - 5, kind: 'message' }
    await nextTick()
    expect(key.value).toBe(T0)
    peer.value = { at: T0 + 5, kind: 'opened' }
    await nextTick()
    expect(key.value).toBeNull()
  })
})
