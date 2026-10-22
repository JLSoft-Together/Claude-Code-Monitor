import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'
import type { Selection } from '@ccm/habblaud/client/src/world/api'

type FakeWorld = {
  canvas: HTMLCanvasElement
  selectCbs: Set<(s: Selection) => void>
  selection: Selection
  select: Mock<(sel: Selection, opts?: { focus?: boolean }) => void>
  getSelection: () => Selection
  onSelect: (cb: (s: Selection) => void) => () => void
  onHover: () => () => void
  focusAgent: ReturnType<typeof vi.fn>
  focusRoom: ReturnType<typeof vi.fn>
  overview: ReturnType<typeof vi.fn>
  zoomBy: ReturnType<typeof vi.fn>
  getOptions: () => unknown
  setOptions: ReturnType<typeof vi.fn>
  setViewInsets: ReturnType<typeof vi.fn>
  setPlayback: ReturnType<typeof vi.fn>
  screenPositionOf: () => null
  destroy: ReturnType<typeof vi.fn>
  readyCbs: Set<() => void>
  onReady?: (cb: () => void) => () => void
  fireReady: () => void
}

const h = vi.hoisted(() => {
  const worlds: FakeWorld[] = []
  const locale = { gate: null as Promise<void> | null }
  const reveal = { show: (_terminalId: string): boolean => false }
  const packs = { index: [] as { id: string; name: { en: string; vi: string }; preview: string | null }[], rooms: {} as Record<string, unknown[] | null> }
  const ready = { manual: false }
  return { worlds, locale, reveal, packs, ready }
})

vi.mock('../../office/iso/preload', () => ({ scheduleIsoPreload: vi.fn(() => true), warmIsoArt: vi.fn(async () => undefined) }))

vi.mock('../../office/iso/isoArt', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../office/iso/isoArt')>()
  return { ...real, releaseIsoArt: vi.fn(() => 0) }
})

vi.mock('../../office/packs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../office/packs')>()
  const { parseRoomThemes } = await import('@ccm/habblaud/client/src/art/theme')
  return {
    ...real,
    fetchPackIndex: vi.fn(async () => h.packs.index),
    loadOfficePack: vi.fn(async (id: string) =>
      id === real.CLASSIC_PACK ? { id, assetPack: undefined, rooms: null } : { id, assetPack: `themes/${id}`, rooms: parseRoomThemes(h.packs.rooms[id] ?? null) },
    ),
  }
})

vi.mock('@ccm/habblaud/client/src/world/assets', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ccm/habblaud/client/src/world/assets')>()
  return { ...real, loadWorldAssets: vi.fn(async () => null) }
})

vi.mock('../../composables/useRevealInWorkspace', () => ({
  useRevealInWorkspace: () => ({ show: (id: string) => h.reveal.show(id) }),
}))

vi.mock('@ccm/habblaud/client/src/world', () => ({
  createWorld: vi.fn((canvas: HTMLCanvasElement) => {
    const w: FakeWorld = {
      canvas,
      selectCbs: new Set(),
      selection: null,
      select: vi.fn((sel: Selection) => {
        w.selection = sel
        for (const cb of w.selectCbs) cb(sel)
      }),
      getSelection: () => w.selection,
      onSelect: (cb) => {
        w.selectCbs.add(cb)
        return () => w.selectCbs.delete(cb)
      },
      onHover: () => () => {},
      focusAgent: vi.fn(),
      focusRoom: vi.fn(),
      overview: vi.fn(),
      zoomBy: vi.fn(),
      getOptions: () => ({}),
      setOptions: vi.fn(),
      setViewInsets: vi.fn(),
      setPlayback: vi.fn(),
      screenPositionOf: () => null,
      destroy: vi.fn(),
      readyCbs: new Set(),
      fireReady: () => {
        const cbs = [...w.readyCbs]
        w.readyCbs.clear()
        for (const cb of cbs) cb()
      },
    }
    if (h.ready.manual)
      w.onReady = (cb) => {
        w.readyCbs.add(cb)
        return () => void w.readyCbs.delete(cb)
      }
    h.worlds.push(w)
    return w
  }),
}))

vi.mock('../../office/i18n', () => ({
  applyOfficeLocale: vi.fn(async () => {
    if (h.locale.gate) await h.locale.gate
  }),
}))

const { createWorld } = await import('@ccm/habblaud/client/src/world')
const { applyOfficeLocale } = await import('../../office/i18n')
const { officeFeed } = await import('../../office/feed')
const { i18n } = await import('../../i18n')
const { useConnectionStore } = await import('../../stores/connection')
const { useUiStore } = await import('../../stores/ui')
const { useAgentsStore } = await import('../../stores/agents')
const { useSettingsStore } = await import('../../stores/settings')
const { useOfficeStore, OFFICE_OPTIONS_KEY } = await import('../../stores/office')
const { modalOpen } = await import('@ccm/habblaud/client/src/world/input')
const officeI18n = (await import('../../i18n/office-v60')).default
const officeI18nV62 = (await import('../../i18n/office-v62')).default
const OfficeView = (await import('./OfficeView.vue')).default
const OfficeOptions = (await import('./OfficeOptions.vue')).default
const { setRoomThemes, roomTheme } = await import('@ccm/habblaud/client/src/art/theme')
const { OFFICE_PACK_KEY } = await import('../../office/packs')
const { WARM_UP_MS, SWITCH_OVERLAY_DELAY_MS, LAYER_FADE_MS } = await import('../../office/switching')
const { scheduleIsoPreload, warmIsoArt } = await import('../../office/iso/preload')
const { releaseIsoArt } = await import('../../office/iso/isoArt')
const { ISO_RELEASE_MS, SWITCH_ERROR_MS } = await import('../../office/switching')

let w: VueWrapper | null = null
let pinia: Pinia
let subscribe: ReturnType<typeof vi.fn>

function setup(): void {
  pinia = createPinia()
  setActivePinia(pinia)
  subscribe = vi.fn()
  const conn = useConnectionStore()
  conn.subscribeOffice = subscribe as unknown as typeof conn.subscribeOffice
}

async function mountView(props: { terminalId?: string | null } = {}): Promise<VueWrapper> {
  w = mount(OfficeView, { props, global: { plugins: [i18n, pinia] }, attachTo: document.body })
  await flushPromises()
  return w
}

const world = (): FakeWorld => h.worlds.at(-1)!

beforeEach(() => {
  localStorage.clear()
  h.packs.index = []
  h.packs.rooms = {}
  setRoomThemes(null)
  h.worlds.length = 0
  h.locale.gate = null
  h.ready.manual = false
  vi.mocked(scheduleIsoPreload).mockClear()
  vi.mocked(warmIsoArt).mockClear()
  vi.mocked(releaseIsoArt).mockClear()
  vi.mocked(createWorld).mockClear()
  vi.mocked(applyOfficeLocale).mockClear()
  i18n.global.locale.value = 'en'
  setup()
})

afterEach(() => {
  w?.unmount()
  w = null
  document.body.innerHTML = ''
  i18n.global.locale.value = 'en'
})

describe('OfficeView lifecycle', () => {
  it('applies the locale, subscribes and creates the world once on mount', async () => {
    await mountView()
    expect(applyOfficeLocale).toHaveBeenCalledWith('en')
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(true)
    expect(createWorld).toHaveBeenCalledTimes(1)
    const [canvas, store] = vi.mocked(createWorld).mock.calls[0]!
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)
    expect(store).toBe(officeFeed)
    expect(world().setOptions).toHaveBeenCalled()
  })

  it('destroys the world and unsubscribes on unmount', async () => {
    await mountView()
    const first = world()
    w!.unmount()
    w = null
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenLastCalledWith(false)
  })

  it('creates no world and leaks no subscription when unmounted while the locale still loads', async () => {
    let release!: () => void
    h.locale.gate = new Promise<void>((r) => (release = r))
    w = mount(OfficeView, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await nextTick()
    w.unmount()
    w = null
    release()
    await flushPromises()
    expect(createWorld).not.toHaveBeenCalled()
    const ons = subscribe.mock.calls.filter(([on]) => on === true).length
    const offs = subscribe.mock.calls.filter(([on]) => on === false).length
    expect(ons).toBe(offs)
  })

  it('recreates the world when the language changes', async () => {
    const relocalize = vi.spyOn(officeFeed, 'relocalize')
    await mountView()
    const first = world()
    i18n.global.locale.value = 'vi'
    await flushPromises()
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(applyOfficeLocale).toHaveBeenLastCalledWith('vi')
    expect(relocalize).toHaveBeenCalled()
    expect(createWorld).toHaveBeenCalledTimes(2)
    expect(world()).not.toBe(first)
    expect(subscribe).toHaveBeenCalledTimes(1)
    relocalize.mockRestore()
  })

  it('still subscribes once when the language changes during the first build', async () => {
    let release!: () => void
    h.locale.gate = new Promise<void>((r) => (release = r))
    w = mount(OfficeView, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await nextTick()
    i18n.global.locale.value = 'vi'
    await nextTick()
    release()
    await flushPromises()
    expect(subscribe.mock.calls).toEqual([[true]])
    expect(createWorld).toHaveBeenCalledTimes(1)
    w.unmount()
    w = null
    expect(subscribe.mock.calls).toEqual([[true], [false]])
  })

  it('pauses the office feed while the window is hidden', async () => {
    const hidden = (v: boolean): void => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: v })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    try {
      await mountView()
      expect(subscribe.mock.calls).toEqual([[true]])
      hidden(true)
      expect(subscribe.mock.calls).toEqual([[true], [false]])
      hidden(true)
      hidden(false)
      expect(subscribe.mock.calls).toEqual([[true], [false], [true]])
      w!.unmount()
      w = null
      expect(subscribe).toHaveBeenLastCalledWith(false)
      hidden(false)
      expect(subscribe).toHaveBeenCalledTimes(4)
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    }
  })

  it('subscribes only once it is visible when mounted in a hidden window', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    try {
      await mountView()
      expect(subscribe).not.toHaveBeenCalled()
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(subscribe.mock.calls).toEqual([[true]])
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    }
  })

  it('unsubscribes when the world fails to load', async () => {
    vi.mocked(createWorld).mockImplementationOnce(() => {
      throw new Error('chunk failed')
    })
    await mountView()
    expect(w!.find('[data-office-state]').text()).toContain(i18n.global.t('officeV60.failed'))
    expect(subscribe.mock.calls).toEqual([[true], [false]])
    w!.unmount()
    w = null
    expect(subscribe).toHaveBeenCalledTimes(2)
  })

  it('keeps the camera keys away from the world while focus is in a side panel', async () => {
    await mountView()
    // Stands in for the world's window listener (vendored input.ts), registered after the view mounted.
    const camera = vi.fn()
    const shortcut = vi.fn()
    window.addEventListener('keydown', camera)
    document.addEventListener('keydown', shortcut)
    const panel = document.createElement('button')
    document.body.append(panel)
    const press = (target: EventTarget, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    try {
      for (const key of ['ArrowDown', 'w', 'S', '+', '-', '0']) press(panel, key)
      expect(camera).not.toHaveBeenCalled()
      expect(shortcut).toHaveBeenCalledTimes(6)
      press(panel, 'x')
      expect(camera).toHaveBeenCalledTimes(1)
      press(document.body, 'ArrowLeft')
      expect(camera).toHaveBeenCalledTimes(2)
      press(w!.find('canvas').element, 'ArrowLeft')
      expect(camera).toHaveBeenCalledTimes(3)
      w!.unmount()
      w = null
      press(panel, 'ArrowDown')
      expect(camera).toHaveBeenCalledTimes(4)
    } finally {
      window.removeEventListener('keydown', camera)
      document.removeEventListener('keydown', shortcut)
    }
  })

  it('stops the real world input from panning on a side-panel arrow key, not on the office canvas', async () => {
    await mountView()
    const { attachInput } = await import('@ccm/habblaud/client/src/world/input')
    const cam = { panBy: vi.fn(), zoom: 1, zoomAt: vi.fn(), settle: vi.fn() }
    const h = { pick: () => null, click: vi.fn(), doubleClick: vi.fn(), hover: vi.fn(), interact: vi.fn(), overview: vi.fn(), zoomStep: vi.fn() }
    const detach = attachInput(w!.find('canvas').element as HTMLCanvasElement, cam as never, h)
    const panel = document.createElement('div')
    panel.tabIndex = 0
    document.body.append(panel)
    try {
      const fromPanel = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      panel.dispatchEvent(fromPanel)
      expect(cam.panBy).not.toHaveBeenCalled()
      expect(fromPanel.defaultPrevented).toBe(false)
      w!.find('canvas').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      expect(cam.panBy).toHaveBeenCalledTimes(1)
    } finally {
      detach()
    }
  })

  it('relocalizes the feed when the theme changes, without a new world', async () => {
    const relocalize = vi.spyOn(officeFeed, 'relocalize')
    await mountView()
    const settings = useSettingsStore()
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
    await flushPromises()
    expect(relocalize).toHaveBeenCalled()
    expect(createWorld).toHaveBeenCalledTimes(1)
    relocalize.mockRestore()
  })
})

describe('OfficeView selection', () => {
  it('selects the agent in the app when a character is clicked', async () => {
    await mountView()
    useAgentsStore().replaceAll([{ id: 'a1', terminalId: 't1', role: 'main', status: 'working' } as never])
    world().select({ type: 'agent', id: 'a1' })
    expect(useUiStore().selectedAgentId).toBe('a1')
    expect(useUiStore().focusedTerminalId).toBe('t1')
  })

  describe('a character that is asking', () => {
    const snap = (status: string, id = 'a1'): OfficeSnapshot =>
      ({
        rev: 1,
        serverTime: 1,
        rooms: [{ id: 'r' }],
        agents: [{ id, roomId: 'r', kind: 'main', role: 'main', status, recent: [], tasks: [], shells: [] }],
        accounts: [],
        meta: {},
      }) as unknown as OfficeSnapshot
    let focusWindow: Mock<(id: string) => boolean>
    let show: Mock<(id: string) => boolean>

    beforeEach(() => {
      focusWindow = vi.fn(() => true)
      useConnectionStore().focusWindow = focusWindow as unknown as ReturnType<typeof useConnectionStore>['focusWindow']
      show = vi.fn(() => false)
      h.reveal.show = show
      useAgentsStore().replaceAll([
        { id: 'a1', terminalId: 't1', role: 'main', status: 'waiting' } as never,
        { id: 's1', parentId: 'a1', terminalId: 't1', role: 'subagent', status: 'waiting' } as never,
      ])
    })

    afterEach(() => officeFeed.stopReplay())

    it('raises its terminal window when the session has no Workspace pane', async () => {
      await mountView()
      officeFeed.ingestLive(snap('waiting'))
      world().select({ type: 'agent', id: 'a1' })
      expect(show).toHaveBeenCalledWith('t1')
      expect(focusWindow).toHaveBeenCalledWith('t1')
      expect(useUiStore().selectedAgentId).toBe('a1')
    })

    it('opens the Workspace pane instead when the session has one', async () => {
      show.mockReturnValue(true)
      await mountView()
      officeFeed.ingestLive(snap('waiting'))
      world().select({ type: 'agent', id: 'a1' })
      expect(show).toHaveBeenCalledWith('t1')
      expect(focusWindow).not.toHaveBeenCalled()
    })

    it("goes to the subagent's session", async () => {
      await mountView()
      officeFeed.ingestLive(snap('waiting', 's1'))
      world().select({ type: 'agent', id: 's1' })
      expect(focusWindow).toHaveBeenCalledWith('t1')
    })

    it('reports the session offline when the window request cannot be sent', async () => {
      focusWindow.mockReturnValue(false)
      await mountView()
      officeFeed.ingestLive(snap('waiting'))
      world().select({ type: 'agent', id: 'a1' })
      expect(useUiStore().windowResult).toEqual({ terminalId: 't1', result: 'offline' })
    })

    it('only selects a character that is not asking', async () => {
      await mountView()
      officeFeed.ingestLive(snap('working'))
      world().select({ type: 'agent', id: 'a1' })
      expect(show).not.toHaveBeenCalled()
      expect(focusWindow).not.toHaveBeenCalled()
      expect(useUiStore().selectedAgentId).toBe('a1')
    })

    it('does not jump for a raised hand in a replayed moment', async () => {
      await mountView()
      officeFeed.pushReplay(snap('waiting'))
      world().select({ type: 'agent', id: 'a1' })
      expect(show).not.toHaveBeenCalled()
      expect(focusWindow).not.toHaveBeenCalled()
    })

    it('does not jump when the app selection moves the office to an asking agent', async () => {
      await mountView()
      officeFeed.ingestLive(snap('waiting'))
      useUiStore().selectAgent('a1')
      await flushPromises()
      expect(world().select).toHaveBeenCalledWith({ type: 'agent', id: 'a1' }, { focus: true })
      expect(focusWindow).not.toHaveBeenCalled()
    })
  })

  it('selects and focuses the character when the app selection changes', async () => {
    await mountView()
    useUiStore().selectAgent('a2')
    await flushPromises()
    expect(world().select).toHaveBeenCalledWith({ type: 'agent', id: 'a2' }, { focus: true })
  })

  it('focuses the room of a session tab once the snapshot knows it', async () => {
    useAgentsStore().replaceAll([{ id: 'main-1', terminalId: 't1', role: 'main', status: 'working' } as never])
    await mountView({ terminalId: 't1' })
    officeFeed.ingestLive({
      rev: 1,
      serverTime: 1,
      rooms: [{ id: 'room-x' }],
      agents: [{ id: 'main-1', roomId: 'room-x', kind: 'main', role: 'main', recent: [], tasks: [], shells: [] }],
      accounts: [],
      meta: {},
    } as unknown as OfficeSnapshot)
    await flushPromises()
    expect(world().focusRoom).toHaveBeenCalledWith('room-x')
  })
})

describe('Office options', () => {
  it('restores saved options into the world', async () => {
    localStorage.setItem(OFFICE_OPTIONS_KEY, JSON.stringify({ showNames: false, bubbles: 'none', liveliness: 'calm', dayNight: false, followSelected: true }))
    setup()
    await mountView()
    expect(world().setOptions).toHaveBeenCalledWith(expect.objectContaining({ showNames: false, bubbles: 'none', liveliness: 'calm', dayNight: false, followSelected: true }))
  })

  it('ignores invalid saved values', () => {
    localStorage.setItem(OFFICE_OPTIONS_KEY, JSON.stringify({ showNames: 'yes', bubbles: 'loud' }))
    setup()
    const o = useOfficeStore().options
    expect(o.showNames).toBe(true)
    expect(o.bubbles).toBe('important')
  })

  it('persists a change and passes it to the world', async () => {
    await mountView()
    useOfficeStore().setOption('bubbles', 'all')
    expect(JSON.parse(localStorage.getItem(OFFICE_OPTIONS_KEY)!).bubbles).toBe('all')
    expect(world().setOptions).toHaveBeenLastCalledWith({ bubbles: 'all' })
  })

  it('zooms and frames the world from the store controls', async () => {
    await mountView()
    const office = useOfficeStore()
    office.zoomBy(1.25)
    office.zoomBy(0.8)
    office.overview()
    expect(world().zoomBy).toHaveBeenCalledWith(1.25)
    expect(world().zoomBy).toHaveBeenCalledWith(0.8)
    expect(world().overview).toHaveBeenCalled()
  })

  it('opens a dialog popover that keeps the camera keys away', async () => {
    w = mount(OfficeOptions, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await w.find('button[aria-haspopup="dialog"]').trigger('click')
    const dialog = w.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    const inside = dialog.find('button').element as HTMLElement
    expect(modalOpen(inside)).toBe(true)
    await dialog.find('[role="switch"]').trigger('click')
    expect(useOfficeStore().options.showNames).toBe(false)
  })
})

describe('Office view mode', () => {
  it('keeps the office view across a store re-creation', async () => {
    useUiStore().mapView = 'office'
    await nextTick()
    setActivePinia(createPinia())
    expect(useUiStore().mapView).toBe('office')
  })

  it('gives the sound toggle a static label and reports its state through aria-pressed', async () => {
    const src = (await import('../AgentMap.vue?raw')).default
    const start = src.indexOf(':aria-pressed="office.sound"')
    expect(start).toBeGreaterThan(-1)
    const button = src.slice(start, src.indexOf('@click="office.setSound', start))
    expect(button).toContain(`:aria-label="t('officeV60.sound')"`)
    expect(button).not.toContain('office.sound ?')
    expect(i18n.global.t('officeV60.sound', {}, { locale: 'en' })).toBe('Office sound')
    expect(i18n.global.t('officeV60.sound', {}, { locale: 'vi' })).toBe('Âm thanh văn phòng')
  })

  it('has every office string in English and Vietnamese', () => {
    type Tree = { [k: string]: Tree | string }
    const keys = (t: Tree, p = ''): string[] => Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v, `${p}${k}.`)))
    const en = keys(officeI18n.en as unknown as Tree)
    expect(en.length).toBeGreaterThan(0)
    expect(keys(officeI18n.vi as unknown as Tree)).toEqual(en)
    for (const k of en) {
      expect(i18n.global.te(k, 'en')).toBe(true)
      expect(i18n.global.te(k, 'vi')).toBe(true)
    }
  })
})

describe('Office timelapse', () => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).getTime()
  const keyframe = {
    t: 'k',
    at: from,
    v: 1,
    every: 300_000,
    rooms: [{ id: 'r1', name: 'app', path: '', slot: 0, seed: 1, createdAt: from }],
    agents: [{ id: 'a1', kind: 'main', roomId: 'r1', name: 'Ada', look: 'f', role: 'main', account: 'x', status: 'working', statusSince: from, startedAt: from, seed: 1 }],
    accounts: [],
  }
  const dayText = `${JSON.stringify(keyframe)}\n${JSON.stringify({ t: 'd', at: from + 60_000 })}\n`

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/timeline/days') return new Response(JSON.stringify({ recording: true, days: [{ day: today, bytes: 1, from, to: from + 60_000 }] }))
        if (url === `/api/timeline/${today}`) return new Response(dayText)
        return new Response('', { status: 404 })
      }),
    )
  })
  afterEach(() => {
    officeFeed.stopReplay()
    vi.unstubAllGlobals()
  })

  const pressL = (target: EventTarget = document.body, init: KeyboardEventInit = {}): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true, cancelable: true, ...init }))
  }

  it('toggles the timelapse bar with L while the office is visible', async () => {
    await mountView()
    const office = useOfficeStore()
    pressL()
    await flushPromises()
    expect(office.timelapse).toBe(true)
    expect(w!.find('[data-lapse-bar]').exists()).toBe(true)
    pressL()
    await flushPromises()
    expect(office.timelapse).toBe(false)
    expect(w!.find('[data-lapse-bar]').exists()).toBe(false)
  })

  it('ignores L typed in a field, with a modifier, or while a dialog is open', async () => {
    await mountView()
    const office = useOfficeStore()
    const input = document.createElement('input')
    document.body.append(input)
    pressL(input)
    pressL(document.body, { ctrlKey: true })
    useUiStore().settingsOpen = true
    pressL()
    useUiStore().settingsOpen = false
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.append(inner)
    document.body.append(dialog)
    pressL(inner)
    await flushPromises()
    expect(office.timelapse).toBe(false)
  })

  it('stops listening for L once the office is left', async () => {
    await mountView()
    w!.unmount()
    w = null
    pressL()
    expect(useOfficeStore().timelapse).toBe(false)
  })

  it('tints the canvas sepia while replaying and shows the REPLAY badge', async () => {
    await mountView()
    const canvas = (): HTMLCanvasElement => w!.find('canvas').element as HTMLCanvasElement
    expect(canvas().style.filter).toBe('')
    useOfficeStore().timelapse = true
    await flushPromises()
    expect(officeFeed.replaying).toBe(true)
    expect(canvas().style.filter).toBe('sepia(0.3) saturate(0.9) contrast(1.03)')
    expect(world().setPlayback).toHaveBeenCalledWith(expect.objectContaining({ clock: expect.any(Function) }))
    expect(w!.find('[data-lapse-badge]').text()).toContain('REPLAY')
    await w!.find('[data-lapse-live]').trigger('click')
    expect(canvas().style.filter).toBe('')
    expect(world().setPlayback).toHaveBeenLastCalledWith(null)
    expect(officeFeed.replaying).toBe(false)
  })

  it('hides the "no agents" note while the timelapse bar is open', async () => {
    await mountView()
    officeFeed.ingestLive({ rev: 1, serverTime: 1, rooms: [], agents: [], accounts: [], meta: {} } as unknown as OfficeSnapshot)
    await flushPromises()
    expect(w!.find('[data-office-empty]').exists()).toBe(true)
    // No history: the live (empty) office stays on screen under the bar.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    useOfficeStore().timelapse = true
    await flushPromises()
    expect(w!.find('[data-office-empty]').exists()).toBe(false)
  })

  it('ends any replay when the office is left', async () => {
    await mountView()
    useOfficeStore().timelapse = true
    await flushPromises()
    expect(officeFeed.replaying).toBe(true)
    w!.unmount()
    w = null
    expect(officeFeed.replaying).toBe(false)
    expect(useOfficeStore().replaying).toBe(false)
    expect(useOfficeStore().timelapse).toBe(false)
  })
})

const PACK_ROOM = { carpet: '#a1b2c3', carpet2: '#99aabb', wall: { base: '#f3eee4', trim: '#c9a77c', pattern: 'wood_panel' }, accent: '#7c8b5a', deskVariant: 'wood', chairVariant: 'green' }
const JAPANDI = { id: 'japandi', name: { en: 'Japandi', vi: 'Japandi' }, preview: '/assets/themes/japandi/preview.png' }
const NIGHT = { id: 'night-shift', name: { en: 'Night shift', vi: 'Ca đêm' }, preview: '/assets/themes/night-shift/preview.png' }

describe('Office theme packs', () => {
  const lastOpts = () => vi.mocked(createWorld).mock.calls.at(-1)![2]

  it('builds the classic office by default', async () => {
    await mountView()
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, warmUpMs: WARM_UP_MS })
    expect(roomTheme(0).carpet).toBe('#c9d1dc')
    expect(useOfficeStore().packMissing).toBeNull()
  })

  it('loads the saved pack: wall art from its folder, rooms from its theme', async () => {
    h.packs.index = [JAPANDI]
    h.packs.rooms = { japandi: [PACK_ROOM] }
    localStorage.setItem(OFFICE_PACK_KEY, 'japandi')
    setup()
    await mountView()
    expect(lastOpts()).toEqual({ assetPack: 'themes/japandi', assets: null, warmUpMs: WARM_UP_MS })
    expect(roomTheme(0).carpet).toBe('#a1b2c3')
    expect(roomTheme(5).carpet).toBe('#a1b2c3')
  })

  it('falls back to classic for a pack the index does not list', async () => {
    localStorage.setItem(OFFICE_PACK_KEY, 'seaside')
    setup()
    await mountView()
    const office = useOfficeStore()
    expect(office.activePack).toBe('classic')
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, warmUpMs: WARM_UP_MS })
    expect(office.packMissing).toBe('seaside')
  })

  it('keeps the classic rooms when a listed pack has no valid theme yet', async () => {
    h.packs.index = [JAPANDI]
    h.packs.rooms = { japandi: [{ ...PACK_ROOM, deskVariant: 'glass' }] }
    localStorage.setItem(OFFICE_PACK_KEY, 'japandi')
    setup()
    await mountView()
    expect(roomTheme(0).carpet).toBe('#c9d1dc')
    expect(useOfficeStore().packMissing).toBe('japandi')
  })

  it('ignores a malformed saved id', () => {
    localStorage.setItem(OFFICE_PACK_KEY, '../etc')
    setup()
    expect(useOfficeStore().pack).toBe('classic')
  })

  it('rebuilds the world when the pack changes, seasonal theme still applied', async () => {
    h.packs.index = [JAPANDI, NIGHT]
    h.packs.rooms = { japandi: [PACK_ROOM], 'night-shift': [{ ...PACK_ROOM, carpet: '#1d2240', carpet2: '#232a4d' }] }
    localStorage.setItem(OFFICE_OPTIONS_KEY, JSON.stringify({ theme: 'halloween' }))
    setup()
    await mountView()
    const first = world()
    const office = useOfficeStore()
    office.setPack('night-shift')
    await flushPromises()
    expect(localStorage.getItem(OFFICE_PACK_KEY)).toBe('night-shift')
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(createWorld).toHaveBeenCalledTimes(2)
    expect(lastOpts()).toEqual({ assetPack: 'themes/night-shift', assets: null, warmUpMs: WARM_UP_MS })
    expect(roomTheme(0).carpet).toBe('#1d2240')
    expect(world().setOptions).toHaveBeenCalledWith(expect.objectContaining({ theme: 'halloween' }))
    office.setPack('classic')
    await flushPromises()
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, warmUpMs: WARM_UP_MS })
    expect(roomTheme(0).carpet).toBe('#c9d1dc')
  })

  it('validates the seasonal theme option', () => {
    localStorage.setItem(OFFICE_OPTIONS_KEY, JSON.stringify({ theme: 'easter' }))
    setup()
    expect(useOfficeStore().options.theme).toBe('auto')
    localStorage.setItem(OFFICE_OPTIONS_KEY, JSON.stringify({ theme: 'christmas' }))
    setup()
    expect(useOfficeStore().options.theme).toBe('christmas')
  })

  it('picks a pack and a seasonal theme from the options popover', async () => {
    h.packs.index = [JAPANDI, NIGHT]
    w = mount(OfficeOptions, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await w.find('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    const cards = w.findAll('[data-office-pack]')
    expect(cards.map((c) => c.attributes('data-office-pack'))).toEqual(['classic', 'japandi', 'night-shift'])
    expect(cards[0]!.attributes('aria-checked')).toBe('true')
    await cards[1]!.trigger('click')
    expect(useOfficeStore().pack).toBe('japandi')
    expect(localStorage.getItem(OFFICE_PACK_KEY)).toBe('japandi')
    expect(w.find('[data-office-pack="japandi"]').attributes('aria-checked')).toBe('true')
    await w.find('[data-office-packs] [role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    expect(useOfficeStore().pack).toBe('night-shift')
    const halloween = w.findAll('[role="radio"]').find((b) => b.text() === 'Halloween')!
    await halloween.trigger('click')
    expect(useOfficeStore().options.theme).toBe('halloween')
  })

  it('tells the owner when the chosen pack is not installed', async () => {
    useOfficeStore().packMissing = 'seaside'
    w = mount(OfficeOptions, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await w.find('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-office-pack-missing]').text()).toContain('seaside')
  })
})

describe('Office full screen', () => {
  it('puts the map region (canvas + floating Office controls) in full screen from a toolbar button and Shift+F', async () => {
    const src = (await import('../AgentMap.vue?raw')).default
    expect(src).toContain('const officeFs = useFullscreen(canvas)')
    const start = src.indexOf('data-office-fullscreen-toggle')
    expect(start).toBeGreaterThan(-1)
    const button = src.slice(src.lastIndexOf('<button', start), src.indexOf('</button>', start))
    expect(button).toContain('aria-keyshortcuts="Shift+F"')
    expect(button).toContain(':aria-pressed="officeFullscreen"')
    expect(src).toMatch(/e\.code !== 'KeyF' \|\| !e\.shiftKey/)
    expect(src).toMatch(/if \(v !== 'office'\) void officeFs\.exit\(\)/)
    const region = src.slice(src.indexOf('ref="canvas"'), src.indexOf('<ToolTimeline'))
    expect(region).toContain('data-office-fullscreen')
    const toolbar = src.indexOf('<OfficeOptions />')
    expect(toolbar).toBeGreaterThan(src.indexOf('ref="canvas"'))
  })

  it('renders the options popover and the timelapse bar inside the full screen element (no teleport)', async () => {
    const options = (await import('./OfficeOptions.vue?raw')).default
    const view = (await import('./OfficeView.vue?raw')).default
    const lapse = (await import('./OfficeTimelapse.vue?raw')).default
    for (const src of [options, view, lapse]) expect(src).not.toContain('Teleport')
  })

  it('has every v62 office string in English and Vietnamese', () => {
    type Tree = { [k: string]: Tree | string }
    const keys = (t: Tree, p = ''): string[] => Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v, `${p}${k}.`)))
    const en = keys(officeI18nV62.en as unknown as Tree)
    expect(keys(officeI18nV62.vi as unknown as Tree)).toEqual(en)
    for (const k of en) {
      expect(i18n.global.te(k, 'en')).toBe(true)
      expect(i18n.global.te(k, 'vi')).toBe(true)
    }
  })
})

describe('Office style', () => {
  const lastOpts = () => vi.mocked(createWorld).mock.calls.at(-1)![2] as Record<string, unknown>

  it('without the dev flag the world gets no projection and no renderer', async () => {
    await mountView()
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, warmUpMs: WARM_UP_MS })
  })

  it('with ccm.office.style=iso the world gets the iso projection and renderer factory', async () => {
    const { OFFICE_STYLE_KEY } = await import('../../office/iso')
    const { isoProjection } = await import('../../office/iso/projection')
    const { createIsoRenderer, isoMaxZoom } = await import('../../office/iso/IsoRenderer')
    const { ISO_TEXT } = await import('../../office/iso/fonts')
    localStorage.setItem(OFFICE_STYLE_KEY, 'iso')
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await mountView()
    await vi.waitFor(() => expect(createWorld).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, projection: isoProjection, renderer: createIsoRenderer, maxZoom: isoMaxZoom, text: ISO_TEXT, warmUpMs: WARM_UP_MS })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/assets/iso3d/manifest.json'))
    await vi.waitFor(() => expect(useOfficeStore().isoArtMissing).toBe(true))
    expect(world().canvas.dataset.officeStyle).toBe('iso')
    expect(world().canvas.className).not.toContain('pixelated')
    vi.unstubAllGlobals()
  })

  it('any other flag value keeps the pixel office', async () => {
    localStorage.setItem('ccm.office.style', 'pixel')
    await mountView()
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, warmUpMs: WARM_UP_MS })
    expect(world().canvas.className).toContain('pixelated')
  })

  it('switching the style persists it and rebuilds the world each way', async () => {
    const { OFFICE_STYLE_KEY } = await import('../../office/iso')
    const { isoProjection } = await import('../../office/iso/projection')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await mountView()
    const first = world()
    const office = useOfficeStore()
    expect(office.style).toBe('pixel')
    office.setStyle('iso')
    expect(localStorage.getItem(OFFICE_STYLE_KEY)).toBe('iso')
    await vi.waitFor(() => expect(createWorld).toHaveBeenCalledTimes(2), { timeout: 5000 })
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(lastOpts().projection).toBe(isoProjection)
    office.setStyle('iso')
    await flushPromises()
    expect(createWorld).toHaveBeenCalledTimes(2)
    office.setStyle('pixel')
    await vi.waitFor(() => expect(createWorld).toHaveBeenCalledTimes(3), { timeout: 5000 })
    expect(lastOpts()).toEqual({ assetPack: undefined, assets: null, warmUpMs: WARM_UP_MS })
    expect(office.isoArtMissing).toBe(false)
    expect(localStorage.getItem(OFFICE_STYLE_KEY)).toBe('pixel')
    office.setStyle('voxel' as never)
    expect(office.style).toBe('pixel')
    vi.unstubAllGlobals()
  })

  it('restores the saved style in a new store', async () => {
    localStorage.setItem('ccm.office.style', 'iso')
    setup()
    expect(useOfficeStore().style).toBe('iso')
  })

  it('picks the style from the options popover and notes missing 3D art', async () => {
    w = mount(OfficeOptions, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await w.find('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    const radios = w.findAll('[data-office-style] [role="radio"]')
    expect(radios.map((r) => r.text())).toEqual(['Pixel', '3D (beta)'])
    await radios[1]!.trigger('click')
    expect(useOfficeStore().style).toBe('iso')
    expect(localStorage.getItem('ccm.office.style')).toBe('iso')
    expect(w.find('[data-office-style-missing]').exists()).toBe(false)
    useOfficeStore().isoArtMissing = true
    await flushPromises()
    expect(w.find('[data-office-style-missing]').text()).toContain('3D art is not installed')
  })

  it('has every v63 office string in English and Vietnamese', async () => {
    const v63 = (await import('../../i18n/office-v63')).default
    type Tree = { [k: string]: Tree | string }
    const keys = (t: Tree, p = ''): string[] => Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : keys(v, `${p}${k}.`)))
    const en = keys(v63.en as unknown as Tree)
    expect(keys(v63.vi as unknown as Tree)).toEqual(en)
    for (const k of en) {
      expect(i18n.global.te(k, 'en')).toBe(true)
      expect(i18n.global.te(k, 'vi')).toBe(true)
    }
  })
})

describe('Office style switch: loading overlay, cancel, preload', () => {
  const canvases = () => w!.findAll('canvas')
  const overlayEl = () => w!.find('[data-office-switching]')

  async function mountReady(): Promise<FakeWorld> {
    h.ready.manual = true
    await mountView()
    const first = world()
    expect(useOfficeStore().world).toBeNull()
    first.fireReady()
    await flushPromises()
    expect(useOfficeStore().world).toStrictEqual(first)
    return first
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the current office on screen and shows the overlay only after 150 ms, until the new world is ready', async () => {
    const first = await mountReady()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    i18n.global.locale.value = 'vi'
    await flushPromises()
    expect(createWorld).toHaveBeenCalledTimes(2)
    const next = world()
    const office = useOfficeStore()
    expect(office.switching).toBe(true)
    expect(first.destroy).not.toHaveBeenCalled()
    expect(office.world).toStrictEqual(first)
    expect(canvases()).toHaveLength(2)
    expect(canvases()[1]!.attributes('data-office-layer')).toBe('pending')
    expect(canvases()[1]!.classes()).toContain('opacity-0')
    vi.advanceTimersByTime(SWITCH_OVERLAY_DELAY_MS - 1)
    await nextTick()
    expect(overlayEl().exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(overlayEl().exists()).toBe(true)
    expect(overlayEl().text()).toBe('Đang tải văn phòng pixel…')
    expect(overlayEl().attributes('role')).toBe('status')
    next.fireReady()
    await flushPromises()
    expect(overlayEl().exists()).toBe(false)
    expect(office.switching).toBe(false)
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(office.world).toStrictEqual(next)
    expect(canvases()).toHaveLength(2)
    expect(canvases()[1]!.attributes('data-office-layer')).toBe('live')
    vi.advanceTimersByTime(LAYER_FADE_MS)
    await nextTick()
    expect(canvases()).toHaveLength(1)
    expect(next.canvas).toBe(canvases()[0]!.element)
  })

  it('never shows the overlay for a switch faster than 150 ms', async () => {
    await mountReady()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    i18n.global.locale.value = 'vi'
    await flushPromises()
    vi.advanceTimersByTime(100)
    world().fireReady()
    await flushPromises()
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(overlayEl().exists()).toBe(false)
    expect(useOfficeStore().switching).toBe(false)
  })

  it('switching back mid-load cancels cleanly: no second world, nothing leaked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const first = await mountReady()
    const office = useOfficeStore()
    office.setStyle('iso')
    await vi.waitFor(() => expect(createWorld).toHaveBeenCalledTimes(2), { timeout: 5000 })
    const pendingWorld = world()
    expect(office.switching).toBe(true)
    expect(canvases()).toHaveLength(2)
    expect(pendingWorld.readyCbs.size).toBe(1)
    office.setStyle('pixel')
    await flushPromises()
    expect(pendingWorld.destroy).toHaveBeenCalledTimes(1)
    expect(pendingWorld.readyCbs.size).toBe(0)
    expect(first.destroy).not.toHaveBeenCalled()
    expect(createWorld).toHaveBeenCalledTimes(2)
    expect(office.world).toStrictEqual(first)
    expect(office.switching).toBe(false)
    expect(canvases()).toHaveLength(1)
    expect(canvases()[0]!.attributes('data-office-style')).toBe('pixel')
    pendingWorld.fireReady()
    await flushPromises()
    expect(office.world).toStrictEqual(first)
    w!.unmount()
    w = null
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(pendingWorld.destroy).toHaveBeenCalledTimes(1)
  })

  it('unmounting mid-switch destroys both worlds once', async () => {
    const first = await mountReady()
    i18n.global.locale.value = 'vi'
    await flushPromises()
    const next = world()
    expect(next).not.toBe(first)
    w!.unmount()
    w = null
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(next.destroy).toHaveBeenCalledTimes(1)
    expect(useOfficeStore().switching).toBe(false)
  })

  it('schedules the background 3D preload once the pixel office is ready, not for the 3D office', async () => {
    await mountReady()
    expect(scheduleIsoPreload).toHaveBeenCalledTimes(1)
    w!.unmount()
    w = null
    vi.mocked(scheduleIsoPreload).mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    localStorage.setItem('ccm.office.style', 'iso')
    setup()
    h.ready.manual = false
    await mountView()
    await vi.waitFor(() => expect(createWorld).toHaveBeenCalledTimes(2), { timeout: 5000 })
    await flushPromises()
    expect(scheduleIsoPreload).not.toHaveBeenCalled()
  })

  it('the first open of a 3D office waits for its first frame behind the loading state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    localStorage.setItem('ccm.office.style', 'iso')
    setup()
    h.ready.manual = true
    await mountView()
    await vi.waitFor(() => expect(createWorld).toHaveBeenCalledTimes(1), { timeout: 5000 })
    await flushPromises()
    expect(w!.find('[data-office-state]').exists()).toBe(true)
    expect(canvases()[0]!.attributes('data-office-layer')).toBe('pending')
    world().fireReady()
    await flushPromises()
    expect(canvases()[0]!.attributes('data-office-layer')).toBe('live')
    expect(canvases()[0]!.attributes('data-office-style')).toBe('iso')
    expect(overlayEl().exists()).toBe(false)
  })

  it('disables the style control while a switch is loading', async () => {
    w = mount(OfficeOptions, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await w.find('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    const office = useOfficeStore()
    office.switching = true
    await nextTick()
    const radios = w.findAll('[data-office-style] [role="radio"]')
    expect(radios.every((r) => (r.element as HTMLButtonElement).disabled)).toBe(true)
    expect(w.find('[data-office-style] [role="radiogroup"]').attributes('aria-disabled')).toBe('true')
    await radios[1]!.trigger('click')
    expect(office.style).toBe('pixel')
    office.switching = false
    await nextTick()
    await radios[1]!.trigger('click')
    expect(office.style).toBe('iso')
  })
})

describe('Office style switch: failure, intent, release', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a failed switch puts the old style back in the store and the control, with a short error note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await mountView()
    const first = world()
    const office = useOfficeStore()
    vi.mocked(createWorld).mockImplementationOnce(() => {
      throw new Error('iso failed')
    })
    office.setStyle('iso')
    await vi.waitFor(() => expect(office.style).toBe('pixel'), { timeout: 5000 })
    await flushPromises()
    expect(localStorage.getItem('ccm.office.style')).toBe('pixel')
    expect(office.world).toStrictEqual(first)
    expect(first.destroy).not.toHaveBeenCalled()
    expect(office.switching).toBe(false)
    expect(w!.findAll('canvas')).toHaveLength(1)
    const note = w!.find('[data-office-switch-error]')
    expect(note.attributes('role')).toBe('alert')
    expect(note.text()).toBe(i18n.global.t('officeV63.switchFailed.iso'))
    expect(createWorld).toHaveBeenCalledTimes(2)
  })

  it('error note hides after a few seconds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await mountView()
    const office = useOfficeStore()
    vi.mocked(createWorld).mockImplementationOnce(() => {
      throw new Error('iso failed')
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    office.setStyle('iso')
    await vi.waitFor(() => expect(office.switchError).toBe('iso'), { timeout: 5000 })
    vi.advanceTimersByTime(SWITCH_ERROR_MS)
    await nextTick()
    expect(office.switchError).toBeNull()
    expect(w!.find('[data-office-switch-error]').exists()).toBe(false)
  })

  it('decodes the 3D art only on intent, and releases it a minute after the pixel office is back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await mountView()
    const office = useOfficeStore()
    expect(warmIsoArt).not.toHaveBeenCalled()
    office.noteIsoIntent()
    await nextTick()
    expect(warmIsoArt).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(ISO_RELEASE_MS - 1)
    await flushPromises()
    expect(releaseIsoArt).not.toHaveBeenCalled()
    office.noteIsoIntent()
    await nextTick()
    vi.advanceTimersByTime(ISO_RELEASE_MS - 1)
    await flushPromises()
    expect(releaseIsoArt).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(releaseIsoArt).toHaveBeenCalledTimes(1))
  })

  it('opening the options popover or pointing at the style control counts as intent, only in pixel', async () => {
    w = mount(OfficeOptions, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    const office = useOfficeStore()
    await w.find('button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    expect(office.isoIntent).toBe(1)
    await w.find('[data-office-style]').trigger('pointerenter')
    expect(office.isoIntent).toBe(2)
    office.setStyle('iso')
    await w.find('[data-office-style]').trigger('pointerenter')
    expect(office.isoIntent).toBe(2)
  })
})
