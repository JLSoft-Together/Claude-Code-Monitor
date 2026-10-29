import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdbCommands } from '../src/devices/adb'
import { deletable, isDevicePath, isEntryName, localSafeName, lsArgs, parseLsLa, rmArgs, safeToOpen, uniqueName, validPath, writeArgs } from '../src/devices/devFiles'
import { DeviceFiles } from '../src/devices/fileBrowser'
import { cleanLocalPaths, cleanScope } from '../src/devices/filesIpc'

const TOYBOX = `total 64
drwxrwx--x  4 root sdcard_rw 3488 2024-01-02 10:11 .
drwx--x--x  4 root sdcard_rw 3488 2024-01-02 10:11 ..
drwxrwx--x  2 root sdcard_rw 3488 2024-03-05 08:00 Download
-rw-rw----  1 u0_a123 sdcard_rw 1048576 2024-03-05 09:15 my report (final).pdf
lrwxrwxrwx  1 root root 21 2024-01-01 00:00 sdcard -> /storage/self/primary
-rw-rw----  1 root sdcard_rw 0 2024-03-05 09:16:42.123456789 +0100 empty.txt
crw-rw-rw-  1 root root 1,   3 2024-01-01 00:00 null
`

const TOOLBOX = `drwxrwx--- root     sdcard_r          2014-01-01 00:00 Alarms
-rw-rw---- root     sdcard_r     12345 2014-01-01 00:00 old file.txt
lrwxrwxrwx root     root              2014-01-01 00:00 link -> /mnt/x
`

const BUSYBOX = `-rw-r--r--    1 root     root          1234 Jan  2 10:11 notes.txt
drwxr-xr-x    2 root     root          4096 Dec 31  2023 logs
`

describe('device file parsing and paths', () => {
  it('parses toybox ls -la with spaces, links, device nodes and full timestamps', () => {
    const { entries, skipped, error } = parseLsLa(TOYBOX)
    expect(error).toBeNull()
    expect(skipped).toBe(0)
    expect(entries.map((e) => e.name)).toEqual(['Download', 'empty.txt', 'my report (final).pdf', 'null', 'sdcard'])
    expect(entries.find((e) => e.name === 'my report (final).pdf')).toEqual({ name: 'my report (final).pdf', kind: 'file', size: 1048576, modified: '2024-03-05 09:15' })
    expect(entries.find((e) => e.name === 'sdcard')).toMatchObject({ kind: 'link', target: '/storage/self/primary' })
    expect(entries.find((e) => e.name === 'null')).toMatchObject({ kind: 'other', size: null })
    expect(entries.find((e) => e.name === 'Download')?.size).toBeNull()
  })

  it('parses old toolbox and busybox layouts, and errors', () => {
    expect(parseLsLa(TOOLBOX).entries).toEqual([
      { name: 'Alarms', kind: 'dir', size: null, modified: '2014-01-01 00:00' },
      { name: 'link', kind: 'link', size: null, modified: '2014-01-01 00:00', target: '/mnt/x' },
      { name: 'old file.txt', kind: 'file', size: 12345, modified: '2014-01-01 00:00' },
    ])
    expect(parseLsLa(BUSYBOX).entries.map((e) => [e.name, e.size, e.modified])).toEqual([['logs', null, 'Dec 31 2023'], ['notes.txt', 1234, 'Jan 2 10:11']])
    expect(parseLsLa("ls: /sdcard/Android/data/: Permission denied\n").error).toBe('permission')
    expect(parseLsLa('ls: /sdcard/x/: No such file or directory\r\n').error).toBe('not-found')
  })

  it('validates device paths, names and scopes', () => {
    expect(isDevicePath('/sdcard/Download/a b.txt')).toBe(true)
    for (const bad of ['sdcard', '/sdcard/../data', '/sdcard/./x', '/sdcard//x', '/sdcard/', '/sdcard/a\0b', '/sdcard/a\nb', 42]) expect(isDevicePath(bad)).toBe(false)
    expect(validPath({ kind: 'sdcard' }, '/data/data/com.x')).toBe(false)
    expect(validPath({ kind: 'sdcard' }, '/data/local/tmp/x')).toBe(true)
    expect(validPath({ kind: 'app', pkg: 'com.x' }, '/files/a')).toBe(true)
    expect(deletable({ kind: 'sdcard' }, '/sdcard')).toBe(false)
    expect(deletable({ kind: 'app', pkg: 'com.x' }, '/')).toBe(false)
    expect(isEntryName('a/b')).toBe(false)
    expect(isEntryName('..')).toBe(false)
    expect(cleanScope({ kind: 'app', pkg: 'com.x; rm' })).toBeNull()
    expect(cleanLocalPaths(['relative.txt'])).toBeNull()
    expect(cleanLocalPaths([path.resolve('a.txt')])).toEqual([path.resolve('a.txt')])
  })

  it('quotes every argument for the device shell', () => {
    expect(lsArgs({ kind: 'sdcard' }, "/sdcard/it's here")).toEqual(['ls', '-la', `'/sdcard/it'\\''s here/'`])
    expect(lsArgs({ kind: 'app', pkg: 'com.x' }, '/')).toEqual(['run-as', "'com.x'", 'ls', '-la', "'./'"])
    expect(rmArgs({ kind: 'app', pkg: 'com.x' }, '/files/a b', true)).toEqual(['run-as', "'com.x'", 'rm', '-r', '-f', "'./files/a b'"])
    expect(writeArgs({ kind: 'sdcard' }, '/sdcard/a.txt')).toEqual(['sh', '-c', `'cat > '\\''/sdcard/a.txt.orrery-part'\\'' && mv -f '\\''/sdcard/a.txt.orrery-part'\\'' '\\''/sdcard/a.txt'\\'''`])
  })

  it('makes safe, unique local names and refuses to open runnables', () => {
    expect(localSafeName('a:b?.txt')).toBe('a_b_.txt')
    expect(localSafeName('CON.txt')).toBe('_CON.txt')
    expect(localSafeName('dots...')).toBe('dots')
    const taken = new Set(['a.txt', 'a (1).txt'])
    expect(uniqueName('a.txt', (n) => taken.has(n))).toBe('a (2).txt')
    expect(safeToOpen('photo.jpg')).toBe(true)
    expect(safeToOpen('setup.EXE')).toBe(false)
    expect(safeToOpen('Makefile')).toBe(false)
  })
})

function fakeChild(): ChildProcess & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough } {
  const c = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough }
  c.stdout = new PassThrough()
  c.stderr = new PassThrough()
  c.stdin = new PassThrough()
  return c
}

describe('DeviceFiles', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const tmp = () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'ccm-devfs-'))
    dirs.push(d)
    return d
  }

  const setup = (opts: { shell?: (args: string[]) => { code: number; out: string }; spawn?: (args: string[], stdin: boolean) => ChildProcess; confirm?: boolean } = {}) => {
    const shells: string[][] = []
    const cmds = {
      shell: async (_id: string, args: string[]) => {
        shells.push(args)
        return { err: '', ...(opts.shell?.(args) ?? { code: 0, out: '' }) }
      },
      spawnAdb: async (_id: string, args: string[], stdin: boolean) => opts.spawn?.(args, stdin) ?? null,
    } as unknown as AdbCommands
    const killed: ChildProcess[] = []
    const files = new DeviceFiles({
      withDevice: (_id, fn) => fn(cmds),
      kill: (c) => {
        killed.push(c)
        c.emit('close', null)
      },
      confirmDelete: async () => opts.confirm ?? true,
      confirmReplace: async () => opts.confirm ?? true,
    })
    return { files, shells, killed }
  }

  it('lists, checks run-as first, and maps refusals', async () => {
    const { files, shells } = setup({ shell: (a) => (a.includes('true') ? { code: 0, out: '' } : { code: 0, out: TOYBOX }) })
    const r = await files.list('e', { kind: 'app', pkg: 'com.example.demo' }, '/')
    expect(r.ok && r.entries.length).toBe(5)
    expect(shells[0]).toEqual(['run-as', "'com.example.demo'", 'true'])
    const no = setup({ shell: () => ({ code: 1, out: 'run-as: package not debuggable: com.x\n' }) })
    expect(await no.files.list('e', { kind: 'app', pkg: 'com.x' }, '/')).toEqual({ ok: false, error: 'not-debuggable' })
  })

  it('deletes only after the native confirm and never a root', async () => {
    const yes = setup()
    expect(await yes.files.remove('e', { kind: 'sdcard' }, '/sdcard/Download/x', true)).toEqual({ ok: true })
    expect(yes.shells[0]).toEqual(['rm', '-r', '-f', "'/sdcard/Download/x'"])
    const no = setup({ confirm: false })
    expect(await no.files.remove('e', { kind: 'sdcard' }, '/sdcard/x', false)).toEqual({ ok: false, error: 'cancelled' })
    expect(no.shells).toEqual([])
    expect(await yes.files.remove('e', { kind: 'sdcard' }, '/sdcard', true)).toEqual({ ok: false, error: 'outside' })
  })

  it('pulls a file with byte progress into a unique local name', async () => {
    const dest = tmp()
    writeFileSync(path.join(dest, 'a.bin'), 'old')
    const body = Buffer.alloc(5000, 7)
    const progress: number[] = []
    const { files } = setup({
      spawn: (args) => {
        expect(args).toEqual(['exec-out', 'cat', "'/sdcard/a.bin'"])
        const c = fakeChild()
        setTimeout(() => {
          c.stdout.end(body)
          c.stdout.once('end', () => setTimeout(() => c.emit('close', 0), 5))
        }, 5)
        return c
      },
    })
    const r = await files.pull('e', { kind: 'sdcard' }, '/sdcard/a.bin', 'file', 5000, dest, '0123456789abcdef', (p) => progress.push(p.done))
    expect(r).toMatchObject({ ok: true, name: 'a (1).bin' })
    expect(readFileSync(path.join(dest, 'a (1).bin')).equals(body)).toBe(true)
    expect(progress.at(-1)).toBe(5000)
    expect(files.wasPulled(path.join(dest, 'a (1).bin'))).toBe(true)
    expect(existsSync(path.join(dest, 'a (1).bin.orrery-part'))).toBe(false)
  })

  it('a short pull is an error and leaves nothing behind; cancel kills the transfer', async () => {
    const dest = tmp()
    const short = setup({
      spawn: () => {
        const c = fakeChild()
        setTimeout(() => {
          c.stdout.end('cat: /sdcard/x: Permission denied\n')
          c.stdout.once('end', () => setTimeout(() => c.emit('close', 0), 5))
        }, 5)
        return c
      },
    })
    expect(await short.files.pull('e', { kind: 'sdcard' }, '/sdcard/x', 'file', 100, dest, '0123456789abcdef', () => undefined)).toEqual({ ok: false, error: 'permission' })
    const slow = setup({ spawn: () => fakeChild() })
    const run = slow.files.pull('e', { kind: 'sdcard' }, '/sdcard/y', 'file', 100, dest, 'aaaaaaaaaaaaaaaa', () => undefined)
    await new Promise((r) => setTimeout(r, 20))
    expect(slow.files.cancel('aaaaaaaaaaaaaaaa')).toBe(true)
    expect(await run).toEqual({ ok: false, error: 'cancelled' })
    expect(slow.killed).toHaveLength(1)
    expect(readdirSync(dest)).toEqual([])
  })

  it('pushes through stdin to a temp name, asks before replacing, verifies the size', async () => {
    const src = tmp()
    const file = path.join(src, 'data.json')
    writeFileSync(file, '{"a":1}')
    let got = ''
    const { files, shells } = setup({
      shell: (a) => (a[0] === 'ls' && a[1] === '-d' ? { code: 0, out: '/sdcard/Download/data.json' } : a[0] === 'ls' ? { code: 0, out: '-rw-rw---- 1 root sdcard_rw 7 2024-01-01 00:00 /sdcard/Download/data.json\n' } : { code: 0, out: '' }),
      spawn: (args, stdin) => {
        expect(stdin).toBe(true)
        expect(args[0]).toBe('shell')
        const c = fakeChild()
        c.stdin.on('data', (b) => (got += b.toString()))
        c.stdin.on('finish', () => setTimeout(() => c.emit('close', 0), 5))
        return c
      },
    })
    const r = await files.push('e', { kind: 'sdcard' }, '/sdcard/Download', [file, path.join(src, 'missing.txt')], '0123456789abcdef', () => undefined)
    expect(r).toEqual({ ok: true, pushed: ['data.json'], skipped: ['missing.txt'] })
    expect(got).toBe('{"a":1}')
    expect(shells[0]).toEqual(['ls', '-d', "'/sdcard/Download/data.json'"])
    const no = setup({ shell: () => ({ code: 0, out: 'x' }), confirm: false })
    expect(await no.files.push('e', { kind: 'sdcard' }, '/sdcard/Download', [file], '0123456789abcdef', () => undefined)).toEqual({ ok: true, pushed: [], skipped: ['data.json'] })
  })
})
