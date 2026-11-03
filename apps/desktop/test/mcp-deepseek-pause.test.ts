import { describe, expect, it } from 'vitest'
import { handleMcp, type ToolHost } from '../src/pty/mcp'
import { MCP_TOOLS, mcpToolsFor } from '../src/pty/mcpTools'
import { presetEnabled } from '../src/pty/presets'

const host = {} as ToolHost

async function list(deepseek: boolean) {
  const tools = mcpToolsFor(deepseek)
  const init = (await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, host, '1', tools)).json as { result: { instructions: string } }
  const res = (await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, host, '1', tools)).json as { result: { tools: { name: string; inputSchema: { properties: { agent?: { enum: string[] } } } }[] } }
  return { instructions: init.result.instructions, tools: res.result.tools }
}

describe('DeepSeek MCP pause', () => {
  it('drops hand_back and the deepseek agent while paused', async () => {
    const { instructions, tools } = await list(false)
    expect(tools.map((t) => t.name)).not.toContain('hand_back')
    expect(tools[0]!.name).toBe('open_session')
    expect(tools[0]!.inputSchema.properties.agent!.enum).toEqual(['claude', 'codex', 'shell'])
    expect(instructions).not.toMatch(/DeepSeek|hand_back/)
    expect(tools).toHaveLength(MCP_TOOLS.length - 1)
  })

  it('offers both again when turned on', async () => {
    const { instructions, tools } = await list(true)
    expect(tools.map((t) => t.name)).toContain('hand_back')
    expect(tools[0]!.inputSchema.properties.agent!.enum).toContain('deepseek')
    expect(instructions).toMatch(/hand_back/)
  })
})

describe('DeepSeek feature flag (CCM_DEEPSEEK_FEATURE)', () => {
  it('refuses only the deepseek preset while off', () => {
    expect(presetEnabled('deepseek', false)).toBe(false)
    expect(presetEnabled('deepseek', true)).toBe(true)
    for (const p of ['claude', 'codex', 'shell'] as const) expect(presetEnabled(p, false)).toBe(true)
  })
})
