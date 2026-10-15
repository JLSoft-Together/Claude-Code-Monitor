import { createRequire } from 'node:module'

/** One row of the Windows process table; `start` is the creation FILETIME, null when the process can't be opened. */
export interface WinProc {
  pid: number
  ppid: number
  name: string
  start: bigint | null
}

export interface WinProcApi {
  list(): WinProc[]
  commandLine(pid: number): string | null
}

const TH32CS_SNAPPROCESS = 0x2
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const PROCESS_COMMAND_LINE_INFORMATION = 60
const STATUS_INFO_LENGTH_MISMATCH = -1073741820
const UNICODE_STRING_SIZE = 16

type Koffi = typeof import('koffi')

// Bundled to CJS (collector.cjs, pty-host.cjs, main.cjs) `require` exists; under tsx / vitest the module is ESM.
const nodeRequire: NodeJS.Require = typeof require === 'function' ? require : createRequire(import.meta.url)

export const defaultKoffiLoader = (): Koffi => nodeRequire(process.env.CCM_KOFFI || 'koffi') as Koffi

export function bindWinProcs(koffi: Koffi): WinProcApi {
  const k32 = koffi.load('kernel32.dll')
  const ntdll = koffi.load('ntdll.dll')
  const entry = koffi.struct({
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('char16_t', 260, 'String'),
  })
  const filetime = koffi.struct({ lo: 'uint32', hi: 'uint32' })
  // HANDLE as an integer: INVALID_HANDLE_VALUE is -1, an OpenProcess failure 0.
  const handle = 'intptr_t'
  const snapshot = k32.func('__stdcall', 'CreateToolhelp32Snapshot', handle, ['uint32', 'uint32'])
  const first = k32.func('__stdcall', 'Process32FirstW', 'bool', [handle, koffi.inout(koffi.pointer(entry))])
  const next = k32.func('__stdcall', 'Process32NextW', 'bool', [handle, koffi.inout(koffi.pointer(entry))])
  const close = k32.func('__stdcall', 'CloseHandle', 'bool', [handle])
  const open = k32.func('__stdcall', 'OpenProcess', handle, ['uint32', 'bool', 'uint32'])
  const out = koffi.out(koffi.pointer(filetime))
  const times = k32.func('__stdcall', 'GetProcessTimes', 'bool', [handle, out, out, out, out])
  const query = ntdll.func('__stdcall', 'NtQueryInformationProcess', 'int32', [handle, 'uint32', koffi.out(koffi.pointer('uint8')), 'uint32', koffi.out(koffi.pointer('uint32'))])
  const entrySize = koffi.sizeof(entry)
  const invalid = (h: unknown): boolean => !h || Number(h) === -1

  const withProcess = <T>(pid: number, fn: (h: unknown) => T): T | null => {
    const h = open(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (invalid(h)) return null
    try {
      return fn(h)
    } finally {
      close(h)
    }
  }

  const startOf = (h: unknown): bigint | null => {
    const created = { lo: 0, hi: 0 }
    if (!times(h, created, {}, {}, {})) return null
    return (BigInt(created.hi) << 32n) | BigInt(created.lo)
  }

  return {
    list() {
      const snap = snapshot(TH32CS_SNAPPROCESS, 0)
      if (invalid(snap)) throw new Error('CreateToolhelp32Snapshot failed')
      const rows: WinProc[] = []
      try {
        const e: Record<string, unknown> = { dwSize: entrySize }
        for (let ok = first(snap, e); ok; ok = next(snap, e)) {
          rows.push({ pid: e.th32ProcessID as number, ppid: e.th32ParentProcessID as number, name: e.szExeFile as string, start: null })
        }
      } finally {
        close(snap)
      }
      for (const r of rows) if (r.pid > 4) r.start = withProcess(r.pid, startOf)
      return rows
    },
    commandLine(pid) {
      return withProcess(pid, (h) => {
        const ret = [0]
        let buf = Buffer.alloc(1024)
        let status = query(h, PROCESS_COMMAND_LINE_INFORMATION, buf, buf.length, ret)
        if (status === STATUS_INFO_LENGTH_MISMATCH && ret[0]! > buf.length) {
          buf = Buffer.alloc(ret[0]!)
          status = query(h, PROCESS_COMMAND_LINE_INFORMATION, buf, buf.length, ret)
        }
        if (status !== 0) return null
        // UNICODE_STRING header, its Buffer pointing right behind it in the same block.
        const len = buf.readUInt16LE(0)
        if (len % 2 !== 0 || UNICODE_STRING_SIZE + len > buf.length) return null
        return buf.toString('utf16le', UNICODE_STRING_SIZE, UNICODE_STRING_SIZE + len)
      })
    },
  }
}

let loader: () => Koffi = defaultKoffiLoader
let api: WinProcApi | null | undefined

/** The koffi binding, loaded once; null off Windows, with `CCM_NATIVE_PROCS=0`, or when koffi fails to load. */
export function winProcs(): WinProcApi | null {
  if (api !== undefined) return api
  api = null
  if (process.platform !== 'win32' || process.env.CCM_NATIVE_PROCS === '0') return api
  try {
    api = bindWinProcs(loader())
  } catch (err) {
    console.warn(`[ccm] native process table unavailable, using PowerShell CIM: ${(err as Error).message}`)
  }
  return api
}

export function setKoffiLoader(next: () => Koffi): void {
  loader = next
  api = undefined
}

/** Full process table, or null when the native path is unavailable or failed (callers fall back to CIM). */
export function nativeProcessTable(): WinProc[] | null {
  const procs = winProcs()
  if (!procs) return null
  try {
    return procs.list()
  } catch {
    return null
  }
}

export function nativeCommandLine(pid: number): string | null {
  try {
    return winProcs()?.commandLine(pid) ?? null
  } catch {
    return null
  }
}
