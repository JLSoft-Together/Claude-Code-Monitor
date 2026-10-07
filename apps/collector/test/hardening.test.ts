import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UsageBucket, UsageScan, UsageSnapshot } from '@ccm/shared'
import { isAllowedOrigin, startServer } from '../src/server'
import { MonitorStore } from '../src/store'
import { UsageIndex, type UsageSink } from '../src/usage'

describe('isAllowedOrigin', () => {
  const ports = [4317, 5173]

  it('accepts the dashboard and dev origins on local hosts', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4317', ports)).toBe(true)
    expect(isAllowedOrigin('http://localhost:4317', ports)).toBe(true)
    expect(isAllowedOrigin('http://[::1]:4317', ports)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173', ports)).toBe(true)
  })

  it('rejects other local apps, other schemes and remote hosts', () => {
    expect(isAllowedOrigin('http://127.0.0.1:8888', ports)).toBe(false)
    expect(isAllowedOrigin('http://localhost', ports)).toBe(false)
    expect(isAllowedOrigin('https://127.0.0.1:4317', ports)).toBe(false)
    expect(isAllowedOrigin('http://evil.example:4317', ports)).toBe(false)
    expect(isAllowedOrigin('http://127.0.0.1:4317/path', ports)).toBe(false)
    expect(isAllowedOrigin('null', ports)).toBe(false)
    expect(isAllowedOrigin('not a url', ports)).toBe(false)
  })
})

describe('static server', () => {
  let port = 0
  let close: () => void = () => undefined

  beforeAll(async () => {
    const dist = await mkdtemp(path.join(os.tmpdir(), 'ccm-dist-'))
    await writeFile(path.join(dist, 'index.html'), '<!doctype html>ok')
    const server = await startServer({ host: '127.0.0.1', port: 0, webDist: dist, store: new MonitorStore({ activityLimit: 10, batchMs: 10 }) })
    port = (server.address() as AddressInfo).port
    close = () => server.close()
  })
  afterAll(() => close())

  const get = (urlPath: string, headers: Record<string, string> = {}) =>
    new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })

  it('answers a malformed path with 400 instead of crashing', async () => {
    expect(await get('/%E0%A4%A')).toBe(400)
    expect(await get('/')).toBe(200)
  })

  it('rejects a cross-site origin', async () => {
    expect(await get('/', { origin: 'http://localhost:9999' })).toBe(403)
  })
})

class Sink implements UsageSink {
  snapshot: UsageSnapshot = { buckets: [], scan: { state: 'idle', filesDone: 0, filesTotal: 0 } }
  resetUsage(s: UsageSnapshot) {
    this.snapshot = s
  }
  updateUsage(_: UsageBucket[]) {}
  setUsageScan(_: UsageScan) {}
}

describe('usage cache retention', () => {
  it('drops message ids of old transcripts but keeps their buckets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccm-ret-'))
    const projects = path.join(root, 'projects')
    const cache = path.join(root, 'cache.json')
    await mkdir(path.join(projects, 'D--demo'), { recursive: true })
    const rec = {
      type: 'assistant',
      timestamp: '2026-10-07T09:00:00.000Z',
      cwd: 'D:\\demo',
      message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 2 } },
    }
    await writeFile(path.join(projects, 'D--demo', 's.jsonl'), `${JSON.stringify(rec)}\n`)

    const future = Date.now() + 40 * 86_400_000
    const index = new UsageIndex(projects, cache, new Sink(), { sweepMs: 0, saveDebounceMs: 1, now: () => future })
    await index.start()
    await index.whenIdle()
    await index.stop()

    const saved = JSON.parse(await readFile(cache, 'utf8')) as { files: Record<string, { ids: string[]; buckets: object; mtimeMs: number }> }
    const entry = saved.files['D--demo/s.jsonl']!
    expect(entry.ids).toEqual([])
    expect(Object.keys(entry.buckets)).toHaveLength(1)
    expect(typeof entry.mtimeMs).toBe('number')
  })
})

describe('focus window output', () => {
  it('maps the last line of the PowerShell output', async () => {
    const { parseFocusOutput } = await import('../src/focus')
    expect(parseFocusOutput('noise\r\nok\r\n')).toBe('ok')
    expect(parseFocusOutput('notFound')).toBe('notFound')
    expect(parseFocusOutput('')).toBe('failed')
    expect(parseFocusOutput('Exception: boom')).toBe('failed')
  })
})

describe('parsePickOutput', () => {
  it('decodes a base64 UTF-8 path and maps cancel / garbage', async () => {
    const { parsePickOutput } = await import('../src/folder-pick')
    const b64 = Buffer.from('D:\dự án\app', 'utf8').toString('base64')
    expect(parsePickOutput(`noise\r\nok:${b64}\r\n`)).toEqual({ result: 'ok', dir: 'D:\dự án\app' })
    expect(parsePickOutput('cancelled\n')).toEqual({ result: 'cancelled' })
    expect(parsePickOutput('Exception: boom')).toEqual({ result: 'failed' })
    expect(parsePickOutput('ok:')).toEqual({ result: 'failed' })
  })
})

describe('git diff shortstat', () => {
  it('parses singular, plural and missing parts', async () => {
    const { parseShortstat } = await import('../src/gitstat')
    expect(parseShortstat(' 9 files changed, 340 insertions(+), 12 deletions(-)\n')).toEqual({ files: 9, insertions: 340, deletions: 12 })
    expect(parseShortstat(' 1 file changed, 1 deletion(-)')).toEqual({ files: 1, insertions: 0, deletions: 1 })
    expect(parseShortstat('')).toEqual({ files: 0, insertions: 0, deletions: 0 })
  })
})

describe('openFolder', () => {
  it('passes the folder as a plain argument and reports a missing folder', async () => {
    const { openFolder } = await import('../src/opener')
    const calls: string[][] = []
    const spawner = async (cmd: string, args: string[]) => void calls.push([cmd, ...args])
    expect(await openFolder(process.cwd(), 'explorer', spawner)).toBe('ok')
    expect(calls[0]?.[0]).toBe('explorer.exe')
    expect(await openFolder(path.join(process.cwd(), 'no-such-dir-xyz'), 'explorer', spawner)).toBe('notFound')
  })
})
