import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ResourceReport, ServerRes } from '@ccm/shared'
import { formatBytes, formatCpu, isBusyDaemon, portRows, spanParts } from '../lib/resources'
import { useConnectionStore } from './connection'
import { useResourcesStore } from './resources'

const NOW = 1_800_000_000_000
const server = (over: Partial<ServerRes>): ServerRes => ({
  pid: 500,
  start: '1',
  kind: 'dev-server',
  name: 'node.exe',
  cmd: 'node vite',
  ports: [{ port: 5173, address: '127.0.0.1', established: 0 }],
  ramBytes: 1,
  cpuPct: 0,
  idleSinceMs: null,
  lastBusyAt: null,
  forgotten: false,
  sessionId: 's1',
  orphan: false,
  ...over,
})
const report = (over: Partial<ResourceReport> = {}): ResourceReport => ({
  at: new Date(NOW).toISOString(),
  idleMinutes: 60,
  cores: 8,
  sessions: [{ sessionId: 's1', pid: 100, start: '9', ramBytes: 10, cpuPct: 1, idleSinceMs: null, forgotten: false }],
  servers: [server({})],
  totals: { ramBytes: 11, cpuPct: 1, forgotten: 2, forgottenRamBytes: 0 },
  outside: [{ pid: 42, name: 'postgres.exe', ports: [{ port: 80, address: '0.0.0.0', established: 2 }] }],
  conflicts: [{ port: 5173, sessionId: 's2', at: NOW, holder: { pid: 500, name: 'node.exe', sessionId: 's1' } }],
  ...over,
})

describe('resources store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('takes the report from the snapshot and from resources events', () => {
    const res = useResourcesStore()
    const conn = useConnectionStore()
    conn.apply([{ type: 'snapshot', payload: { terminals: [], agents: [], activity: [], resources: report() } as never }])
    expect(res.forgotten).toBe(2)
    expect(res.bySession.get('s1')?.ramBytes).toBe(10)
    conn.apply([{ type: 'resources', payload: report({ totals: { ramBytes: 0, cpuPct: 0, forgotten: 0, forgottenRamBytes: 0 } }) }])
    expect(res.forgotten).toBe(0)
    conn.apply([{ type: 'snapshot', payload: { terminals: [], agents: [], activity: [] } as never }])
    expect(res.report).toBeNull()
  })

  it('drops malformed reports, dismisses conflicts, opens on a port', () => {
    const res = useResourcesStore()
    res.set({ at: 'x' } as never)
    expect(res.report).toBeNull()
    res.set(report())
    expect(res.conflicts).toHaveLength(1)
    res.dismissConflict(res.conflicts[0]!)
    expect(res.conflicts).toHaveLength(0)
    res.onlyForgotten = true
    res.show('ports', 5173)
    expect([res.open, res.tab, res.focusPort, res.onlyForgotten]).toEqual([true, 'ports', 5173, false])
  })
})

describe('resources lib', () => {
  it('lists agent ports first, then ports outside agents', () => {
    const rows = portRows(report())
    expect(rows.map((r) => [r.port, r.server?.pid ?? null, r.sessionId])).toEqual([
      [5173, 500, 's1'],
      [80, null, null],
    ])
    expect(portRows(null)).toEqual([])
  })

  it('formats sizes, CPU and spans; knows a building daemon', () => {
    expect(formatBytes(512 * 1024 ** 2, 'en')).toBe('512 MB')
    expect(formatBytes(2.5 * 1024 ** 3, 'vi')).toBe('2,5 GB')
    expect(formatBytes(null, 'en')).toBe('—')
    expect(formatCpu(0.25, 'en')).toBe('0.3 %')
    expect(spanParts(45 * 60_000)).toEqual({ unit: 'min', a: 45, b: 0 })
    expect(spanParts(125 * 60_000)).toEqual({ unit: 'hm', a: 2, b: 5 })
    expect(spanParts(50 * 3_600_000)).toEqual({ unit: 'dh', a: 2, b: 2 })
    expect(isBusyDaemon({ kind: 'daemon', lastBusyAt: NOW - 60_000 }, NOW)).toBe(true)
    expect(isBusyDaemon({ kind: 'daemon', lastBusyAt: NOW - 300_000 }, NOW)).toBe(false)
    expect(isBusyDaemon({ kind: 'dev-server', lastBusyAt: NOW }, NOW)).toBe(false)
  })
})
