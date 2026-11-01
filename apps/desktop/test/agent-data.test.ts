import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyEntry, parseCleanRequest, type MoveRecord } from '@ccm/shared'
import { extractSignals } from '../../collector/src/transcript'
import { copyTree, linkTarget, makeDirLink, removeLink, removeTree, verifyCopy } from '../src/agentData/fsTree'
import { decideRecovery, MoveStore, parseMountLine, recoverMoves } from '../src/agentData/move'
import { parseTasklist, procAgent } from '../src/agentData/procs'
import { AgentDataService, cleanPlan, type AgentDataDeps, type AgentDataTexts } from '../src/agentData/service'
import { runningSessions, sessionOfRel, stripCandidates, stripFile, stripLine, stripRecord } from '../src/agentData/strip'

const DAY = 86_400_000
let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-agentdata-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function put(file: string, text: string, ageMs = 0): string {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  if (ageMs) {
    const t = new Date(Date.now() - ageMs)
    utimesSync(file, t, t)
  }
  return file
}

const B64 = 'iVBORw0KGgo'.padEnd(4000, 'A')
const SID = '11111111-2222-4333-8444-555555555555'
// Shapes of Claude Code 2.1.294 records (docs §11ai): a pasted image, a Read result image, a queued prompt with an image.
const pasted = { type: 'user', sessionId: SID, message: { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64 } }] } }
const readResult = {
  type: 'user',
  sessionId: SID,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: B64 } }] }] },
  toolUseResult: { type: 'image', file: { base64: B64, type: 'image/jpeg', originalSize: 3000, dimensions: { originalWidth: 10, originalHeight: 10 } } },
}
const queued = { type: 'attachment', attachment: { type: 'queued_command', prompt: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64 } }] } }
const assistant = { type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.png' } }] } }

describe('agent data classification', () => {
  it('maps verified entries and leaves the rest unknown', () => {
    expect(classifyEntry('claude', 'projects').kind).toBe('history')
    expect(classifyEntry('claude', 'shell-snapshots')).toMatchObject({ kind: 'cache', cleanable: true, idleOnly: true })
    expect(classifyEntry('claude', '.credentials.json').kind).toBe('config')
    expect(classifyEntry('claude', 'settings.json.bak-statusline').kind).toBe('config')
    expect(classifyEntry('claude', '.caveman-active.123').kind).toBe('unknown')
    expect(classifyEntry('claude', 'plugins').cleanable).toBeFalsy()
    expect(classifyEntry('codex', 'thread_history_1.sqlite-wal').kind).toBe('history')
    expect(classifyEntry('codex', 'generated_images').kind).toBe('history')
    expect(classifyEntry('codex', 'sandbox.2026-05-27.log').cleanable).toBe(true)
    expect(classifyEntry('codex', 'logs_2.sqlite').cleanable).toBeFalsy()
    expect(classifyEntry('codex', '.sandbox-bin').kind).toBe('program')
    expect(classifyEntry('codex', 'auth.json').kind).toBe('config')
    expect(classifyEntry('claude', 'Projects', true).kind).toBe('history')
    expect(classifyEntry('claude', 'Projects').kind).toBe('unknown')
  })

  it('accepts only cleanable groups and known ages', () => {
    expect(parseCleanRequest({ agent: 'claude', groups: ['debugLogs', 'debugLogs'], olderDays: 30 })).toEqual({ agent: 'claude', groups: ['debugLogs'], olderDays: 30 })
    expect(parseCleanRequest({ agent: 'claude', groups: ['transcripts'], olderDays: 30 })).toBeNull()
    expect(parseCleanRequest({ agent: 'claude', groups: ['unknown'], olderDays: 30 })).toBeNull()
    expect(parseCleanRequest({ agent: 'claude', groups: ['debugLogs'], olderDays: 5 })).toBeNull()
    expect(parseCleanRequest({ agent: 'x', groups: ['debugLogs'], olderDays: 0 })).toBeNull()
  })

  it('selects cache files by age and never the last 24 h or other groups', async () => {
    put(path.join(tmp, 'debug', 'old.txt'), 'a', 40 * DAY)
    put(path.join(tmp, 'debug', 'mid.txt'), 'bb', 10 * DAY)
    put(path.join(tmp, 'debug', 'new.txt'), 'c', 60 * 60 * 1000)
    put(path.join(tmp, 'projects', 'x', 'old.jsonl'), 'd', 90 * DAY)
    put(path.join(tmp, 'mcp-health-cache.json'), '{}', 40 * DAY)
    const names = (plan: { files: { path: string }[] }): string[] => plan.files.map((f) => path.basename(f.path)).sort()
    expect(names(await cleanPlan(tmp, { agent: 'claude', groups: ['debugLogs'], olderDays: 30 }, Date.now()))).toEqual(['old.txt'])
    expect(names(await cleanPlan(tmp, { agent: 'claude', groups: ['debugLogs', 'appCache'], olderDays: 0 }, Date.now()))).toEqual(['mcp-health-cache.json', 'mid.txt', 'old.txt'])
  })

  it('names agent processes', () => {
    expect(procAgent('claude.exe')).toBe('claude')
    expect(procAgent('Claude.exe')).toBe('claude')
    expect(procAgent('/usr/local/bin/codex')).toBe('codex')
    expect(procAgent('claude-helper.exe')).toBeNull()
    expect(parseTasklist('"codex.exe","42","Console","1","10 K"\r\n"x.exe","7","Console","1","1 K"')).toEqual([
      { name: 'codex.exe', pid: 42 },
      { name: 'x.exe', pid: 7 },
    ])
    expect(parseMountLine('//u@nas/share on /Volumes/share (smbfs, nodev)')).toEqual(['/Volumes/share', 'smbfs'])
    expect(parseMountLine('server:/x on /mnt/x type nfs4 (rw)')).toEqual(['/mnt/x', 'nfs4'])
  })
})

describe('image strip', () => {
  it('replaces image blocks and the Read copy, keeping the records valid and the signals the same', () => {
    for (const rec of [pasted, readResult, queued]) {
      const line = JSON.stringify(rec)
      const out = stripLine(line)
      expect(out.images).toBeGreaterThan(0)
      expect(out.line).not.toContain(B64)
      const parsed = JSON.parse(out.line)
      expect(extractSignals(parsed)).toEqual(extractSignals(JSON.parse(line)))
    }
    const rec = structuredClone(readResult)
    const n = stripRecord(rec)
    expect(n).toEqual({ images: 1, bytes: B64.length * 2 })
    expect(rec.message.content[0]!.content[0]).toMatchObject({ type: 'text' })
    expect((rec.message.content[0]!.content[0] as unknown as { text: string }).text).toContain('image/jpeg')
    expect(rec.toolUseResult.file.base64).toBe('')
    expect(rec.toolUseResult.file.dimensions).toEqual({ originalWidth: 10, originalHeight: 10 })
    const plain = JSON.stringify(assistant)
    expect(stripLine(plain).line).toBe(plain)
    expect(stripLine('{"type":"user","note":"base64" ').line).toBe('{"type":"user","note":"base64" ')
  })

  it('rewrites a file through a temp file after backing it up, keeping its time', async () => {
    const lines = [JSON.stringify(assistant), JSON.stringify(readResult), JSON.stringify(pasted), '{"type":"system","content":"x"}']
    const file = put(path.join(tmp, 'projects', 'slug', `${SID}.jsonl`), `${lines.join('\n')}\n`, 40 * DAY)
    const mtime = statSync(file).mtimeMs
    const backup = path.join(tmp, 'backup', 'slug', `${SID}.jsonl`)
    const r = await stripFile(file, backup)
    expect(r).toMatchObject({ ok: true, images: 2 })
    expect(readFileSync(backup, 'utf8')).toBe(`${lines.join('\n')}\n`)
    const now = readFileSync(file, 'utf8').split('\n')
    expect(now).toHaveLength(5)
    expect(now[0]).toBe(lines[0])
    expect(now[3]).toBe(lines[3])
    expect(now.join('\n')).not.toContain(B64)
    expect(Math.abs(statSync(file).mtimeMs - mtime)).toBeLessThan(2000)
    expect(existsSync(`${file}.orrery-strip-tmp`)).toBe(false)
    expect(await stripFile(file, path.join(tmp, 'backup2', 'x.jsonl'))).toEqual({ ok: true, images: 0, bytes: 0 })
    expect(existsSync(path.join(tmp, 'backup2'))).toBe(false)
  })

  it('picks old transcripts of sessions that do not run', async () => {
    const other = '99999999-2222-4333-8444-555555555555'
    put(path.join(tmp, 'projects', 'slug', `${SID}.jsonl`), 'x', 40 * DAY)
    put(path.join(tmp, 'projects', 'slug', SID, 'subagents', 'agent-a1.jsonl'), 'x', 40 * DAY)
    put(path.join(tmp, 'projects', 'slug', `${other}.jsonl`), 'x', 40 * DAY)
    put(path.join(tmp, 'projects', 'slug', '99999999-0000-4333-8444-555555555555.jsonl'), 'x', DAY)
    put(path.join(tmp, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, sessionId: other }))
    put(path.join(tmp, 'sessions', '2.json'), JSON.stringify({ pid: 999_999_999, sessionId: SID }))
    expect(sessionOfRel(`slug/${SID}/subagents/agent-a1.jsonl`)).toBe(SID)
    expect(sessionOfRel('slug/memory/notes.jsonl')).toBeNull()
    const running = await runningSessions(tmp, (pid) => pid === process.pid)
    expect([...running]).toEqual([other])
    const c = await stripCandidates(path.join(tmp, 'projects'), Date.now() - 30 * DAY, running)
    expect(c.map((x) => x.rel.replace(/\\/g, '/')).sort()).toEqual([`slug/${SID}.jsonl`, `slug/${SID}/subagents/agent-a1.jsonl`])
  })
})

describe('copy, verify, links', () => {
  it('copies a tree with a junction as a link, verifies it, and deletes without following the link', async () => {
    const src = path.join(tmp, 'src')
    const outside = path.join(tmp, 'outside')
    put(path.join(outside, 'keep.png'), 'precious')
    put(path.join(src, 'a.txt'), 'hello', 5 * DAY)
    put(path.join(src, 'deep', 'b.bin'), 'x'.repeat(70_000))
    mkdirSync(path.join(src, 'empty'))
    await makeDirLink(outside, path.join(src, 'generated_images'))
    const dst = path.join(tmp, 'dst', 'src')
    mkdirSync(path.dirname(dst))
    const copy = await copyTree(src, dst)
    expect(copy).toMatchObject({ files: 2, links: 1, skipped: [] })
    expect(await linkTarget(path.join(dst, 'generated_images'))).toBe(path.resolve(outside))
    expect(existsSync(path.join(dst, 'empty'))).toBe(true)
    expect(Math.abs(statSync(path.join(dst, 'a.txt')).mtimeMs - statSync(path.join(src, 'a.txt')).mtimeMs)).toBeLessThan(2000)
    expect((await verifyCopy(src, dst)).ok).toBe(true)
    writeFileSync(path.join(dst, 'deep', 'b.bin'), 'y'.repeat(70_000))
    const bad = await verifyCopy(src, dst)
    expect(bad.ok).toBe(false)
    expect(bad.mismatch?.replace(/\\/g, '/')).toBe('deep/b.bin')
    put(path.join(dst, 'extra.txt'), 'new')
    expect((await verifyCopy(src, dst)).ok).toBe(false)
    const removed = await removeTree(dst)
    expect(removed.failed).toBe(0)
    expect(existsSync(dst)).toBe(false)
    expect(readFileSync(path.join(outside, 'keep.png'), 'utf8')).toBe('precious')
  })

  it('creates and removes a directory link, refusing a real folder', async () => {
    const target = path.join(tmp, 'target')
    put(path.join(target, 'f.txt'), 'x')
    const at = path.join(tmp, 'link')
    await makeDirLink(target, at)
    expect(readFileSync(path.join(at, 'f.txt'), 'utf8')).toBe('x')
    await expect(removeLink(target)).rejects.toThrow()
    await removeLink(at)
    expect(existsSync(at)).toBe(false)
    expect(existsSync(path.join(target, 'f.txt'))).toBe(true)
  })
})

describe('interrupted moves', () => {
  const rec = (phase: MoveRecord['phase']): MoveRecord => ({ agent: 'claude', source: 's', target: 't', backup: 'b', at: 1, phase, originalDeleted: false })

  it('decides what to do at start', () => {
    expect(decideRecovery(rec('copying'), { source: 'dir', backupExists: false })).toBe('interrupted')
    expect(decideRecovery(rec('switching'), { source: 'missing', backupExists: true })).toBe('rollback')
    expect(decideRecovery(rec('switching'), { source: 'link', backupExists: true })).toBe('linked')
    expect(decideRecovery(rec('switching'), { source: 'dir', backupExists: false })).toBe('interrupted')
    expect(decideRecovery(rec('linked'), { source: 'link', backupExists: true })).toBe('keep')
    expect(decideRecovery(rec('undoing'), { source: 'dir', backupExists: false })).toBe('drop')
    expect(decideRecovery(rec('undoing'), { source: 'missing', backupExists: true })).toBe('rollback')
  })

  it('puts the renamed original back when the app died between rename and link', async () => {
    const source = path.join(tmp, '.claude')
    const backup = `${source}.orrery-moved-1`
    put(path.join(backup, 'projects', 'p', 'x.jsonl'), '{}')
    const store = new MoveStore(path.join(tmp, 'data', 'agent-data-move.json'))
    await store.set({ agent: 'claude', source, target: path.join(tmp, 'L', '.claude'), backup, at: 1, phase: 'switching', originalDeleted: false })
    const again = new MoveStore(path.join(tmp, 'data', 'agent-data-move.json'))
    await again.load()
    expect(await recoverMoves(again)).toEqual(['claude'])
    expect(existsSync(path.join(source, 'projects', 'p', 'x.jsonl'))).toBe(true)
    expect(again.get('claude')?.phase).toBe('interrupted')
  })
})

describe('move service', () => {
  let source: string
  let parent: string
  let answers: number[]
  let procs: { pid: number; name: string }[]
  let collector: string[]
  let service: AgentDataService
  const texts = new Proxy({}, { get: (_t, k) => (k === 'cancel' ? 'Cancel' : (...a: unknown[]) => `${String(k)} ${a.join(' ')}`) }) as unknown as AgentDataTexts

  beforeEach(async () => {
    source = path.join(tmp, 'home', '.claude')
    parent = path.join(tmp, 'L')
    mkdirSync(parent)
    put(path.join(source, 'projects', 'p', `${SID}.jsonl`), `${JSON.stringify(pasted)}\n`, 40 * DAY)
    put(path.join(source, 'settings.json'), '{}')
    put(path.join(source, 'debug', 'old.log'), 'log', 40 * DAY)
    answers = []
    procs = []
    collector = []
    const deps: AgentDataDeps = {
      roots: () => ({ claude: source, codex: path.join(tmp, 'home', '.codex'), claudeApp: null }),
      store: new MoveStore(path.join(tmp, 'data', 'agent-data-move.json')),
      procs: async () => procs,
      confirm: async () => answers.shift() ?? 99,
      pickFolder: async (purpose) => (purpose === 'target' ? parent : path.join(tmp, 'backup')),
      stopCollector: async () => void collector.push('stop'),
      startCollector: async () => void collector.push('start'),
      emit: () => undefined,
      isLocal: async () => true,
      freeBytes: async () => 1e12,
      texts: () => texts,
      alive: () => false,
    }
    service = new AgentDataService(deps)
    await service.recover()
  })

  it('refuses while the agent runs and moves, undoes with copy back, deletes the original', async () => {
    procs = [{ pid: 7, name: 'claude.exe' }]
    expect(await service.move('claude')).toMatchObject({ ok: false, error: 'running', procs })
    procs = []
    answers = [1]
    expect(await service.move('claude')).toMatchObject({ ok: false, error: 'cancelled' })
    expect(existsSync(path.join(parent, '.claude'))).toBe(false)
    answers = [0]
    const moved = await service.move('claude')
    expect(moved).toMatchObject({ ok: true, files: 3 })
    expect(collector).toEqual(['stop', 'start'])
    expect(await linkTarget(source)).toBe(path.join(parent, '.claude'))
    expect(readFileSync(path.join(source, 'settings.json'), 'utf8')).toBe('{}')
    const state = await service.state()
    expect(state.places[0]!.move?.phase).toBe('linked')
    expect(await service.move('claude')).toMatchObject({ error: 'already-moved' })
    writeFileSync(path.join(source, 'settings.json'), '{"after":1}')
    answers = [0]
    expect(await service.undo('claude')).toMatchObject({ ok: true, files: 1 })
    expect(await linkTarget(source)).toBeNull()
    expect(readFileSync(path.join(source, 'settings.json'), 'utf8')).toBe('{"after":1}')
    expect(existsSync(path.join(parent, '.claude', 'settings.json'))).toBe(true)
    expect((await service.state()).places[0]!.move).toBeNull()
    await removeTree(path.join(parent, '.claude'))
    answers = [0]
    expect((await service.move('claude')).ok).toBe(true)
    const rec = (await service.state()).places[0]!.move!
    answers = [0]
    expect((await service.deleteOriginal('claude')).ok).toBe(true)
    expect(existsSync(rec.backup)).toBe(false)
    expect(existsSync(path.join(source, 'projects', 'p', `${SID}.jsonl`))).toBe(true)
    answers = [0]
    expect((await service.undo('claude')).ok).toBe(true)
    expect(await linkTarget(source)).toBeNull()
    expect(existsSync(path.join(source, 'projects', 'p', `${SID}.jsonl`))).toBe(true)
  })

  it('refuses a target inside the source or one that exists', async () => {
    mkdirSync(path.join(parent, '.claude'))
    answers = [0]
    expect(await service.move('claude')).toMatchObject({ error: 'target-exists' })
    parent = path.join(source, 'debug')
    expect(await service.move('claude')).toMatchObject({ error: 'target-inside' })
  })

  it('cleans and strips with a backup', async () => {
    answers = [0]
    expect(await service.clean({ agent: 'claude', groups: ['debugLogs'], olderDays: 30 })).toMatchObject({ ok: true, files: 1 })
    expect(existsSync(path.join(source, 'debug', 'old.log'))).toBe(false)
    answers = [0]
    const r = await service.strip(30)
    expect(r).toMatchObject({ ok: true, files: 1 })
    expect(readFileSync(path.join(source, 'projects', 'p', `${SID}.jsonl`), 'utf8')).not.toContain(B64)
    const backups = await fs.readdir(path.join(tmp, 'backup'))
    expect(readFileSync(path.join(tmp, 'backup', backups[0]!, 'p', `${SID}.jsonl`), 'utf8')).toContain(B64)
    expect(await service.strip(30)).toMatchObject({ error: 'nothing' })
  })
})
