import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAdbWatch } from '../src/run/android/adbWatch'
import { parseAdbDeviceRows } from '../src/devices/parse'
import { killTree, type SpawnSpec, type Spawner } from '../src/run/proc'

vi.mock('../src/run/proc', async (orig) => {
  const mod = await orig<typeof import('../src/run/proc')>()
  return {
    ...mod,
    killTree: vi.fn((child: FakeChild) => {
      if (child.exitCode !== null) return
      child.exitCode = -1
      process.nextTick(() => child.emit('close', null))
    }),
  }
})

interface FakeChild extends EventEmitter {
  key: string
  spec: SpawnSpec
  exitCode: number | null
  pid: undefined
  stdout: EventEmitter & { resume: () => void }
  stderr: EventEmitter & { resume: () => void }
  unref: () => void
  out: (text: string) => void
  exit: (code: number) => void
}

type Reply = { out?: string; code?: number } | 'live'
type Route = [RegExp, Reply | ((key: string) => Reply)]

function stream(): EventEmitter & { resume: () => void } {
  return Object.assign(new EventEmitter(), { resume: () => undefined })
}

function fakeSpawn(routes: Route[]): { spawn: Spawner; calls: FakeChild[]; keys: () => string[] } {
  const calls: FakeChild[] = []
  const spawn: Spawner = (spec) => {
    const key = [spec.file.replace(/\\/g, '/').split('/').pop(), ...spec.args].join(' ')
    const child = Object.assign(new EventEmitter(), {
      key,
      spec,
      exitCode: null as number | null,
      pid: undefined,
      stdout: stream(),
      stderr: stream(),
      unref: () => undefined,
      out(text: string) {
        child.stdout.emit('data', Buffer.from(text))
      },
      exit(code: number) {
        child.exitCode = code
        child.emit('close', code)
      },
    }) as FakeChild
    calls.push(child)
    const route = routes.find(([re]) => re.test(key))
    const reply = route ? (typeof route[1] === 'function' ? route[1](key) : route[1]) : { code: 0 }
    if (reply !== 'live') {
      process.nextTick(() => {
        if (reply.out) child.out(reply.out)
        child.exit(reply.code ?? 0)
      })
    }
    return child as unknown as ChildProcess
  }
  return { spawn, calls, keys: () => calls.map((c) => c.key) }
}

const frame = (body: string): string => body.length.toString(16).padStart(4, '0') + body

const base = { cwd: '/tmp', adb: async () => '/sdk/platform-tools/adb', parse: parseAdbDeviceRows }

describe('createAdbWatch', () => {
  it('publishes a state change inside the same device set', async () => {
    const fake = fakeSpawn([[/track-devices/, 'live']])
    const watch = createAdbWatch({ ...base, spawn: fake.spawn })
    const seen: string[] = []
    watch.onChange((rows) => seen.push(rows[0]!.state))
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    fake.calls[0]!.out(frame('R58\tunauthorized\n'))
    fake.calls[0]!.out(frame('R58\tdevice\n'))
    expect(seen).toEqual(['unauthorized', 'ready'])
    watch.stop()
  })

  it('restarts the tracker then falls back to polling', async () => {
    const fake = fakeSpawn([
      [/track-devices/, { code: 1 }],
      [/devices -l$/, { out: 'List of devices attached\nR58M  device usb:1 model:SM_G991B\n' }],
    ])
    const watch = createAdbWatch({ ...base, spawn: fake.spawn, timing: { pollMs: 5 } })
    const seen: string[][] = []
    watch.onChange((rows) => seen.push(rows.map((r) => r.id)))
    await vi.waitFor(() => expect(seen).toEqual([['R58M']]))
    expect(fake.keys().filter((k) => k.includes('track-devices'))).toHaveLength(4)
    await vi.waitFor(() => expect(fake.keys().filter((k) => k.endsWith('devices -l')).length).toBeGreaterThan(1))
    watch.stop()
  })

  it('stop kills the tracker with the injected kill, not a tree kill', async () => {
    vi.mocked(killTree).mockClear()
    const fake = fakeSpawn([[/track-devices/, 'live']])
    const kill = vi.fn()
    const watch = createAdbWatch({ ...base, spawn: fake.spawn, kill })
    watch.onChange(() => undefined)
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    watch.stop(true)
    expect(kill).toHaveBeenCalledWith(fake.calls[0], true)
    expect(killTree).not.toHaveBeenCalled()
  })

  it('polls with the injected kill on timeout', async () => {
    vi.mocked(killTree).mockClear()
    const fake = fakeSpawn([
      [/track-devices/, { code: 1 }],
      [/devices -l$/, 'live'],
    ])
    const kill = vi.fn()
    const watch = createAdbWatch({ ...base, spawn: fake.spawn, kill, timing: { maxRestarts: 0, pollMs: 5, pollTimeoutMs: 20 } })
    watch.onChange(() => undefined)
    await vi.waitFor(() => expect(kill).toHaveBeenCalled())
    expect(kill.mock.calls[0]![0].key).toMatch(/devices -l$/)
    expect(killTree).not.toHaveBeenCalled()
    watch.stop()
  })

  it('list resolves [] after firstListMs when adb is missing', async () => {
    const fake = fakeSpawn([])
    const watch = createAdbWatch({ ...base, adb: async () => null, spawn: fake.spawn, timing: { firstListMs: 10 } })
    expect(await watch.list()).toEqual([])
    expect(fake.calls).toHaveLength(0)
    watch.stop()
  })
})
