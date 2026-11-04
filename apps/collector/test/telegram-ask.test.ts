import { describe, expect, it } from 'vitest'
import type { TelegramEpisodeMessage, TerminalSession } from '@ccm/shared'
import { Toaster } from '../src/toast'
import { extractSignals, TranscriptState } from '../src/transcript'

const askRec = (id: string, questions: unknown, name = 'AskUserQuestion') => ({
  type: 'assistant',
  timestamp: '2026-11-05T10:00:00Z',
  message: { id: `m-${id}`, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input: { questions } }] },
})

const q1 = {
  question: 'Which database?',
  header: 'DB',
  multiSelect: false,
  options: [
    { label: 'Postgres', description: 'SECRET-DESCRIPTION', preview: 'SECRET-PREVIEW' },
    { label: 'SQLite', description: 'embedded' },
  ],
}

const resultRec = (id: string) => ({
  type: 'user',
  timestamp: '2026-11-05T10:01:00Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Postgres' }] },
})

function state(...recs: unknown[]) {
  const s = new TranscriptState()
  for (const r of recs) s.apply(extractSignals(r))
  return s
}

describe('AskUserQuestion capture (WP-C)', () => {
  it('keeps only the first question text and the option labels', () => {
    const s = state(askRec('tu1', [q1, { ...q1, question: 'Second?' }]))
    expect(s.pendingAsk()).toEqual({ question: 'Which database?', options: ['Postgres', 'SQLite'], multi: false })
    expect(JSON.stringify(s.pendingAsk())).not.toMatch(/SECRET|embedded|DB"/)
  })

  it('drops the ask once the tool_result arrives, on a new prompt, or a turn end', () => {
    expect(state(askRec('tu1', [q1]), resultRec('tu1')).pendingAsk()).toBeUndefined()
    expect(state(askRec('tu1', [q1]), { type: 'user', timestamp: 'x', message: { role: 'user', content: 'hi' } }).pendingAsk()).toBeUndefined()
    expect(state(askRec('tu1', [q1]), { type: 'system', subtype: 'turn_duration' }).pendingAsk()).toBeUndefined()
  })

  it('ignores other tools, empty options and malformed input', () => {
    expect(state(askRec('t', [q1], 'Bash')).pendingAsk()).toBeUndefined()
    expect(state(askRec('t', [{ ...q1, options: [] }])).pendingAsk()).toBeUndefined()
    expect(state(askRec('t', [{ ...q1, options: [{ label: '' }] }])).pendingAsk()).toBeUndefined()
    expect(state(askRec('t', 'nope')).pendingAsk()).toBeUndefined()
  })

  it('flags multiSelect and caps lengths and count', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`.padEnd(100, 'x') }))
    const a = state(askRec('t', [{ question: 'q'.repeat(500), multiSelect: true, options: many }])).pendingAsk()!
    expect(a.multi).toBe(true)
    expect(a.question).toHaveLength(200)
    expect(a.options).toHaveLength(6)
    expect(a.options[0]).toHaveLength(60)
    expect(a.more).toBe(true)
  })
})

describe('Telegram question episode carries the ask (WP-C)', () => {
  const term = (status: TerminalSession['status'], extra: Partial<TerminalSession> = {}): TerminalSession => ({ id: 'a', title: 't', status, cwd: 'D:\\work\\shop', ...extra })
  const run = (waitingFor: string, ask = { question: 'Q?', options: ['A', 'B'], multi: false }) => {
    const toaster = new Toaster({ supported: false, port: 4317 }, { show: async () => true, hide: async () => true, now: () => Date.parse('2026-11-05T10:00:00') })
    const sent: TelegramEpisodeMessage[] = []
    toaster.onTelegram = (m) => sent.push(m)
    toaster.observe({ terminals: [term('working')] })
    toaster.observe({ terminals: [term('waiting', { waitingFor, statusSince: '2026-11-05T10:00:00Z' })], askOf: () => ask })
    return sent
  }

  it('adds ask to question episodes only', () => {
    expect(run('input needed')[0]).toMatchObject({ reason: 'question', ask: { question: 'Q?', options: ['A', 'B'], multi: false } })
    expect(run('permission prompt')[0]!.ask).toBeUndefined()
  })
})
