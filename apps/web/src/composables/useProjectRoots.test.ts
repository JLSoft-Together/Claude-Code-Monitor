import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectRootInfo = vi.fn<(dir: string) => Promise<{ root: string; repo: boolean } | null>>()
vi.mock('../lib/projects', () => ({ projectRootInfo: (dir: string) => projectRootInfo(dir) }))

async function fresh() {
  vi.resetModules()
  return (await import('./useProjectRoots')).useProjectRoots()
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  projectRootInfo.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('useProjectRoots', () => {
  it('tries a remembered folder once, then looks it up again once a pane opens there', async () => {
    const roots = await fresh()
    projectRootInfo.mockResolvedValue(null)
    expect(roots.factsOf('C:/app', true)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(projectRootInfo).toHaveBeenCalledTimes(1)
    roots.factsOf('C:/app', true)
    await flush()
    expect(projectRootInfo).toHaveBeenCalledTimes(1)

    projectRootInfo.mockResolvedValue({ root: 'C:/app', repo: true })
    roots.factsOf('C:/app')
    await flush()
    expect(roots.factsOf('C:/app')?.top).toBe('C:/app')
  })

  it('retries a pane folder after a miss once the failure expires', async () => {
    const roots = await fresh()
    projectRootInfo.mockResolvedValue(null)
    roots.factsOf('C:/app')
    await vi.advanceTimersByTimeAsync(10_000)
    const calls = projectRootInfo.mock.calls.length
    roots.factsOf('C:/app')
    await flush()
    expect(projectRootInfo).toHaveBeenCalledTimes(calls)

    await vi.advanceTimersByTimeAsync(6_000)
    projectRootInfo.mockResolvedValue({ root: 'C:/app', repo: false })
    roots.factsOf('C:/app')
    await flush()
    expect(roots.factsOf('C:/app')?.repo).toBe(false)
  })

  it('keeps retrying for a pane that asks while a one-shot lookup is in flight', async () => {
    const roots = await fresh()
    projectRootInfo.mockResolvedValueOnce(null).mockResolvedValue({ root: 'C:/app', repo: true })
    roots.factsOf('C:/app', true)
    roots.factsOf('C:/app')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(roots.factsOf('C:/app')?.top).toBe('C:/app')
  })
})
