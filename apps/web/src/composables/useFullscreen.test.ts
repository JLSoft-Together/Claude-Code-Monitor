import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useFullscreen } from './useFullscreen'

let current: Element | null = null

function fire(): void {
  document.dispatchEvent(new Event('fullscreenchange'))
}

const request = vi.fn(async function (this: HTMLElement) {
  current = this
  fire()
})
const exit = vi.fn(async () => {
  current = null
  fire()
})

beforeEach(() => {
  current = null
  request.mockClear()
  exit.mockClear()
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
})

afterEach(() => {
  document.body.innerHTML = ''
})

function harness() {
  let api!: ReturnType<typeof useFullscreen>
  const Comp = defineComponent({
    setup() {
      const el = ref<HTMLElement | null>(null)
      api = useFullscreen(el)
      return () => h('div', { ref: el, 'data-host': '' })
    },
  })
  const w = mount(Comp, { attachTo: document.body })
  return { w, api: () => api }
}

describe('useFullscreen', () => {
  it('toggles the host element in and out of full screen', async () => {
    const { w, api } = harness()
    expect(api().active.value).toBe(false)
    await api().toggle()
    expect(document.fullscreenElement).toBe(w.find('[data-host]').element)
    expect(api().active.value).toBe(true)
    await api().toggle()
    expect(exit).toHaveBeenCalledTimes(1)
    expect(api().active.value).toBe(false)
    w.unmount()
  })

  it('follows a full screen exit made outside the app (Escape)', async () => {
    const { w, api } = harness()
    await api().enter()
    current = null
    fire()
    await nextTick()
    expect(api().active.value).toBe(false)
    w.unmount()
  })

  it('does not claim another element in full screen', async () => {
    const { w, api } = harness()
    current = document.createElement('section')
    fire()
    expect(api().active.value).toBe(false)
    await api().exit()
    expect(exit).not.toHaveBeenCalled()
    current = null
    w.unmount()
  })

  it('stays off when the request is refused', async () => {
    request.mockImplementationOnce(async () => Promise.reject(new Error('denied')))
    const { w, api } = harness()
    await api().enter()
    expect(api().active.value).toBe(false)
    w.unmount()
  })

  it('leaves full screen when the host unmounts', async () => {
    const { w, api } = harness()
    await api().enter()
    w.unmount()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
