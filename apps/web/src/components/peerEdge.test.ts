import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import { i18n } from '../i18n'
import { MAP_RUNNERS, PEER_MAP, type PeerLane, type PeerMapContext, type RunnerBudget } from '../composables/useMapNode'
import PeerEdge from './PeerEdge.vue'

const node = (x: number) => ({ computedPosition: { x, y: 0, z: 0 }, dimensions: { width: 300, height: 96 } })

let w: VueWrapper | null = null
let fly: ((lane: PeerLane, n: number) => void) | null = null
let landed: string[] = []
let running = 0

function mountEdge(capacity = 6) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const ctx: PeerMapContext = {
    scoped: false,
    rings: shallowRef({}),
    slots: ref(new Map()),
    listen(_id, f) {
      fly = f
      return () => (fly = null)
    },
    landed: (tid) => landed.push(tid),
    goTo: () => undefined,
  }
  const budget: RunnerBudget = {
    take: () => (running < capacity ? (running++, true) : false),
    give: () => void running--,
  }
  const props = { id: 'peer:a>b', sourceNode: node(0), targetNode: node(364), data: { linkId: 'a>b', kind: 'message', a: 'a', b: 'b' } } as never
  const Host = defineComponent({ render: () => h('svg', [h(PeerEdge, props)]) })
  w = mount(Host, {
    global: { plugins: [i18n, pinia], provide: { [PEER_MAP]: ctx, [MAP_RUNNERS]: budget } },
    attachTo: document.body,
  })
}

const envelopes = () => document.querySelectorAll('[data-peer-envelope]')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  landed = []
  running = 0
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  const globals = window as unknown as Record<string, { prototype: Record<string, unknown> } | undefined>
  for (const name of ['SVGElement', 'SVGGeometryElement', 'SVGPathElement']) {
    const proto = globals[name]?.prototype
    if (!proto) continue
    proto.getTotalLength = () => 200
    proto.getPointAtLength = (l: number) => ({ x: l, y: -l / 10 })
  }
})

afterEach(() => {
  w?.unmount()
  w = null
  fly = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('peer edge envelopes', () => {
  it('flies one envelope per lane and folds messages that arrive mid-flight into the next one', async () => {
    mountEdge()
    expect(fly).not.toBeNull()
    fly!('ab', 1)
    await vi.advanceTimersByTimeAsync(100)
    await nextTick()
    expect(envelopes()).toHaveLength(1)
    expect(document.querySelector('.ccm-peer-edge-hot')).not.toBeNull()
    fly!('ab', 1)
    fly!('ab', 1)
    await nextTick()
    expect(envelopes()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(700)
    await nextTick()
    expect(landed).toEqual(['b'])
    expect(document.querySelector('[data-peer-envelope] text')?.textContent).toBe('×2')
    await vi.advanceTimersByTimeAsync(800)
    await nextTick()
    expect(landed).toEqual(['b', 'b'])
    expect(envelopes()).toHaveLength(0)
    expect(running).toBe(0)
    await vi.advanceTimersByTimeAsync(1300)
    await nextTick()
    expect(document.querySelector('.ccm-peer-edge-hot')).toBeNull()
  })

  it('runs both directions at once and lands each on its receiver', async () => {
    mountEdge()
    fly!('ab', 1)
    fly!('ba', 1)
    await vi.advanceTimersByTimeAsync(100)
    await nextTick()
    expect(envelopes()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(700)
    expect(landed.sort()).toEqual(['a', 'b'])
  })

  it('lands at once without an envelope when the map has no runner left', async () => {
    mountEdge(0)
    fly!('ab', 3)
    await vi.advanceTimersByTimeAsync(100)
    await nextTick()
    expect(envelopes()).toHaveLength(0)
    expect(landed).toEqual(['b'])
    expect(document.querySelector('.ccm-peer-edge-hot')).not.toBeNull()
  })
})
