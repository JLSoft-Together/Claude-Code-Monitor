import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { highlightSegments, maskSecrets, promptSearchTerms, type MonitorEvent, type PromptSearchHit } from '@ccm/shared'
import { MAX_LINE_BYTES, projectDirName, PromptSearcher, promptTextOf, scanTranscript, snippetOf } from '../src/prompt-search'
import { startServer } from '../src/server'
import { MonitorStore } from '../src/store'

const base = { parentUuid: null, isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: 'D:\\work\\app', sessionId: 's', version: '2.1.294', gitBranch: 'main', uuid: 'u', timestamp: '2026-10-20T08:00:00.000Z' }
const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ ...base, type: 'user', message: { role: 'user', content }, ...extra })

describe('promptTextOf', () => {
  it('keeps typed, queued, accepted-suggestion, sdk and legacy prompts', () => {
    expect(promptTextOf(user('fix the paywall', { promptSource: 'typed', origin: { kind: 'human' } }))).toBe('fix the paywall')
    expect(promptTextOf(user('next one', { promptSource: 'queued', origin: { kind: 'human' } }))).toBe('next one')
    expect(promptTextOf(user('yes do it', { promptSource: 'suggestion_accepted', origin: { kind: 'human' } }))).toBe('yes do it')
    expect(promptTextOf(user([{ type: 'image', source: {} }, { type: 'text', text: 'what is in this screenshot' }], { promptSource: 'sdk' }))).toBe('what is in this screenshot')
    expect(promptTextOf(user('older prompt without promptSource'))).toBe('older prompt without promptSource')
  })

  it('drops every non-prompt user record kind', () => {
    const excluded = [
      user([{ type: 'tool_result', tool_use_id: 't', content: 'paywall output' }], { toolUseResult: {}, sourceToolAssistantUUID: 'a' }),
      user([{ type: 'tool_result', tool_use_id: 't', content: 'paywall' }]),
      user('paywall skill text', { isMeta: true }),
      user([{ type: 'text', text: 'paywall attached' }], { isMeta: true, sourceToolUseID: 't' }),
      user('paywall from a subagent', { isSidechain: true }),
      user('This session is being continued from a previous conversation. paywall', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
      user('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>paywall</command-args>'),
      user('<command-message>hand-off</command-message>\n<command-name>/hand-off</command-name>', { origin: { kind: 'human' } }),
      user('<local-command-stdout>Compacted paywall</local-command-stdout>'),
      user('<local-command-caveat>Caveat: paywall</local-command-caveat>', { isMeta: true }),
      user('<bash-input>rm paywall</bash-input>'),
      user('<bash-stdout>paywall</bash-stdout><bash-stderr></bash-stderr>'),
      user('<task-notification><task-id>x</task-id>paywall</task-notification>', { promptSource: 'system', origin: { kind: 'task-notification' } }),
      user('paywall from a peer session', { isMeta: true, promptSource: 'system', origin: { kind: 'peer' } }),
      user('paywall auto continue', { isMeta: true, promptSource: 'system', origin: { kind: 'auto-continuation' } }),
      user('paywall coordinator', { origin: { kind: 'coordinator' } }),
      user('[Request interrupted by user]'),
      { ...base, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'paywall' }] } },
      user('   '),
    ]
    for (const rec of excluded) expect(promptTextOf(rec)).toBeNull()
  })
})

describe('terms, snippets, masking, highlight', () => {
  it('splits on whitespace, lower-cases and dedupes', () => {
    expect(promptSearchTerms('  Paywall  IAP paywall ')).toEqual(['paywall', 'iap'])
  })

  it('cuts ≤ 200 chars around the first match', () => {
    const text = `${'a '.repeat(300)}the PAYWALL screen ${'b '.repeat(300)}`
    const s = snippetOf(text, ['paywall'])
    expect(s.length).toBeLessThanOrEqual(200)
    expect(s).toContain('PAYWALL')
    expect(s.startsWith('…')).toBe(true)
    expect(snippetOf('short  text\n here', ['x'])).toBe('short text here')
  })

  it('masks tokens, key=value secrets and the home folder', () => {
    const out = maskSecrets('use sk-ant-abcdef1234567890 and password=hunter22 in C:\\Users\\me\\proj', 'C:\\Users\\me', 'win32')
    expect(out).not.toContain('sk-ant')
    expect(out).not.toContain('hunter22')
    expect(out).toContain('~\\proj')
  })

  it('builds highlight segments case-insensitively', () => {
    expect(highlightSegments('Fix PayWall now', ['paywall'])).toEqual([
      { text: 'Fix ', hit: false },
      { text: 'PayWall', hit: true },
      { text: ' now', hit: false },
    ])
  })
})

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'ccm-psearch-'))
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function writeSession(root: string, cwd: string, n: number, lines: unknown[]): Promise<string> {
  const dir = path.join(root, projectDirName(cwd))
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${uuid(n)}.jsonl`)
  await writeFile(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  return file
}

describe('scanTranscript', () => {
  it('counts matches, keeps 3 snippets, reads titles and skips huge lines', async () => {
    const root = await makeRoot()
    const file = await writeSession(root, 'D:\\work\\app', 1, [
      { type: 'ai-title', aiTitle: 'Paywall work', sessionId: 's' },
      user('paywall one', { promptSource: 'typed' }),
      user('x'.repeat(MAX_LINE_BYTES + 10) + ' paywall'),
      user([{ type: 'tool_result', content: 'paywall' }], { toolUseResult: {} }),
      user('paywall two'),
      user('paywall three'),
      user('paywall four'),
      { type: 'custom-title', customTitle: 'Renamed', sessionId: 's' },
    ])
    const s = await scanTranscript(file, { terms: ['paywall'], mask: (t) => t, cancelled: () => false })
    expect(s.matches).toBe(4)
    expect(s.snippets).toEqual(['paywall one', 'paywall two', 'paywall three'])
    expect(s.customTitle).toBe('Renamed')
    expect(s.aiTitle).toBe('Paywall work')
    expect(s.cwd).toBe('D:\\work\\app')
    expect(s.gitBranch).toBe('main')
    expect(s.startedAt).toBe('2026-10-20T08:00:00.000Z')
  })
})

describe('PromptSearcher', () => {
  const collect = () => {
    const events: MonitorEvent[] = []
    const hits = () => events.flatMap((e) => (e.type === 'promptSearch.progress' ? e.payload.hits : [])) as PromptSearchHit[]
    const done = () => events.find((e) => e.type === 'promptSearch.done')
    return { events, hits, done, reply: (e: MonitorEvent) => void events.push(e) }
  }

  it('returns one hit per session with every word matched, skipping sub-agent files', async () => {
    const root = await makeRoot()
    await writeSession(root, root, 1, [user('Build the PAYWALL with IAP', { cwd: root })])
    await writeSession(root, root, 2, [user('paywall only', { cwd: root })])
    const sub = path.join(root, projectDirName(root), uuid(1), 'subagents')
    await mkdir(sub, { recursive: true })
    await writeFile(path.join(sub, 'agent-a.jsonl'), JSON.stringify(user('paywall iap', { isSidechain: true })) + '\n')
    const searcher = new PromptSearcher(root, { yieldFn: async () => undefined })
    const c = collect()
    expect(await searcher.start(1, { searchId: 'a', query: 'iap paywall', days: 0, project: null }, c.reply)).toBe('done')
    expect(c.hits().map((h) => h.sessionId)).toEqual([uuid(1)])
    expect(c.hits()[0]!.cwdExists).toBe(true)
    expect(c.done()).toMatchObject({ payload: { state: 'done', filesTotal: 2, filesDone: 2, sessions: 1 } })
  })

  it('stops at 200 sessions', async () => {
    const root = await makeRoot()
    for (let i = 0; i < 205; i++) await writeSession(root, 'D:\\work\\app', i, [user('paywall')])
    const searcher = new PromptSearcher(root, { yieldFn: async () => undefined })
    const c = collect()
    expect(await searcher.start(1, { searchId: 'a', query: 'paywall', days: 0, project: null }, c.reply)).toBe('capped')
    expect(c.hits()).toHaveLength(200)
  })

  it('cancels on request and when a new search starts', async () => {
    const root = await makeRoot()
    for (let i = 0; i < 20; i++) await writeSession(root, 'D:\\work\\app', i, [user('paywall')])
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const searcher = new PromptSearcher(root, { yieldFn: () => gate })
    const first = collect()
    const p1 = searcher.start(1, { searchId: 'a', query: 'paywall', days: 0, project: null }, first.reply)
    await new Promise((r) => setTimeout(r, 50))
    searcher.cancel(1, 'other')
    searcher.cancel(1, 'a')
    release()
    expect(await p1).toBe('cancelled')
    expect(first.hits().length).toBeLessThan(20)

    const second = collect()
    const slow = new PromptSearcher(root, { yieldFn: () => new Promise((r) => setTimeout(r, 5)) })
    const p2 = slow.start(1, { searchId: 'b', query: 'paywall', days: 0, project: null }, second.reply)
    await new Promise((r) => setTimeout(r, 20))
    const third = collect()
    const p3 = slow.start(1, { searchId: 'c', query: 'paywall', days: 0, project: null }, third.reply)
    expect(await p2).toBe('cancelled')
    expect(await p3).toBe('done')
    expect(third.hits()).toHaveLength(20)
  })

  it('filters by project and date, opens only folders it found', async () => {
    const root = await makeRoot()
    const project = path.join(root, 'proj')
    await mkdir(project)
    await writeSession(root, project, 1, [user('paywall here', { cwd: project })])
    await writeSession(root, path.join(root, 'other'), 2, [user('paywall there', { cwd: path.join(root, 'other') })])
    const opened: string[] = []
    const searcher = new PromptSearcher(root, { yieldFn: async () => undefined, openFolder: async (dir) => (opened.push(dir), 'ok') })
    const c = collect()
    await searcher.start(7, { searchId: 'a', query: 'paywall', days: 7, project }, c.reply)
    expect(c.hits().map((h) => h.sessionId)).toEqual([uuid(1)])
    await searcher.open(7, 'a', uuid(1), c.reply)
    await searcher.open(7, 'a', uuid(2), c.reply)
    await searcher.open(8, 'a', uuid(1), c.reply)
    expect(opened).toEqual([project])
    const results = c.events.filter((e) => e.type === 'promptSearch.openResult').map((e) => (e.payload as { result: string }).result)
    expect(results).toEqual(['ok', 'notFound', 'notFound'])

    const old = collect()
    const later = new PromptSearcher(root, { yieldFn: async () => undefined, now: () => Date.now() + 30 * 86_400_000 })
    await later.start(1, { searchId: 'b', query: 'paywall', days: 7, project: null }, old.reply)
    expect(old.hits()).toHaveLength(0)
  })
})

describe('promptSearch.* validation', () => {
  it('accepts only well-formed requests', async () => {
    const dist = await mkdtemp(path.join(os.tmpdir(), 'ccm-dist-'))
    await writeFile(path.join(dist, 'index.html'), '<!doctype html>ok')
    const got: unknown[] = []
    const server = await startServer({ host: '127.0.0.1', port: 0, webDist: dist, store: new MonitorStore({ activityLimit: 10, batchMs: 10 }), onClientMessage: (m) => void got.push(m) })
    const port = (server.address() as AddressInfo).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const abs = path.resolve('/work/demo')
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
      })
      const bad = [
        { type: 'promptSearch.start', searchId: 'a', query: '', days: 7, project: null },
        { type: 'promptSearch.start', searchId: 'a b', query: 'x', days: 7, project: null },
        { type: 'promptSearch.start', searchId: 'a', query: 'x', days: 14, project: null },
        { type: 'promptSearch.start', searchId: 'a', query: 'x'.repeat(201), days: 7, project: null },
        { type: 'promptSearch.start', searchId: 'a', query: 'x', days: 7, project: 'relative/dir' },
        { type: 'promptSearch.open', searchId: 'a', sessionId: '../etc' },
        { type: 'promptSearch.cancel' },
      ]
      for (const m of bad) ws.send(JSON.stringify(m))
      ws.send(JSON.stringify({ type: 'promptSearch.start', searchId: 'a', query: 'paywall', days: 0, project: abs, extra: 1 }))
      ws.send(JSON.stringify({ type: 'promptSearch.cancel', searchId: 'a' }))
      ws.send(JSON.stringify({ type: 'promptSearch.open', searchId: 'a', sessionId: uuid(1) }))
      for (let i = 0; i < 100 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setTimeout(r, 50))
      expect(got).toEqual([
        { type: 'promptSearch.start', searchId: 'a', query: 'paywall', days: 0, project: abs },
        { type: 'promptSearch.cancel', searchId: 'a' },
        { type: 'promptSearch.open', searchId: 'a', sessionId: uuid(1) },
      ])
    } finally {
      ws.close()
      server.close()
    }
  })
})
