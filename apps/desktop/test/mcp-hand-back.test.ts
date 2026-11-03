import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseMcpPageResult, type McpPageResult } from '@ccm/shared'
import { handleMcp, type ToolHost } from '../src/pty/mcp'
import { HAND_BACK_RATE_MS, REPORT_MAX_BYTES } from '../src/pty/mcpTools/handBack'

let dir = ''
let root = ''
let outside = ''

beforeAll(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-handback-')))
  root = path.join(dir, 'project')
  outside = path.join(dir, 'secret')
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'DS-report.md'), '# Done\n')
  writeFileSync(path.join(root, 'big.md'), Buffer.alloc(REPORT_MAX_BYTES + 1, 0x61))
  writeFileSync(path.join(outside, 'r.md'), '# x\n')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fail = (): Promise<never> => Promise.reject(new Error('not expected'))
const hostWith = (over: Partial<ToolHost> = {}): ToolHost => ({ root, preset: 'deepseek', take: () => true, openSession: fail, notify: fail, page: fail, checkoutRoots: () => Promise.resolve([]), ...over })
const call = async (host: ToolHost, args: unknown) => {
  const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hand_back', arguments: args } }, host, '0')
  return (res.json as { result: { content: { text: string }[]; structuredContent: Record<string, unknown>; isError?: boolean } }).result
}
const ok = { report: 'DS-report.md', summary: 'x' }

describe('hand_back', () => {
  it('hands the real report path and the cleaned summary to the page, once per 2 minutes', async () => {
    const page = vi.fn((): Promise<McpPageResult> => Promise.resolve({ ok: true, tool: 'hand_back', origin: 'lead' }))
    const take = vi.fn(() => true)
    const res = await call(hostWith({ page, take }), { report: 'DS-report.md', summary: 'tests‮ added\n ok' })
    expect(page).toHaveBeenCalledWith({ tool: 'hand_back', report: path.join(root, 'DS-report.md'), summary: 'tests added ok' })
    expect(take).toHaveBeenCalledWith('hand_back', 1, HAND_BACK_RATE_MS)
    expect(res.isError).toBeUndefined()
    expect(res.content[0]!.text).toBe('Handed back to lead. Orrery submits the prompt there as soon as it is idle; stop working on this task now.')
    expect(res.structuredContent).toEqual({ ok: true, report: path.join(root, 'DS-report.md'), origin: 'lead' })
    const abs = await call(hostWith({ page }), { report: path.join(root, 'DS-report.md'), summary: 'y' })
    expect(abs.isError).toBeUndefined()
  })

  it('refuses other presets, bad reports and summaries before the page or the rate window', async () => {
    const page = vi.fn(fail)
    const take = vi.fn(() => true)
    for (const preset of [undefined, 'claude', 'codex', 'shell'] as const) {
      const res = await call(hostWith({ page, take, preset }), ok)
      expect(res).toMatchObject({ isError: true, structuredContent: { ok: false, error: 'preset' } })
      expect(res.content[0]!.text).toBe('hand_back is only for DeepSeek sessions opened by another agent')
    }
    for (const [args, error] of [
      [{ report: '../secret/r.md', summary: 'x' }, 'outside'],
      [{ report: path.join(outside, 'r.md'), summary: 'x' }, 'outside'],
      [{ report: 'src/a.ts', summary: 'x' }, 'markdown'],
      [{ report: 'none.md', summary: 'x' }, 'missing'],
      [{ report: 'src', summary: 'x' }, 'folder'],
      [{ report: 'big.md', summary: 'x' }, 'size'],
      [{ report: '\\\\host\\share\\r.md', summary: 'x' }, 'path'],
      [{ report: 'DS-report.md', summary: ' \n ' }, 'summary'],
      [{ report: 'DS-report.md', summary: 'x'.repeat(201) }, 'summary'],
      [{ report: 'DS-report.md' }, 'summary'],
      [{ summary: 'x' }, 'path'],
    ] as const) {
      const res = await call(hostWith({ page, take }), args)
      expect(res.isError).toBe(true)
      expect(res.structuredContent).toEqual({ ok: false, error })
    }
    expect(take).not.toHaveBeenCalled()
    const limited = await call(hostWith({ page, take: () => false }), ok)
    expect(limited.structuredContent).toEqual({ ok: false, error: 'rate' })
    expect(page).not.toHaveBeenCalled()
  })

  it('tells the session when there is nobody to hand back to', async () => {
    const res = await call(hostWith({ page: () => Promise.resolve({ ok: false, error: 'caller' }) }), ok)
    expect(res).toMatchObject({ isError: true, structuredContent: { ok: false, error: 'caller' } })
    expect(res.content[0]!.text).toBe('This session was not opened by another Orrery pane (or that pane is closed), so there is nobody to hand back to; tell the user instead.')
    const thrown = await call(hostWith({ page: fail }), ok)
    expect(thrown.structuredContent).toEqual({ ok: false, error: 'failed' })
    const wrong = await call(hostWith({ page: () => Promise.resolve({ ok: true, tool: 'notify_owner', name: 'x', inbox: true }) }), ok)
    expect(wrong.structuredContent).toEqual({ ok: false, error: 'failed' })
  })

  it('parses the page reply', () => {
    expect(parseMcpPageResult({ ok: true, origin: 'lead‮' }, 'hand_back')).toEqual({ ok: true, tool: 'hand_back', origin: 'lead' })
    expect(parseMcpPageResult({ ok: true }, 'hand_back')).toEqual({ ok: false, error: 'failed' })
  })
})
