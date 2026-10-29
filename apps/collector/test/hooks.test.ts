import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HookReader, parseHookRecord } from '../src/hooks'

const SID = '0b5f0d5e-9a4b-4c3e-8f2a-1d2c3b4a5e6f'
const BRIDGE = path.resolve(__dirname, '../../../scripts/hook-bridge.mjs')

describe('parseHookRecord', () => {
  it('keeps only known fields and drops bad tool names', () => {
    const r = parseHookRecord(JSON.stringify({ sessionId: SID, at: '2026-10-29T01:00:00Z', compactingSince: '2026-10-29T00:59:00Z', deniedCount: 2, deniedTools: ['Bash', 'rm -rf /'], prompt: 'secret' }))
    expect(r).toEqual({ sessionId: SID, at: '2026-10-29T01:00:00Z', compactingSince: '2026-10-29T00:59:00Z', compactTrigger: 'auto', deniedCount: 2, deniedTools: ['Bash'] })
    expect(parseHookRecord('{"sessionId":"x","at":"2026-10-29T01:00:00Z"}')).toBeNull()
  })
})

describe('hook-bridge.mjs → HookReader', () => {
  let data: string
  const run = (payload: object) => execFileSync(process.execPath, [BRIDGE], { input: JSON.stringify(payload), env: { ...process.env, CCM_DATA_DIR: data } })
  beforeAll(async () => {
    data = await mkdtemp(path.join(os.tmpdir(), 'ccm-hooks-'))
  })
  afterAll(() => rm(data, { recursive: true, force: true }))

  it('tracks compaction and denials without keeping payload text', async () => {
    run({ session_id: SID, hook_event_name: 'PreCompact', trigger: 'manual', custom_instructions: 'secret plan', transcript_path: 'C:/t.jsonl' })
    run({ session_id: SID, hook_event_name: 'PermissionDenied', tool_name: 'Bash', tool_input: { command: 'rm -rf x' }, reason: 'secret reason' })
    const text = await readFile(path.join(data, 'hooks', `${SID}.json`), 'utf8')
    expect(text).not.toMatch(/secret|rm -rf|t\.jsonl/)
    let [rec] = await new HookReader(path.join(data, 'hooks')).read(Date.now())
    expect(rec).toMatchObject({ compactTrigger: 'manual', deniedCount: 1, deniedTools: ['Bash'] })
    expect(rec!.compactingSince).toBeTruthy()
    run({ session_id: SID, hook_event_name: 'PostCompact', trigger: 'manual', compact_summary: 'secret summary' })
    ;[rec] = await new HookReader(path.join(data, 'hooks')).read(Date.now())
    expect(rec!.compactingSince).toBeUndefined()
    expect(rec!.deniedCount).toBe(1)
    run({ session_id: 'not-a-uuid', hook_event_name: 'PreCompact' })
    expect(await new HookReader(path.join(data, 'hooks')).read(Date.now())).toHaveLength(1)
  })

  it('logs permission dialogs with the suggested rule and a safe command prefix only', async () => {
    const cwd = path.join(data, 'proj')
    const suggest = (rules: object[]) => [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules }]
    run({ session_id: SID, hook_event_name: 'PermissionRequest', cwd, tool_name: 'Bash', tool_input: { command: 'npm run test -- --token=s3cret' }, permission_suggestions: suggest([{ toolName: 'Bash', ruleContent: 'npm run test:*' }]) })
    run({ session_id: SID, hook_event_name: 'PermissionRequest', cwd, tool_name: 'Bash', tool_input: { command: 'cat /etc/secret.txt' }, permission_suggestions: suggest([{ toolName: 'Bash', ruleContent: 'cat "/etc/secret.txt"' }]) })
    run({ session_id: SID, hook_event_name: 'PermissionRequest', cwd, tool_name: 'WebFetch', tool_input: { url: 'https://pub.dev/x?key=secret' }, permission_suggestions: suggest([{ toolName: 'WebFetch', ruleContent: 'domain:pub.dev' }]) })
    run({ session_id: 'nope', hook_event_name: 'PermissionRequest', cwd, tool_name: 'Edit' })
    const text = await readFile(path.join(data, 'hooks', 'permission-asks.jsonl'), 'utf8')
    const rows = text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(JSON.stringify(rows.map(({ cwd: _, ...r }) => r))).not.toMatch(/secret|s3cret|\/etc/)
    expect(rows.map((r) => [r.tool, r.rules, r.prefix])).toEqual([
      ['Bash', ['Bash(npm run test:*)'], 'npm run'],
      ['Bash', [], 'cat'],
      ['WebFetch', ['WebFetch(domain:pub.dev)'], undefined],
    ])
    expect(rows[0]!.cwd).toBe(cwd)
    expect(await new HookReader(path.join(data, 'hooks')).read(Date.now())).toHaveLength(1)
  })
})
