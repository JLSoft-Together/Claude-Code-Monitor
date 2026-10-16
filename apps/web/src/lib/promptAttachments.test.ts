import { describe, expect, it } from 'vitest'
import { cursorToken, eraseKeys, fileMention, findPromptRange, needsLeadSpace, promptCaret, scanPrompt, shellPath } from './promptAttachments'

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

  it('a placeholder the agent wrapped at the space between its words still counts (narrow pane)', () => {
    const rows = screen(['❯ @package.json [Image #1]', '  @CLAUDE.md [Image #2] [Image', '  #3]'])
    expect(scanPrompt(rows)).toMatchObject({ images: [1, 2, 3], files: ['@package.json', '@CLAUDE.md'] })
  })

  it('multi-line prompts', () => {
    const rows = screen(['❯ first line [Image #3]', '  second @src/x.ts'])
    expect(scanPrompt(rows)).toMatchObject({ images: [3], files: ['@src/x.ts'] })
    expect(findPromptRange(rows)).toEqual([5, 7])
  })

  it('erases the last token in place, like before', () => {
    const rows = screen(['❯ [Image #1] [Image #2]'])
    const y = 5
    // Observed: one backspace drops a whole [Image #N].
    expect(eraseKeys(rows, { x: 23, y }, '[Image #2]')).toEqual({ left: 0, back: 1, right: 0 })
    // Cursor one past the space typed after a mention (translateToString trims it; the cursor cell says it is there).
    expect(eraseKeys(screen(['❯ @package.json']), { x: 16, y }, '@package.json')).toEqual({ left: 0, back: '@package.json'.length + 1, right: 0 })
  })

  it('erases an earlier token on the cursor row by moving the cursor (item 2 of 3)', () => {
    const rows = screen(['❯ [Image #1] [Image #2] [Image #3]'])
    // "[Image #2] " ends at 24; the cursor is at 35 (after "[Image #3] ").
    expect(eraseKeys(rows, { x: 35, y: 5 }, '[Image #2]')).toEqual({ left: 11, back: 2, right: 11 })
    expect(eraseKeys(screen(['❯ @a.ts @b.ts look']), { x: 18, y: 5 }, '@a.ts')).toEqual({ left: 10, back: 6, right: 10 })
  })

  it('refuses tokens off the cursor row, after the cursor, partial matches and wide characters', () => {
    const two = screen(['❯ [Image #1] first line', '  second line'])
    expect(eraseKeys(two, { x: 13, y: 6 }, '[Image #1]')).toBeNull()
    expect(eraseKeys(screen(['❯ [Image #1] [Image #2]']), { x: 10, y: 5 }, '[Image #2]')).toBeNull()
    expect(eraseKeys(screen(['❯ @src/a.tsx ']), { x: 14, y: 5 }, '@src/a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ 画像 @a.ts ']), { x: 14, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ [Image #2]']), { x: 13, y: 4 }, '[Image #2]')).toBeNull()
  })

  it('refuses a cursor inside a mention (the match is only its front half)', () => {
    expect(eraseKeys(screen(['❯ @foobar.ts']), { x: 6, y: 5 }, '@foo')).toBeNull()
    expect(eraseKeys(screen(['❯ @foo bar']), { x: 6, y: 5 }, '@foo')).toEqual({ left: 0, back: 4, right: 0 })
    expect(eraseKeys(screen(['❯ @foo']), { x: 6, y: 5 }, '@foo')).toEqual({ left: 0, back: 4, right: 0 })
  })

  it('refuses rows whose cell widths it cannot be sure of; Latin / Vietnamese stay erasable', () => {
    expect(eraseKeys(screen(['❯ ok 🙂 @a.ts']), { x: 13, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ ok ✅ @a.ts']), { x: 12, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ a​b @a.ts']), { x: 12, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ é @a.ts']), { x: 11, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ xem ảnh @a.ts']), { x: 16, y: 5 }, '@a.ts')).toEqual({ left: 0, back: 6, right: 0 })
  })

  it('finds the caret: the one inverse cell in the box, else the cursor inside the box', () => {
    const rows = screen(['❯ @a.ts look'])
    // Ink leaves the real cursor under the box (status rows); the caret is the inverse cell.
    expect(promptCaret(rows, { x: 0, y: 8 }, [{ x: 8, y: 5 }])).toEqual({ x: 8, y: 5 })
    expect(promptCaret(rows, { x: 8, y: 5 }, [{ x: 8, y: 5 }, { x: 3, y: 8 }])).toEqual({ x: 8, y: 5 })
    expect(promptCaret(rows, { x: 13, y: 5 }, [])).toEqual({ x: 13, y: 5 })
    expect(promptCaret(rows, { x: 0, y: 8 }, [])).toBeNull()
    expect(promptCaret(rows, { x: 4, y: 5 }, [{ x: 8, y: 5 }])).toBeNull()
    expect(promptCaret(rows, { x: 0, y: 8 }, [{ x: 2, y: 5 }, { x: 8, y: 5 }])).toBeNull()
    expect(promptCaret(['no box'], { x: 0, y: 0 }, [])).toBeNull()
  })

  it('names the mention being typed or erased at the cursor', () => {
    expect(cursorToken(screen(['❯ look @package.js']), { x: 18, y: 5 })).toBe('@package.js')
    expect(cursorToken(screen(['❯ look @package.js']), { x: 19, y: 5 })).toBeNull()
    expect(cursorToken(screen(['❯ [Image #1]']), { x: 12, y: 5 })).toBeNull()
  })

  it('a mention with :line:col (Run pane "Send to agent") is a place, not an attachment', () => {
    expect(scanPrompt(screen(['❯ @lib/main.dart:12:5 Undefined name x']))).toMatchObject({ found: true, files: [] })
    expect(scanPrompt(screen(['❯ @"lib/a b.dart":12:5 Undefined name x']))).toMatchObject({ found: true, files: [] })
    expect(scanPrompt(screen(['❯ @src/a.ts @lib/main.dart:3 @"d/a b.md"']))).toMatchObject({ files: ['@src/a.ts', '@"d/a b.md"'] })
  })

  it('mentions relative to the pane folder, quoted with spaces', () => {
    expect(fileMention('D:\\proj\\src\\a.ts', 'D:\\proj', true)).toBe('@src/a.ts')
    expect(fileMention('d:/PROJ/docs/a b.md', 'D:\\proj', true)).toBe('@"docs/a b.md"')
    expect(fileMention('/home/u/x.ts', '/srv', false)).toBe('@/home/u/x.ts')
    expect(shellPath('C:\\a b\\c.txt', true)).toBe("'C:\\a b\\c.txt'")
    expect(shellPath("/tmp/it's", false)).toBe("'/tmp/it'\\''s'")
  })

  it('asks for a space before a mention glued to text', () => {
    const rows = ['❯ [Image #1]', '❯ a ', '']
    expect(needsLeadSpace(rows, { x: 12, y: 0 })).toBe(true)
    expect(needsLeadSpace(rows, { x: 4, y: 1 })).toBe(false)
    expect(needsLeadSpace(rows, { x: 0, y: 2 })).toBe(false)
    expect(needsLeadSpace(rows, { x: 5, y: 2 })).toBe(false)
  })
})
