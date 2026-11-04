import { describe, expect, it } from 'vitest'
import type { TelegramEpisodeMessage, TerminalSession, TerminalStatus } from '@ccm/shared'
import { Toaster } from '../src/toast'
import { extractSignals, TranscriptState } from '../src/transcript'

const term = (status: TerminalStatus, extra: Partial<TerminalSession> = {}): TerminalSession => ({ id: 'a', title: 'auto title', status, cwd: 'D:\\work\\shop', ...extra })

function setup() {
  let now = Date.parse('2026-11-04T10:00:00')
  const toaster = new Toaster({ supported: false, port: 4317 }, { show: async () => true, hide: async () => true, now: () => now })
  const sent: TelegramEpisodeMessage[] = []
  toaster.onTelegram = (m) => sent.push(m)
  return { toaster, sent, advance: (ms: number) => (now += ms) }
}

describe('Telegram episodes (v82)', () => {
  it('reports a finished turn with its length, cwd and last reply, ignoring toast kinds and quiet hours', () => {
    const { toaster, sent, advance } = setup()
    toaster.update({ kinds: { done: false, waiting: false }, quiet: { enabled: true, from: '00:00', to: '23:59' } })
    const see = (t: TerminalSession) => toaster.observe({ terminals: [t], replyOf: () => 'All tests pass.' })
    see(term('idle'))
    see(term('working'))
    advance(90_000)
    see(term('idle', { statusSince: 'x' }))
    expect(sent).toEqual([expect.objectContaining({ type: 'telegram', reason: 'done', terminalId: 'a', name: 'shop', cwd: 'D:\\work\\shop', worked: 90_000, reply: 'All tests pass.' })])
  })

  it('does not report a session first seen already working, and reports waits by kind', () => {
    const { toaster, sent } = setup()
    const see = (t: TerminalSession) => toaster.observe({ terminals: [t], toolOf: () => 'Bash' })
    see(term('working'))
    see(term('idle'))
    expect(sent).toHaveLength(0)
    see(term('waiting', { waitingFor: 'permission prompt', statusSince: '2026-11-04T10:00:00Z' }))
    expect(sent).toEqual([expect.objectContaining({ reason: 'permission', tool: 'Bash' })])
  })
})

describe('last reply in the transcript', () => {
  const rec = (id: string, text: string | null, end = false, tool = false) => ({
    type: 'assistant',
    timestamp: '2026-11-04T10:00:00Z',
    message: {
      id,
      stop_reason: end ? 'end_turn' : null,
      content: [...(text ? [{ type: 'text', text }] : []), ...(tool ? [{ type: 'tool_use', id: `tu-${id}`, name: 'Bash', input: {} }] : [])],
    },
  })

  it('keeps the text of the message that ended the turn', () => {
    const s = new TranscriptState()
    s.apply(extractSignals(rec('m1', 'Let me check', false, true)))
    expect(s.lastReply).toBeUndefined()
    s.apply(extractSignals(rec('m2', 'Done: 3 files changed.')))
    s.apply(extractSignals(rec('m2', 'Build is green.', true)))
    expect(s.lastReply).toBe('Done: 3 files changed.\nBuild is green.')
    s.apply(extractSignals(rec('m3', 'x'.repeat(5000), true)))
    expect(s.lastReply).toHaveLength(3000)
  })

  const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', timestamp: '2026-11-04T10:01:00Z', message: { role: 'user', content }, ...extra })

  it('drops the reply of the previous turn when a new prompt starts, so an interrupted turn has none', () => {
    const s = new TranscriptState()
    s.apply(extractSignals(rec('m1', 'Answer A', true)))
    expect(s.lastReply).toBe('Answer A')
    s.apply(extractSignals(user('do the next thing')))
    expect(s.lastReply).toBeUndefined()
    s.apply(extractSignals(rec('m2', 'Let me check', false, true)))
    s.apply(extractSignals(user([{ type: 'tool_result', tool_use_id: 'tu-m2', content: 'ok' }])))
    s.apply(extractSignals(user([{ type: 'text', text: '[Request interrupted by user]' }])))
    expect(s.lastReply).toBeUndefined()
  })

  it('keeps the reply across tool results and meta records, and needs text in the message that ended the turn', () => {
    const s = new TranscriptState()
    s.apply(extractSignals(user('fix it')))
    s.apply(extractSignals(rec('m1', 'Let me check', false, true)))
    s.apply(extractSignals(user([{ type: 'tool_result', tool_use_id: 'tu-m1', content: 'ok' }])))
    s.apply(extractSignals(user('<local-command-caveat>x</local-command-caveat>', { isMeta: true })))
    s.apply(extractSignals(rec('m2', null, true)))
    expect(s.lastReply).toBeUndefined()
    s.apply(extractSignals(user('again')))
    s.apply(extractSignals(rec('m3', 'Fixed.', true)))
    expect(s.lastReply).toBe('Fixed.')
  })

  it('a done episode after an interrupted turn carries no reply of the turn before', () => {
    const { toaster, sent, advance } = setup()
    const s = new TranscriptState()
    const see = (t: TerminalSession) => toaster.observe({ terminals: [t], replyOf: () => s.lastReply })
    s.apply(extractSignals(rec('m1', 'Answer A', true)))
    see(term('idle'))
    s.apply(extractSignals(user('next task')))
    see(term('working'))
    advance(90_000)
    s.apply(extractSignals(user([{ type: 'text', text: '[Request interrupted by user]' }])))
    see(term('idle', { statusSince: 'y' }))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.reply).toBeUndefined()
  })
})
