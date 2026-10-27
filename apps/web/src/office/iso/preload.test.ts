import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ISO_USED_KEY, loadIso } from './index'
import { ISO_ART_BACKGROUND, ISO_ART_URGENT, isoArt, isoArtLimiter, Limiter, loadedIsoArt, releaseIsoArt, resetIsoArt, resetIsoManifests } from './isoArt'
import { lowPowerNow, preloadDone, preloadState, resetIsoPreload, scheduleIsoPreload, warmIsoArt } from './preload'

function idleQueue() {
  const q: (() => void)[] = []
  return { q, idle: (cb: () => void) => void q.push(cb), run: () => q.splice(0).forEach((cb) => cb()) }
}

function hiddenDoc(hidden: boolean) {
  const doc = Object.assign(new EventTarget(), { hidden })
  return doc as unknown as Document & { hidden: boolean }
}

beforeEach(() => {
  resetIsoPreload()
  resetIsoArt()
  resetIsoManifests()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('scheduleIsoPreload', () => {
  it('runs once per session, on idle, at low priority', async () => {
    const { idle, q, run } = idleQueue()
    const load = vi.fn(async () => undefined)
    expect(scheduleIsoPreload({ doc: hiddenDoc(false), idle, lowPower: async () => false, load })).toBe(true)
    expect(scheduleIsoPreload({ doc: hiddenDoc(false), idle, lowPower: async () => false, load })).toBe(false)
    expect(q).toHaveLength(1)
    expect(load).not.toHaveBeenCalled()
    expect(preloadState()).toBe('waiting')
    run()
    await preloadDone()
    expect(load).toHaveBeenCalledTimes(1)
    expect(preloadState()).toBe('done')
    expect(scheduleIsoPreload({ doc: hiddenDoc(false), idle, lowPower: async () => false, load })).toBe(false)
    expect(q).toHaveLength(0)
  })

  it('waits while the window is hidden, then goes idle once visible', async () => {
    const { idle, q, run } = idleQueue()
    const doc = hiddenDoc(true)
    const load = vi.fn(async () => undefined)
    scheduleIsoPreload({ doc, idle, lowPower: async () => false, load })
    expect(q).toHaveLength(0)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(q).toHaveLength(0)
    doc.hidden = false
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(q).toHaveLength(1)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(q).toHaveLength(1)
    run()
    await preloadDone()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('skips on data saver or a low battery', async () => {
    const { idle, run } = idleQueue()
    const load = vi.fn(async () => undefined)
    scheduleIsoPreload({ doc: hiddenDoc(false), idle, lowPower: async () => true, load })
    run()
    await preloadDone()
    expect(load).not.toHaveBeenCalled()
    expect(preloadState()).toBe('skipped')
    expect(await lowPowerNow({ connection: { saveData: true } })).toBe(true)
    expect(await lowPowerNow({ getBattery: async () => ({ charging: false, level: 0.15 }) })).toBe(true)
    expect(await lowPowerNow({ getBattery: async () => ({ charging: true, level: 0.15 }) })).toBe(false)
    expect(await lowPowerNow({ getBattery: async () => ({ charging: false, level: 0.8 }) })).toBe(false)
    expect(await lowPowerNow({})).toBe(false)
  })

  it('without 3D use: idle preload fetches only the chunk, manifests and fonts, never decodes images', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const bitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', bitmap)
    const { idle, run } = idleQueue()
    scheduleIsoPreload({ doc: hiddenDoc(false), idle, lowPower: async () => false })
    run()
    await preloadDone()
    expect(preloadState()).toBe('done')
    expect(loadedIsoArt()).toBeNull()
    expect(isoArtLimiter()).toBeNull()
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls).toContain('/assets/iso3d/manifest.json')
    expect(urls).toContain('/assets/iso3d/chars/manifest.json')
    expect(urls.every((u) => u.endsWith('.json'))).toBe(true)
    expect(bitmap).not.toHaveBeenCalled()
  })

  it('after 3D was used once: preload decodes, and loadIso reuses the art without fetching again', async () => {
    localStorage.setItem(ISO_USED_KEY, '1')
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { idle, run } = idleQueue()
    scheduleIsoPreload({ doc: hiddenDoc(false), idle, lowPower: async () => false })
    run()
    await preloadDone()
    const art = loadedIsoArt()
    expect(art).not.toBeNull()
    expect(isoArtLimiter()?.limit).toBe(ISO_ART_BACKGROUND)
    const calls = fetchMock.mock.calls.length
    const kit = await loadIso('iso')
    expect(await kit!.art).toBe(art)
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(isoArtLimiter()?.limit).toBe(ISO_ART_URGENT)
  })

  it('warmIsoArt decodes on intent; releaseIsoArt closes the bitmaps and drops the cache', async () => {
    const closes: number[] = []
    const manifests: Record<string, unknown> = {
      '/assets/iso3d/manifest.json': { version: 1, scale: 2, furniture: 'furniture/manifest.json' },
      '/assets/iso3d/furniture/manifest.json': { version: 1, scale: 2, items: { desk: { file: 'desk.webp', anchor: [1, 1], footprint: [1, 1] }, chair: { file: 'chair.webp', anchor: [1, 1], footprint: [1, 1] } } },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url in manifests ? new Response(JSON.stringify(manifests[url]), { status: 200 }) : new Response(new Blob([new Uint8Array([1])]), { status: 200 }))),
    )
    let n = 0
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        const id = n++
        return { width: 4, height: 4, close: () => closes.push(id) }
      }),
    )
    await warmIsoArt()
    const art = loadedIsoArt()
    expect(art?.furniture.size).toBe(2)
    expect(releaseIsoArt()).toBe(2)
    expect(closes.sort()).toEqual([0, 1])
    expect(loadedIsoArt()).toBeNull()
    const again = isoArt()
    expect(await again).not.toBe(art)
  })
})

describe('isoArt loading', () => {
  it('Limiter keeps at most N tasks in flight and can be raised', async () => {
    const lim = new Limiter(4)
    const gates: (() => void)[] = []
    let peak = 0
    const task = () =>
      new Promise<void>((r) => {
        peak = Math.max(peak, lim.running)
        gates.push(r)
      })
    const all = Array.from({ length: 10 }, () => lim.run(task))
    expect(lim.running).toBe(4)
    gates.shift()!()
    await Promise.resolve()
    await Promise.resolve()
    expect(lim.running).toBe(4)
    lim.raise(8)
    expect(lim.running).toBe(8)
    while (gates.length) {
      gates.shift()!()
      await new Promise((r) => setTimeout(r, 0))
    }
    await Promise.all(all)
    expect(peak).toBeLessThanOrEqual(8)
    expect(lim.running).toBe(0)
  })

  it('decodes off the main thread with createImageBitmap, 4 at a time in the background', async () => {
    const manifests: Record<string, unknown> = {
      '/assets/iso3d/manifest.json': { version: 1, scale: 2, furniture: 'furniture/manifest.json' },
      '/assets/iso3d/furniture/manifest.json': {
        version: 1,
        scale: 2,
        items: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`desk:v${i}`, { file: `k${i}.webp`, anchor: [1, 1], footprint: [1, 1] }])),
      },
    }
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url in manifests) return new Response(JSON.stringify(manifests[url]), { status: 200, headers: { 'content-type': 'application/json' } })
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise<void>((r) => release.push(r))
        inFlight--
        return new Response(new Blob([new Uint8Array([1])]), { status: 200 })
      }),
    )
    const bitmap = vi.fn(async () => ({ width: 4, height: 4 }))
    vi.stubGlobal('createImageBitmap', bitmap)
    const p = isoArt()
    for (let i = 0; i < 100 && release.length + bitmap.mock.calls.length < 12; i++) {
      await new Promise((r) => setTimeout(r, 0))
      release.splice(0).forEach((r) => r())
    }
    const art = await p
    expect(art.furniture.size).toBe(12)
    expect(bitmap).toHaveBeenCalledTimes(12)
    expect(peak).toBe(ISO_ART_BACKGROUND)
    expect(isoArt()).toBe(p)
  })
})
