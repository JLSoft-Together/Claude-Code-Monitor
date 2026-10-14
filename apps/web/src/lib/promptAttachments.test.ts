import { describe, expect, it } from 'vitest'
import { eraseCount, fileMention, findPromptRange, scanPrompt, shellPath } from './promptAttachments'

// Bottom of a Claude Code 2.1.299 screen (110 cols), captured with node-pty + @xterm/headless (docs §11p).
const RULE = '─'.repeat(110)
const screen = (prompt: string[]) => [
  '❯ earlier message with [Image #1] and @old.ts',
  '',
  '↓ 4 more',
  '',
  RULE,
  ...prompt,
  RULE,
  '  Opus 5.5 (1M context) | $0.00',
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
]

describe('prompt attachments', () => {
  it('reads tokens from the input box only', () => {
    const scan = scanPrompt(screen(['❯ [Image #1] [Image #2] look at @package.json and @"docs/a b.md"']))
    expect(scan.found).toBe(true)
    expect(scan.images).toEqual([1, 2])
    expect(scan.files).toEqual(['@package.json', '@"docs/a b.md"'])
    expect(scan.text.startsWith('[Image #1]')).toBe(true)
  })

  it('placeholder / empty box carries nothing; no box → not found', () => {
    expect(scanPrompt(screen(['❯ Try "how does <filepath> work?"']))).toMatchObject({ found: true, images: [], files: [] })
    expect(scanPrompt(['PS C:\\> dir', 'foo']).found).toBe(false)
  })

  it('multi-line prompts', () => {
    const rows = screen(['❯ first line [Image #3]', '  second @src/x.ts'])
    expect(scanPrompt(rows)).toMatchObject({ images: [3], files: ['@src/x.ts'] })
    expect(findPromptRange(rows)).toEqual([5, 7])
  })

  it('erase only when the token ends the prompt at the cursor', () => {
    const rows = screen(['❯ [Image #1] [Image #2]'])
    const y = 5
    // Observed: one backspace drops a whole [Image #N].
    expect(eraseCount(rows, { x: 23, y }, '[Image #2]')).toBe(1)
    expect(eraseCount(rows, { x: 23, y }, '[Image #1]')).toBeNull()
    expect(eraseCount(rows, { x: 10, y }, '[Image #2]')).toBeNull()
    expect(eraseCount(rows, { x: 23, y: 4 }, '[Image #2]')).toBeNull()
    // Cursor one past the space typed after a mention.
    expect(eraseCount(screen(['❯ @package.json']), { x: 16, y }, '@package.json')).toBe('@package.json'.length + 1)
  })

  it('mentions relative to the pane folder, quoted with spaces', () => {
    expect(fileMention('D:\\proj\\src\\a.ts', 'D:\\proj', true)).toBe('@src/a.ts')
    expect(fileMention('d:/PROJ/docs/a b.md', 'D:\\proj', true)).toBe('@"docs/a b.md"')
    expect(fileMention('/home/u/x.ts', '/srv', false)).toBe('@/home/u/x.ts')
    expect(shellPath('C:\\a b\\c.txt', true)).toBe("'C:\\a b\\c.txt'")
    expect(shellPath("/tmp/it's", false)).toBe("'/tmp/it'\\''s'")
  })
})
