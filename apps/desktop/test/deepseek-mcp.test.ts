import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mergeDeepseekMcp, userDeepseekMcpFiles, writeDeepseekMcpConfig } from '../src/pty/deepseekMcp'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-dsmcp-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const orrery = (port: number) => ({ url: `http://127.0.0.1:${port}/mcp`, bearer_token_env_var: 'ORRERY_TOKEN' })

describe('DeepSeek MCP config', () => {
  it('adds orrery with a literal url to the user servers and overrides their orrery', () => {
    expect(JSON.parse(mergeDeepseekMcp(null, 4321))).toEqual({ servers: { orrery: orrery(4321) } })
    expect(JSON.parse(mergeDeepseekMcp('{not json', 1))).toEqual({ servers: { orrery: orrery(1) } })
    expect(JSON.parse(mergeDeepseekMcp('[1]', 1))).toEqual({ servers: { orrery: orrery(1) } })
    const user = { servers: { rea: { command: 'rea' }, orrery: { url: 'http://evil/mcp' } }, mcpServers: { old: { command: 'x' }, rea: { command: 'stale' } }, timeouts: { connect: 5 } }
    expect(JSON.parse(mergeDeepseekMcp(JSON.stringify(user), 9))).toEqual({ timeouts: { connect: 5 }, servers: { old: { command: 'x' }, rea: { command: 'rea' }, orrery: orrery(9) } })
    expect(JSON.parse(mergeDeepseekMcp(JSON.stringify({ servers: 'nope' }), 9))).toEqual({ servers: { orrery: orrery(9) } })
  })

  it('reads an inherited DEEPSEEK_MCP_CONFIG first, never our own file', () => {
    const home = path.join(tmp, 'home')
    const own = path.join(tmp, 'data', 'orrery-mcp-deepseek.json')
    const codewhale = path.join(home, '.codewhale', 'mcp.json')
    const legacy = path.join(home, '.deepseek', 'mcp.json')
    expect(userDeepseekMcpFiles({}, home, own)).toEqual([codewhale, legacy])
    expect(userDeepseekMcpFiles({ DEEPSEEK_MCP_CONFIG: own }, home, own)).toEqual([codewhale, legacy])
    expect(userDeepseekMcpFiles({ DEEPSEEK_MCP_CONFIG: 'rel.json' }, home, own)).toEqual([codewhale, legacy])
    const mine = path.join(tmp, 'mine.json')
    expect(userDeepseekMcpFiles({ DEEPSEEK_MCP_CONFIG: mine }, home, own)).toEqual([mine, codewhale, legacy])
  })

  it('writes the merge of the latest user file, falling back to ~/.deepseek', () => {
    const home = path.join(tmp, 'home2')
    const file = path.join(tmp, 'data2', 'orrery-mcp-deepseek.json')
    mkdirSync(path.join(home, '.deepseek'), { recursive: true })
    writeFileSync(path.join(home, '.deepseek', 'mcp.json'), JSON.stringify({ mcpServers: { legacy: { command: 'l' } } }))
    expect(writeDeepseekMcpConfig(file, 5000, {}, home)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ servers: { legacy: { command: 'l' }, orrery: orrery(5000) } })
    mkdirSync(path.join(home, '.codewhale'), { recursive: true })
    writeFileSync(path.join(home, '.codewhale', 'mcp.json'), JSON.stringify({ servers: { fresh: { url: 'http://x' } } }))
    expect(writeDeepseekMcpConfig(file, 5000, {}, home)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ servers: { fresh: { url: 'http://x' }, orrery: orrery(5000) } })
    expect(writeDeepseekMcpConfig('relative.json', 5000, {}, home)).toBe(false)
    expect(writeDeepseekMcpConfig(file, 0, {}, home)).toBe(false)
  })
})
