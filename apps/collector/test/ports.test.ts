import { describe, expect, it } from 'vitest'
import { parseKillTargets, type ResPort } from '@ccm/shared'
import { parseFixture } from '../src/resources/fixture'
import { TCP_ESTABLISHED, TCP_LISTEN, parseLsof, parseTcpTable4, parseTcpTable6, portConflictIn, portsByPid } from '../src/resources/ports'
import { outsidePorts, portConflicts } from '../src/resources/sampler'
import { extractSignals, TranscriptState } from '../src/transcript'

function table4(rows: { state: number; addr: [number, number, number, number]; port: number; pid: number }[]): Buffer {
  const buf = Buffer.alloc(4 + rows.length * 24)
  buf.writeUInt32LE(rows.length, 0)
  rows.forEach((r, i) => {
    const off = 4 + i * 24
    buf.writeUInt32LE(r.state, off)
    r.addr.forEach((b, j) => (buf[off + 4 + j] = b))
    buf.writeUInt16BE(r.port, off + 8)
    buf.writeUInt32LE(0x0100007f, off + 12)
    buf.writeUInt16BE(54321, off + 16)
    buf.writeUInt32LE(r.pid, off + 20)
  })
  return buf
}

function table6(rows: { state: number; addr: number[]; port: number; pid: number }[]): Buffer {
  const buf = Buffer.alloc(4 + rows.length * 56)
  buf.writeUInt32LE(rows.length, 0)
  rows.forEach((r, i) => {
    const off = 4 + i * 56
    r.addr.forEach((b, j) => (buf[off + j] = b))
    buf.writeUInt32LE(7, off + 16)
    buf.writeUInt16BE(r.port, off + 20)
    buf.writeUInt16BE(40000, off + 44)
    buf.writeUInt32LE(r.state, off + 48)
    buf.writeUInt32LE(r.pid, off + 52)
  })
  return buf
}

const v6 = (last: number): number[] => [...Array(15).fill(0), last]

describe('GetExtendedTcpTable parsers', () => {
  it('reads IPv4 rows: network-order address and port, owner pid', () => {
    const rows = parseTcpTable4(
      table4([
        { state: TCP_LISTEN, addr: [127, 0, 0, 1], port: 5173, pid: 1200 },
        { state: TCP_ESTABLISHED, addr: [127, 0, 0, 1], port: 5173, pid: 1200 },
        { state: TCP_LISTEN, addr: [0, 0, 0, 0], port: 8080, pid: 99 },
      ]),
    )
    expect(rows).toEqual([
      { state: 2, address: '127.0.0.1', port: 5173, pid: 1200 },
      { state: 5, address: '127.0.0.1', port: 5173, pid: 1200 },
      { state: 2, address: '0.0.0.0', port: 8080, pid: 99 },
    ])
  })

  it('reads IPv6 rows (56-byte layout) and compresses addresses', () => {
    const rows = parseTcpTable6(
      table6([
        { state: TCP_LISTEN, addr: v6(0), port: 3000, pid: 42 },
        { state: TCP_LISTEN, addr: v6(1), port: 3001, pid: 42 },
        { state: TCP_ESTABLISHED, addr: [0xfe, 0x80, ...Array(13).fill(0), 1], port: 3000, pid: 42 },
      ]),
    )
    expect(rows.map((r) => [r.address, r.port, r.state, r.pid])).toEqual([
      ['::', 3000, 2, 42],
      ['::1', 3001, 2, 42],
      ['fe80::1', 3000, 5, 42],
    ])
  })

  it('stops at a truncated buffer and tolerates an empty one', () => {
    const full = table4([{ state: TCP_LISTEN, addr: [127, 0, 0, 1], port: 80, pid: 10 }, { state: TCP_LISTEN, addr: [127, 0, 0, 1], port: 81, pid: 10 }])
    expect(parseTcpTable4(full.subarray(0, 30))).toHaveLength(1)
    expect(parseTcpTable4(Buffer.alloc(2))).toEqual([])
    expect(parseTcpTable6(Buffer.alloc(4))).toEqual([])
  })
})

describe('portsByPid', () => {
  it('groups LISTEN sockets per pid, joins addresses, counts established per local port, skips System', () => {
    const map = portsByPid([
      { pid: 1200, state: TCP_LISTEN, address: '127.0.0.1', port: 5173 },
      { pid: 1200, state: TCP_LISTEN, address: '::1', port: 5173 },
      { pid: 1200, state: TCP_ESTABLISHED, address: '127.0.0.1', port: 5173 },
      { pid: 1200, state: TCP_ESTABLISHED, address: '127.0.0.1', port: 5173 },
      { pid: 77, state: TCP_ESTABLISHED, address: '127.0.0.1', port: 61000 },
      { pid: 4, state: TCP_LISTEN, address: '0.0.0.0', port: 445 },
      { pid: 1200, state: 11, address: '127.0.0.1', port: 5173 },
    ])
    expect([...map.keys()]).toEqual([1200])
    expect(map.get(1200)).toEqual([{ port: 5173, address: '127.0.0.1, ::1', established: 2 }])
  })
})

describe('lsof -F pnT parser', () => {
  it('reads listen and established sockets, wildcard and bracketed IPv6', () => {
    const out = [
      'p501',
      'f23',
      'n*:5173',
      'TST=LISTEN',
      'f24',
      'n[::1]:5173',
      'TST=LISTEN',
      'f30',
      'n127.0.0.1:5173->127.0.0.1:61234',
      'TST=ESTABLISHED',
      'p777',
      'f5',
      'n[fe80::1%lo0]:7000',
      'TST=LISTEN',
      'f6',
      'n10.0.0.2:7000->10.0.0.9:1',
      'TST=CLOSE_WAIT',
    ].join('\n')
    const rows = parseLsof(out)
    expect(rows).toEqual([
      { pid: 501, state: TCP_LISTEN, address: '0.0.0.0', port: 5173 },
      { pid: 501, state: TCP_LISTEN, address: '::1', port: 5173 },
      { pid: 501, state: TCP_ESTABLISHED, address: '127.0.0.1', port: 5173 },
      { pid: 777, state: TCP_LISTEN, address: 'fe80::1', port: 7000 },
    ])
    expect(portsByPid(rows).get(501)).toEqual([{ port: 5173, address: '0.0.0.0, ::1', established: 1 }])
  })
})

describe('port conflicts', () => {
  it('finds the port in the common error texts and nothing else', () => {
    expect(portConflictIn('Error: listen EADDRINUSE: address already in use :::5173')).toBe(5173)
    expect(portConflictIn('Error: listen EADDRINUSE: address already in use 127.0.0.1:3000\n at Server')).toBe(3000)
    expect(portConflictIn('error: Port 8080 is already in use')).toBe(8080)
    expect(portConflictIn('OSError: [Errno 98] Address already in use: ("0.0.0.0", 8000)')).toBe(8000)
    expect(portConflictIn('Exit code 1\nnpm ERR! missing script: dev')).toBeNull()
    expect(portConflictIn('[Errno 98] Address already in use')).toBeNull()
  })

  it('keeps only the port of a failed tool result, never the text', () => {
    const rec = (isError: boolean) => ({
      type: 'user',
      timestamp: '2026-11-01T10:00:00.000Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: isError, content: 'Exit code 1\nError: listen EADDRINUSE: address already in use :::5173' }] },
    })
    expect(extractSignals(rec(false))[1]).not.toHaveProperty('portConflict')
    const signals = extractSignals(rec(true))
    expect(signals[1]).toMatchObject({ k: 'tool_result', portConflict: 5173 })
    expect(JSON.stringify(signals)).not.toContain('EADDRINUSE')
    const state = new TranscriptState()
    state.apply(signals)
    expect(state.portConflict).toEqual({ port: 5173, at: '2026-11-01T10:00:00.000Z' })
  })

  it('names the holder and drops old conflicts', () => {
    const now = Date.parse('2026-11-01T10:20:00Z')
    const ports = new Map<number, ResPort[]>([[900, [{ port: 5173, address: '127.0.0.1', established: 0 }]]])
    const owner = new Map<number, string | null>([[900, 's-old']])
    const names = new Map([[900, 'node.exe']])
    const list = portConflicts(
      [
        { sessionId: 's-new', port: 5173, at: now - 60_000 },
        { sessionId: 's-x', port: 4000, at: now - 120_000 },
        { sessionId: 's-y', port: 5173, at: now - 3_600_000 },
      ],
      now,
      ports,
      owner,
      names,
    )
    expect(list).toEqual([
      { port: 5173, sessionId: 's-new', at: now - 60_000, holder: { pid: 900, name: 'node.exe', sessionId: 's-old' } },
      { port: 4000, sessionId: 's-x', at: now - 120_000, holder: null },
    ])
  })

  it('lists LISTEN ports outside every agent tree', () => {
    const ports = new Map<number, ResPort[]>([
      [900, [{ port: 5173, address: '127.0.0.1', established: 0 }]],
      [50, [{ port: 8080, address: '0.0.0.0', established: 3 }]],
    ])
    expect(outsidePorts(ports, new Map([[900, 's1']]), new Map([[50, 'java.exe']]))).toEqual([{ pid: 50, name: 'java.exe', ports: [{ port: 8080, address: '0.0.0.0', established: 3 }] }])
  })
})

describe('kill request validation', () => {
  it('accepts pids with a creation time, cleans labels, drops duplicates', () => {
    expect(parseKillTargets([{ pid: 1200, start: '133700000000000000', label: 'vite\n dev' }, { pid: 1200, start: '1' }])).toEqual([
      { pid: 1200, start: '133700000000000000', label: 'vite  dev' },
    ])
    expect(parseKillTargets([{ pid: 1200, start: 'Mon Nov 1 10:00:00 2026' }])).toHaveLength(1)
  })

  it('refuses system pids, missing / odd start, non-arrays and oversize batches', () => {
    expect(parseKillTargets([{ pid: 4, start: '1' }])).toBeNull()
    expect(parseKillTargets([{ pid: 1200, start: '' }])).toBeNull()
    expect(parseKillTargets([{ pid: 1200, start: '1; rm -rf /' }])).toBeNull()
    expect(parseKillTargets([{ pid: 1.5, start: '1' }])).toBeNull()
    expect(parseKillTargets({ pid: 1200, start: '1' })).toBeNull()
    expect(parseKillTargets([])).toBeNull()
    expect(parseKillTargets(Array.from({ length: 51 }, (_, i) => ({ pid: 100 + i, start: '1' })))).toBeNull()
  })
})

describe('CCM_RES_FIXTURE', () => {
  it('parses fake processes and ports', () => {
    const f = parseFixture(JSON.stringify({ procs: [{ pid: 10, ppid: 1, name: 'node.exe', start: '5', ram: 1024, cpuMs: 0, cmd: 'node vite' }, { pid: 'x' }], ports: { '10': [{ port: 5173, address: '127.0.0.1', established: 0 }, { port: 'bad' }] } }))
    expect(f.procs).toEqual([{ pid: 10, ppid: 1, name: 'node.exe', start: '5', startMs: 5, ramBytes: 1024, cpuMs: 0, cmd: 'node vite' }])
    expect(f.ports.get(10)).toEqual([{ port: 5173, address: '127.0.0.1', established: 0 }])
  })
})
