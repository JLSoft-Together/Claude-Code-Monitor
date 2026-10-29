import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { estimateCost, priceOf, type UsageBucket, type UsageScan, type UsageSnapshot } from '@ccm/shared'
import { localDay, mcpServerOf, parseBucketKey, toolCallsOf, UsageIndex, usageRecordOf, type UsageSink } from '../src/usage'

const line = (o: unknown) => `${JSON.stringify(o)}\n`
const TS = '2026-10-07T09:00:00.000Z'
const DAY = localDay(TS)!
const CWD = 'D:\\work\\demo'

const assistant = (id: string, usage: Record<string, unknown>, model = 'claude-opus-5-5') =>
  line({ type: 'assistant', timestamp: TS, cwd: CWD, message: { id, model, content: [{ type: 'text', text: 'secret' }], usage } })

class Sink implements UsageSink {
  snapshot: UsageSnapshot = { buckets: [], scan: { state: 'idle', filesDone: 0, filesTotal: 0 } }
  updates: UsageBucket[][] = []
  scans: UsageScan[] = []
  resetUsage(s: UsageSnapshot) {
    this.snapshot = s
  }
  updateUsage(b: UsageBucket[]) {
    this.updates.push(b)
    for (const x of b) {
      const i = this.snapshot.buckets.findIndex((y) => y.key === x.key)
      if (i >= 0) this.snapshot.buckets[i] = x
      else this.snapshot.buckets.push(x)
    }
  }
  setUsageScan(s: UsageScan) {
    this.scans.push(s)
  }
}

const opusOf = (s: Sink) => s.snapshot.buckets.find((b) => b.model === 'claude-opus-5-5')

describe('usage record parsing', () => {
  it('splits cache writes and skips synthetic / non-assistant records', () => {
    const r = usageRecordOf(
      JSON.parse(
        assistant('m1', {
          input_tokens: 2,
          output_tokens: 10,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 400,
          cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
        }),
      ),
      'slug',
    )
    expect(r).toMatchObject({
      day: DAY,
      model: 'claude-opus-5-5',
      project: CWD,
      fast: false,
      totals: { messages: 1, input: 2, output: 10, cacheWrite5m: 10, cacheWrite1h: 20, cacheRead: 400 },
    })
    expect(usageRecordOf(JSON.parse(assistant('m2', { input_tokens: 1 }, '<synthetic>')), 'x')).toBeNull()
    expect(usageRecordOf({ type: 'user', message: { usage: {} } }, 'x')).toBeNull()

    const legacy = usageRecordOf(JSON.parse(assistant('m3', { cache_creation_input_tokens: 9, speed: 'fast' })), 'x')
    expect(legacy?.totals.cacheWrite5m).toBe(9)
    expect(legacy?.fast).toBe(true)
    expect(parseBucketKey(legacy!.key)).toMatchObject({ day: DAY, model: 'claude-opus-5-5', project: CWD, fast: true })
  })

  it('prices known models and returns null for unknown ones', () => {
    expect(priceOf('claude-opus-5-5')?.input).toBe(4)
    expect(priceOf('claude-opus-5')?.input).toBe(5)
    expect(priceOf('claude-haiku-4-5-20251001')?.output).toBe(5)
    expect(priceOf('gpt-x')).toBeNull()
    const million = { messages: 1, input: 1_000_000, output: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1_000_000 }
    expect(estimateCost(million, 'claude-opus-5-5')).toBeCloseTo(4 + 20 + 0.2)
    expect(estimateCost({ ...million, output: 0, cacheRead: 0 }, 'claude-opus-5-5', true)).toBeCloseTo(8)
    expect(estimateCost(million, 'gpt-x')).toBeNull()
  })
})

describe('UsageIndex', () => {
  let projects: string
  let cache: string
  let file: string

  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccm-usage-'))
    projects = path.join(root, 'projects')
    cache = path.join(root, 'data', 'usage-index.json')
    await mkdir(path.join(projects, 'D--work-demo', 'sid', 'subagents'), { recursive: true })
    file = path.join(projects, 'D--work-demo', 'sid.jsonl')
    await writeFile(
      file,
      assistant('m1', { input_tokens: 5, output_tokens: 7 }) +
        assistant('m1', { input_tokens: 5, output_tokens: 7 }) +
        assistant('m2', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100 }),
    )
    await writeFile(path.join(projects, 'D--work-demo', 'sid', 'subagents', 'agent-a.jsonl'), assistant('s1', { output_tokens: 3 }, 'claude-haiku-4-5'))
  })

  const start = async (sink: Sink) => {
    const index = new UsageIndex(projects, cache, sink, { sweepMs: 0, fileDebounceMs: 1, saveDebounceMs: 1 })
    await index.start()
    await index.whenIdle()
    return index
  }

  const settle = async (index: UsageIndex) => {
    await new Promise((r) => setTimeout(r, 20))
    await index.whenIdle()
  }

  it('scans all transcripts, dedupes by message id and splits by model', async () => {
    const sink = new Sink()
    await start(sink)
    expect(opusOf(sink)).toMatchObject({ day: DAY, project: CWD, messages: 2, input: 6, output: 8, cacheRead: 100 })
    expect(sink.snapshot.buckets.find((b) => b.model === 'claude-haiku-4-5')).toMatchObject({ messages: 1, output: 3 })
    expect(sink.snapshot.scan.state).toBe('ready')
    expect(JSON.stringify(sink.snapshot)).not.toContain('secret')
  })

  it('counts messages per local hour and keeps them through the cache', async () => {
    const index = await start(new Sink())
    const hour = new Date(TS).getHours()
    const row = index.heatmap(3, DAY).days
    expect(row.map((d) => d.day).at(-1)).toBe(DAY)
    expect(row.at(-1)!.hours[hour]).toBe(3)
    expect(row.at(-1)!.hours.reduce((a, b) => a + b, 0)).toBe(3)
    await index.stop()
    const again = await start(new Sink())
    expect(again.heatmap(1, DAY).days[0]!.hours[hour]).toBe(3)
  })

  it('tails appended lines and waits for a partial line to complete', async () => {
    const sink = new Sink()
    const index = await start(sink)
    const next = assistant('m3', { output_tokens: 50 })
    const rel = path.relative(projects, file)

    await appendFile(file, next.slice(0, 20))
    index.notify(rel)
    await settle(index)
    expect(opusOf(sink)!.output).toBe(8)

    await appendFile(file, next.slice(20))
    index.notify(rel)
    await settle(index)
    expect(opusOf(sink)).toMatchObject({ messages: 3, output: 58 })
    expect(sink.updates.length).toBeGreaterThan(0)
  })

  it('restores from cache without double counting and keeps history of deleted transcripts', async () => {
    const index = await start(new Sink())
    await index.stop()

    const restored = new Sink()
    await (await start(restored)).stop()
    expect(opusOf(restored)).toMatchObject({ messages: 2, output: 8 })

    await rm(file)
    const afterDelete = new Sink()
    await start(afterDelete)
    expect(opusOf(afterDelete)).toMatchObject({ messages: 2, output: 8 })
  })

  it('counts a message copied into a resumed transcript once, even after the original is deleted', async () => {
    const copy = path.join(projects, 'D--work-demo', 'resumed.jsonl')
    await writeFile(copy, assistant('m1', { input_tokens: 5, output_tokens: 7 }) + assistant('r1', { output_tokens: 2 }))
    const first = new Sink()
    await (await start(first)).stop()
    expect(opusOf(first)).toMatchObject({ messages: 3, output: 10 })

    await rm(file)
    const again = new Sink()
    await start(again)
    expect(opusOf(again)).toMatchObject({ messages: 3, output: 10 })
  })

  it('recounts a truncated transcript', async () => {
    const sink = new Sink()
    const index = await start(sink)
    await writeFile(file, assistant('n1', { output_tokens: 4 }))
    index.notify(path.relative(projects, file))
    await settle(index)
    expect(opusOf(sink)).toMatchObject({ messages: 1, output: 4 })
  })
})

describe('tool stats', () => {
  const use = (mid: string, id: string, name: string, input: Record<string, unknown> = {}, cwd = CWD) =>
    line({ type: 'assistant', timestamp: TS, cwd, message: { id: mid, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }], usage: { output_tokens: 1 } } })
  const result = (id: string, isError: boolean) =>
    line({ type: 'user', timestamp: TS, cwd: CWD, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'boom' }] } })

  it('reads only the name, skill and subagent type of a tool_use', () => {
    expect(toolCallsOf({ type: 'tool_use', name: 'Skill', input: { skill: 'pdf', args: 'secret' } })).toEqual([
      { kind: 't', name: 'Skill' },
      { kind: 's', name: 'pdf' },
    ])
    expect(toolCallsOf({ type: 'tool_use', name: 'Agent', input: { prompt: 'secret' } })).toEqual([
      { kind: 't', name: 'Agent' },
      { kind: 'a', name: 'general-purpose' },
    ])
    expect(toolCallsOf({ type: 'tool_use', name: 'Task', input: { subagent_type: 'Explore' } })[1]).toEqual({ kind: 'a', name: 'Explore' })
    expect(toolCallsOf({ type: 'tool_use', name: 'mcp__github__get_me', input: {} })).toEqual([{ kind: 'm', name: 'github' }])
    expect(toolCallsOf({ type: 'tool_use', name: 'a|b' })).toEqual([{ kind: 't', name: 'ab' }])
    expect(toolCallsOf({ type: 'text', name: 'Bash' })).toEqual([])
    expect(mcpServerOf('mcp__claude_ai_Gmail__send')).toBe('claude_ai_Gmail')
    expect(mcpServerOf('mcp__x')).toBeNull()
  })

  it('counts calls per project, split message lines, errors, and survives the cache', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccm-tools-'))
    const projects = path.join(root, 'projects')
    const cache = path.join(root, 'usage-index.json')
    await mkdir(path.join(projects, 'p'), { recursive: true })
    const file = path.join(projects, 'p', 's.jsonl')
    await writeFile(
      file,
      use('m1', 'tu1', 'Bash', { command: 'rm -rf secret' }) +
        use('m1', 'tu2', 'Skill', { skill: 'pdf' }) +
        result('tu1', true) +
        result('tu2', false) +
        use('m2', 'tu3', 'mcp__github__get_me') +
        result('tu3', true) +
        use('m3', 'tu4', 'Agent', { subagent_type: 'Explore', prompt: 'secret' }) +
        use('m4', 'tu5', 'Read', {}, 'E:\other'),
    )
    // A resumed copy of m1 in another transcript is not counted twice.
    await writeFile(path.join(projects, 'p', 'z-copy.jsonl'), use('m1', 'tu1', 'Bash'))
    const make = () => new UsageIndex(projects, cache, new Sink(), { sweepMs: 0, saveDebounceMs: 1 })
    const index = make()
    await index.start()
    await index.whenIdle()
    const all = index.toolStats(30, null, DAY)
    expect(all.tools).toEqual(
      expect.arrayContaining([
        { name: 'Bash', n: 1, errors: 1 },
        { name: 'Skill', n: 1, errors: 0 },
        { name: 'Agent', n: 1, errors: 0 },
        { name: 'Read', n: 1, errors: 0 },
      ]),
    )
    expect(all.tools).toHaveLength(4)
    expect(all.skills).toEqual([{ name: 'pdf', n: 1 }])
    expect(all.agents).toEqual([{ name: 'Explore', n: 1 }])
    expect(all.mcp).toEqual([{ name: 'github', n: 1, errors: 1 }])
    expect(all.projects).toEqual([CWD, 'E:\other'])
    expect(all.used30).toEqual({ skills: ['pdf'], mcp: ['github'] })
    expect(JSON.stringify(all)).not.toContain('secret')

    const other = index.toolStats(7, 'E:\other', DAY)
    expect(other.tools).toEqual([{ name: 'Read', n: 1, errors: 0 }])
    expect(other.used30).toEqual({ skills: [], mcp: [] })
    const tomorrow = localDay(new Date(Date.parse(TS) + 8 * 86_400_000).toISOString())!
    expect(index.toolStats(7, null, tomorrow).tools).toEqual([])
    expect(index.toolStats(30, null, tomorrow).used30.skills).toEqual(['pdf'])

    await index.stop()
    const again = make()
    await again.start()
    await again.whenIdle()
    expect(again.toolStats(30, null, DAY)).toEqual(all)
  })
})
