import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ActivityEvent, BackgroundJob, JobStopResult, MonitorEvent } from '@ccm/shared'
import type { CollectorConfig } from '../src/config'
import { claudeCliCandidates, stopBackgroundJob } from '../src/job-stop'
import { parseJobState } from '../src/jobs'
import { Monitor } from '../src/monitor'
import { MonitorStore } from '../src/store'

const SID = '0e1d2c3b-4a59-4687-9a1b-2c3d4e5f6a7b'

describe('claude stop runner', () => {
  it('looks for the real executable next to PATH entries and the npm package', () => {
    const list = claudeCliCandidates({ PATH: ['C:\\npm', 'C:\\bin'].join(path.delimiter), USERPROFILE: 'C:\\Users\\me' }, 'win32')
    expect(list).toContain(path.join('C:\\npm', 'claude.exe'))
    expect(list).toContain(path.join('C:\\npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
    expect(list).toContain(path.join('C:\\Users\\me', '.local', 'bin', 'claude.exe'))
    expect(list.some((f) => /\.(cmd|ps1|bat)$/i.test(f))).toBe(false)
  })

  it('runs `claude stop <id>` without a shell and maps the outcome', async () => {
    const calls: string[][] = []
    const run = async (file: string, args: string[]) => (calls.push([file, ...args]), { code: 0, stdout: '', stderr: '' })
    expect(await stopBackgroundJob('9261d07b', { findCli: async () => 'C:\\claude.exe', run })).toBe('ok')
    expect(calls).toEqual([['C:\\claude.exe', 'stop', '9261d07b']])
    const missing = async () => ({ code: 1, stdout: "No job matching 'x'. Run 'claude agents'", stderr: '' })
    expect(await stopBackgroundJob('9261d07b', { findCli: async () => 'c', run: missing })).toBe('notFound')
    expect(await stopBackgroundJob('9261d07b', { findCli: async () => 'c', run: async () => ({ code: 2, stdout: '', stderr: 'boom' }) })).toBe('failed')
    const unconfirmed = async () => ({ code: 1, stdout: "couldn't confirm 9261d07b was stopped — the background service may be restarting. Try again in a moment.", stderr: '' })
    expect(await stopBackgroundJob('9261d07b', { findCli: async () => 'c', run: unconfirmed })).toBe('unconfirmed')
    expect(await stopBackgroundJob('9261d07b', { findCli: async () => null, run })).toBe('noCli')
  })

  it('refuses ids that could be read as options', async () => {
    const run = async () => ({ code: 0, stdout: '', stderr: '' })
    expect(await stopBackgroundJob('--all', { findCli: async () => 'c', run })).toBe('failed')
    expect(await stopBackgroundJob('-x123', { findCli: async () => 'c', run })).toBe('failed')
  })

  it('reads the session id only when it is a uuid', () => {
    expect(parseJobState('abcd1', JSON.stringify({ state: 'working', sessionId: SID }))?.sessionId).toBe(SID)
    expect(parseJobState('abcd1', JSON.stringify({ state: 'working', sessionId: '../x' }))?.sessionId).toBeUndefined()
  })
})

describe('Monitor job actions', () => {
  let root: string
  let store: MonitorStore
  let now: number
  let stops: string[]
  let stopResult: JobStopResult

  const config = (): CollectorConfig => ({
    claudeRoot: root,
    host: '127.0.0.1',
    port: 0,
    toast: false,
    staleTtlMs: 120 * 60_000,
    reconcileMs: 5_000,
    processVerifyMs: 60_000,
    activityLimit: 300,
    batchMs: 1,
    verifyProcesses: false,
    webDist: root,
    dataDir: root,
    devOriginPorts: [],
    statusLineBridge: path.join(root, 'statusline-bridge.mjs'),
  })

  const monitor = () =>
    new Monitor(config(), store, {
      isPidAlive: () => true,
      queryProcesses: async () => null,
      now: () => now,
      stopJob: async (id) => (stops.push(id), stopResult),
    })

  async function writeJob(id: string, state: string, mtime: number): Promise<void> {
    const dir = path.join(root, 'jobs', id)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'state.json')
    await writeFile(file, JSON.stringify({ state, name: id, sessionId: SID, intent: 'secret' }))
    await utimes(file, mtime / 1000, mtime / 1000)
  }

  const snapshot = () => (store.snapshotMessage().events[0] as Extract<MonitorEvent, { type: 'snapshot' }>).payload
  const jobs = (): BackgroundJob[] => snapshot().jobs ?? []
  const activity = (): ActivityEvent[] => snapshot().activity

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ccm-jobact-'))
    store = new MonitorStore({ activityLimit: 100, batchMs: 1 })
    now = Date.now()
    stops = []
    stopResult = 'ok'
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('dismisses jobs until their state changes again; clear-all only takes done ones', async () => {
    await writeJob('done0001', 'done', now - 60_000)
    await writeJob('done0002', 'done', now - 50_000)
    await writeJob('work0001', 'working', now - 40_000)
    const m = monitor()
    await m.pollExtras()
    expect(jobs().map((j) => j.id).sort()).toEqual(['done0001', 'done0002', 'work0001'])
    expect(jobs()[0]?.sessionId).toBe(SID)
    expect(JSON.stringify(jobs())).not.toContain('secret')

    expect(m.dismissJobs('done0001')).toBe(1)
    expect(jobs().map((j) => j.id).sort()).toEqual(['done0002', 'work0001'])
    await m.pollExtras()
    expect(jobs().map((j) => j.id).sort()).toEqual(['done0002', 'work0001'])

    expect(m.dismissJobs()).toBe(1)
    expect(jobs().map((j) => j.id)).toEqual(['work0001'])

    expect(m.dismissJobs('work0001')).toBe(1)
    expect(jobs()).toEqual([])
    await m.pollExtras()
    expect(jobs()).toEqual([])

    await writeJob('done0001', 'working', now - 10_000)
    await writeJob('work0001', 'blocked', now - 5_000)
    await m.pollExtras()
    expect(jobs().map((j) => j.id).sort()).toEqual(['done0001', 'work0001'])
  })

  it('stops only known running jobs and reports the result as activity', async () => {
    await writeJob('work0001', 'working', now - 40_000)
    await writeJob('done0001', 'done', now - 60_000)
    const m = monitor()
    await m.pollExtras()

    expect(await m.stopJob('nope0001')).toBeNull()
    expect(await m.stopJob('done0001')).toBeNull()
    expect(stops).toEqual([])

    const [first, second] = await Promise.all([m.stopJob('work0001'), m.stopJob('work0001')])
    expect([first, second]).toEqual(['ok', null])
    expect(stops).toEqual(['work0001'])
    expect(activity().find((e) => e.kind === 'job.stopped')?.data).toMatchObject({ title: 'work0001', jobId: 'work0001' })

    stopResult = 'noCli'
    expect(await m.stopJob('work0001')).toBe('noCli')
    expect(activity().find((e) => e.kind === 'job.stopFailed')?.data).toMatchObject({ jobId: 'work0001', error: 'noCli' })
  })
})
