import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { finishDump, parseJdkRelease, planCds, snapshotClassList, type CdsFs } from '../src/layout/cds'

function memFs(files: Record<string, string | { size: number }>): CdsFs & { files: Map<string, string | { size: number }> } {
  const map = new Map(Object.entries(files).map(([k, v]) => [path.normalize(k), v]))
  const get = (f: string) => map.get(path.normalize(f))
  return {
    files: map,
    readFile: async (f) => {
      const v = get(f)
      if (typeof v !== 'string') throw new Error('ENOENT')
      return v
    },
    stat: async (f) => {
      const v = get(f)
      if (v === undefined) throw new Error('ENOENT')
      return { size: typeof v === 'string' ? v.length : v.size, mtimeMs: 1000 }
    },
    readdir: async (d) => [...map.keys()].filter((k) => path.dirname(k) === path.normalize(d)).map((k) => path.basename(k)),
    mkdir: async () => undefined,
    rm: async (f) => void map.delete(path.normalize(f)),
    rename: async (a, b) => {
      map.set(path.normalize(b), get(a)!)
      map.delete(path.normalize(a))
    },
    writeFile: async (f, t) => void map.set(path.normalize(f), t),
  }
}

const input = { jdkHome: '/jdk', cacheDir: '/cache', daemonJar: '/app/d.jar', layoutlibDir: '/ll', platform: 'linux' as const }
const base = { '/jdk/release': 'IMPLEMENTOR="JetBrains"\nJAVA_VERSION="21.0.10"\n', '/app/d.jar': { size: 30_000_000 } }

describe('AppCDS plan', () => {
  it('reads JAVA_VERSION from the release file', () => {
    expect(parseJdkRelease('JAVA_VERSION="17.0.14"\nOS_NAME="Windows"')).toBe('17.0.14')
    expect(parseJdkRelease('OS_NAME="Windows"')).toBeNull()
  })

  it('records a class list first, drops files of other keys, then uses the archive', async () => {
    const fs = memFs({ ...base, '/cache/daemon-17.0.1-16.2.3-aaaa.jsa': { size: 5e7 }, '/cache/other.txt': 'keep' })
    const plan = await planCds(input, fs)
    expect(plan?.mode).toBe('record')
    if (plan?.mode !== 'record') return
    expect(plan.jvmArgs[0]).toMatch(/^-XX:DumpLoadedClassList=.*daemon-21\.0\.10-16\.2\.3-[0-9a-f]{12}\.classlist$/)
    expect(plan.jvmArgs).toContain('-Xlog:all=warning:stderr')
    expect(plan.dumpArgs).toContain('-Xshare:dump')
    expect(plan.dumpArgs.at(-1)).toBe(`/app/d.jar:${path.join('/ll', 'layoutlib-16.2.3.jar')}`)
    expect([...fs.files.keys()].map((k) => path.basename(k)).sort()).toEqual(['d.jar', 'other.txt', 'release'])

    fs.files.set(path.normalize(plan.classList), `${'java/lang/Object id: 0\n'.repeat(1200)}partial/Cla`)
    expect(await snapshotClassList(plan, fs)).toBe(true)
    expect((fs.files.get(path.normalize(plan.snapshot)) as string).endsWith('id: 0\n')).toBe(true)
    fs.files.set(path.normalize(plan.tmp), { size: 6e7 })
    expect(await finishDump(plan, true, fs)).toBe(true)
    expect(fs.files.has(path.normalize(plan.snapshot))).toBe(false)

    const next = await planCds(input, fs)
    expect(next?.mode).toBe('use')
    expect(next?.jvmArgs[0]).toBe(`-XX:SharedArchiveFile=${plan.archive}`)
  })

  it('skips without a release file, a short class list, or after a failed dump', async () => {
    expect(await planCds(input, memFs({ '/app/d.jar': { size: 1 } }))).toBeNull()
    const fs = memFs(base)
    const plan = await planCds(input, fs)
    if (plan?.mode !== 'record') throw new Error('record expected')
    fs.files.set(path.normalize(plan.classList), 'a\nb\n')
    expect(await snapshotClassList(plan, fs)).toBe(false)
    expect(await finishDump(plan, false, fs)).toBe(false)
    expect(await planCds(input, fs)).toBeNull()
  })

  it('replaces an archive too small to be real', async () => {
    const fs = memFs(base)
    const plan = await planCds(input, fs)
    if (plan?.mode !== 'record') throw new Error('record expected')
    fs.files.set(path.normalize(plan.archive), 'garbage')
    expect((await planCds(input, fs))?.mode).toBe('record')
    expect(fs.files.has(path.normalize(plan.archive))).toBe(false)
  })
})
