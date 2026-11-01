import { execFile } from 'node:child_process'
import type { ResPort } from '@ccm/shared'
import { windowsPowerShell } from '../win-exe'
import { defaultKoffiLoader } from '../win-procs'

export const TCP_LISTEN = 2
export const TCP_ESTABLISHED = 5

/** One TCP socket: owner pid, MIB_TCP_STATE, local address / port. */
export interface TcpRow {
  pid: number
  state: number
  address: string
  port: number
}

export type PortTable = () => Promise<Map<number, ResPort[]> | null>

const ROW4_SIZE = 24
const ROW6_SIZE = 56

function ipv6Text(b: Buffer, off: number): string {
  const groups: number[] = []
  for (let i = 0; i < 8; i++) groups.push(b.readUInt16BE(off + i * 2))
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen && j - i > 1) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestStart < 0) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

/** MIB_TCPTABLE_OWNER_PID: dwNumEntries, then rows of state, localAddr, localPort, remoteAddr, remotePort, pid (6 DWORDs). */
export function parseTcpTable4(buf: Buffer): TcpRow[] {
  if (buf.length < 4) return []
  const n = buf.readUInt32LE(0)
  const rows: TcpRow[] = []
  for (let i = 0; i < n; i++) {
    const off = 4 + i * ROW4_SIZE
    if (off + ROW4_SIZE > buf.length) break
    rows.push({
      state: buf.readUInt32LE(off),
      // Address and port DWORDs hold network byte order: the bytes read in memory order.
      address: `${buf[off + 4]}.${buf[off + 5]}.${buf[off + 6]}.${buf[off + 7]}`,
      port: buf.readUInt16BE(off + 8),
      pid: buf.readUInt32LE(off + 20),
    })
  }
  return rows
}

/** MIB_TCP6TABLE_OWNER_PID: dwNumEntries, then rows of localAddr[16], scope, port, remoteAddr[16], scope, port, state, pid. */
export function parseTcpTable6(buf: Buffer): TcpRow[] {
  if (buf.length < 4) return []
  const n = buf.readUInt32LE(0)
  const rows: TcpRow[] = []
  for (let i = 0; i < n; i++) {
    const off = 4 + i * ROW6_SIZE
    if (off + ROW6_SIZE > buf.length) break
    rows.push({
      address: ipv6Text(buf, off),
      port: buf.readUInt16BE(off + 20),
      state: buf.readUInt32LE(off + 48),
      pid: buf.readUInt32LE(off + 52),
    })
  }
  return rows
}

function splitHostPort(text: string): { address: string; port: number } | null {
  const at = text.lastIndexOf(':')
  if (at <= 0) return null
  const port = Number(text.slice(at + 1))
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null
  let host = text.slice(0, at).replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  if (host === '*') host = '0.0.0.0'
  return { address: host, port }
}

/** `lsof -nP -iTCP -sTCP:LISTEN,ESTABLISHED -F pnT`: `p<pid>`, then per file `f…`, `n<local>[-><remote>]`, `TST=<state>`. */
export function parseLsof(stdout: string): TcpRow[] {
  const rows: TcpRow[] = []
  let pid = 0
  let local: { address: string; port: number } | null = null
  const flush = (state: string): void => {
    if (!local || !pid) return
    const code = state === 'LISTEN' ? TCP_LISTEN : state === 'ESTABLISHED' ? TCP_ESTABLISHED : 0
    if (code) rows.push({ pid, state: code, ...local })
    local = null
  }
  for (const line of stdout.split(/\r?\n/)) {
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      pid = Number(value) || 0
      local = null
    } else if (tag === 'f') local = null
    else if (tag === 'n') local = splitHostPort(value.split('->')[0] ?? '')
    else if (tag === 'T' && value.startsWith('ST=')) flush(value.slice(3))
  }
  return rows
}

/** LISTEN sockets per pid (one entry per port, addresses joined); `established` counts connections to that local port. */
export function portsByPid(rows: readonly TcpRow[]): Map<number, ResPort[]> {
  const listen = new Map<number, Map<number, Set<string>>>()
  const established = new Map<number, number>()
  for (const r of rows) {
    if (r.pid <= 4) continue
    if (r.state === TCP_LISTEN) {
      let ports = listen.get(r.pid)
      if (!ports) listen.set(r.pid, (ports = new Map()))
      let addrs = ports.get(r.port)
      if (!addrs) ports.set(r.port, (addrs = new Set()))
      addrs.add(r.address)
    } else if (r.state === TCP_ESTABLISHED) established.set(r.port, (established.get(r.port) ?? 0) + 1)
  }
  const out = new Map<number, ResPort[]>()
  for (const [pid, ports] of listen) {
    const list = [...ports].map(([port, addrs]) => ({ port, address: [...addrs].sort().join(', '), established: established.get(port) ?? 0 }))
    out.set(pid, list.sort((a, b) => a.port - b.port))
  }
  return out
}

const AF_INET = 2
const AF_INET6 = 23
const TCP_TABLE_OWNER_PID_ALL = 5
const ERROR_INSUFFICIENT_BUFFER = 122

type Koffi = typeof import('koffi')

export function bindTcpTable(koffi: Koffi): (family: 4 | 6) => Buffer | null {
  const iphlp = koffi.load('iphlpapi.dll')
  // BOOL bOrder is a 4-byte int, not a C bool.
  const get = iphlp.func('__stdcall', 'GetExtendedTcpTable', 'uint32', ['void *', koffi.inout(koffi.pointer('uint32')), 'int32', 'uint32', 'int32', 'uint32'])
  return (family) => {
    const af = family === 4 ? AF_INET : AF_INET6
    const size = [0]
    let status = get(null, size, 0, af, TCP_TABLE_OWNER_PID_ALL, 0) as number
    for (let attempt = 0; attempt < 4 && status === ERROR_INSUFFICIENT_BUFFER; attempt++) {
      const buf = Buffer.alloc(size[0]! + 4096)
      size[0] = buf.length
      status = get(buf, size, 0, af, TCP_TABLE_OWNER_PID_ALL, 0) as number
      if (status === 0) return buf
    }
    return status === 0 ? Buffer.alloc(4) : null
  }
}

export function winPortTable(load: () => Koffi = defaultKoffiLoader): PortTable | null {
  let read: (family: 4 | 6) => Buffer | null
  try {
    read = bindTcpTable(load())
  } catch (err) {
    console.warn(`[ccm] port table unavailable: ${(err as Error).message}`)
    return null
  }
  return async () => {
    const v4 = read(4)
    const v6 = read(6)
    if (!v4 && !v6) return null
    return portsByPid([...(v4 ? parseTcpTable4(v4) : []), ...(v6 ? parseTcpTable6(v6) : [])])
  }
}

export function lsofPortTable(): PortTable {
  return () =>
    new Promise((resolve) => {
      execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN,ESTABLISHED', '-F', 'pnT'], { timeout: 15_000, windowsHide: true, maxBuffer: 16_000_000 }, (err, stdout) => {
        // lsof exits 1 when nothing matched; stdout is still the answer.
        const out = String(stdout ?? '')
        resolve(err && !out ? null : portsByPid(parseLsof(out)))
      })
    })
}

const NET_TCP_SCRIPT = [
  "$out = @(Get-NetTCPConnection -State Listen,Established -ErrorAction SilentlyContinue | ForEach-Object {",
  '[pscustomobject]@{ a = [string]$_.LocalAddress; p = [int]$_.LocalPort; s = [int]$_.State; o = [int]$_.OwningProcess } });',
  'ConvertTo-Json -Compress -InputObject $out',
].join(' ')

const NET_TCP_STATES: Record<string, number> = { listen: TCP_LISTEN, established: TCP_ESTABLISHED }

/** Parses the `Get-NetTCPConnection` fallback's JSON; State comes as the MIB number (or its name on some hosts). */
export function parseNetTcp(stdout: string): TcpRow[] {
  const text = stdout.trim()
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const rows: TcpRow[] = []
  for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const state = typeof r.s === 'number' ? r.s : typeof r.s === 'string' ? (NET_TCP_STATES[r.s.toLowerCase()] ?? 0) : 0
    const port = Number(r.p)
    const pid = Number(r.o)
    if (!Number.isInteger(port) || port <= 0 || port > 65_535 || !Number.isInteger(pid) || pid < 0) continue
    if (state !== TCP_LISTEN && state !== TCP_ESTABLISHED) continue
    rows.push({ pid, state, address: typeof r.a === 'string' ? r.a.replace(/%.*$/, '') : '', port })
  }
  return rows
}

type RunPs = (file: string, args: string[]) => Promise<string | null>

const runPs: RunPs = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 16_000_000 }, (err, stdout) => resolve(err ? null : String(stdout ?? '')))
  })

/** Windows without koffi (`CCM_NATIVE_PROCS=0` or the binding failed): one PowerShell call per sampler pass. */
export function netTcpPortTable(exec: RunPs = runPs): PortTable {
  return async () => {
    const out = await exec(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', NET_TCP_SCRIPT])
    return out === null ? null : portsByPid(parseNetTcp(out))
  }
}

export function defaultPortTable(): PortTable | null {
  if (process.platform === 'win32') return (process.env.CCM_NATIVE_PROCS === '0' ? null : winPortTable()) ?? netTcpPortTable()
  if (process.platform === 'darwin' || process.platform === 'linux') return lsofPortTable()
  return null
}

const CONFLICT_RES = [
  /EADDRINUSE\b[^\n]*?[:\s](\d{2,5})(?![\d.])/,
  /address already in use[^\n]*?[:\s](\d{2,5})(?![\d.])/i,
  /\bport\s+:?(\d{2,5})\s+is\s+already\s+in\s+use/i,
]
const CONFLICT_SCAN_MAX = 20_000

/** Port number of a "port already in use" failure in tool output; only the number is kept. */
export function portConflictIn(text: string): number | null {
  const head = text.length > CONFLICT_SCAN_MAX ? text.slice(0, CONFLICT_SCAN_MAX) : text
  for (const re of CONFLICT_RES) {
    const m = re.exec(head)
    const port = m ? Number(m[1]) : 0
    if (port > 0 && port <= 65_535) return port
  }
  return null
}
