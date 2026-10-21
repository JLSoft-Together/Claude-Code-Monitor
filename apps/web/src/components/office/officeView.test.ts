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
  screenPositionOf: () => null
  destroy: ReturnType<typeof vi.fn>
}

const h = vi.hoisted(() => {
  const worlds: FakeWorld[] = []
  const locale = { gate: null as Promise<void> | null }
  return { worlds, locale }
})

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
      screenPositionOf: () => null,
      destroy: vi.fn(),
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
const OfficeView = (await import('./OfficeView.vue')).default
const OfficeOptions = (await import('./OfficeOptions.vue')).default

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
  h.worlds.length = 0
  h.locale.gate = null
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
