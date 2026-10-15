import { describe, expect, it } from 'vitest'
import { asElementPick, consoleLevel, formatConsoleBlock, formatElementBlock, pickerScript, pushConsole, sanitize, type ConsoleEntry } from './agentHandoff'
import { fileStepKey, scrollSideways, sidewaysScroller } from './changesView'
import { DevServerDetector, devUrlLabel, normalizeDevUrl, stripAnsi } from './devServer'
import { firstChangedLine, hunkPatch, parseUnifiedDiff } from './diff'
import { fuzzyFilter, fuzzyScore, highlightRuns, parseQuickOpen } from './fuzzy'

const SAMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,4 @@ function top()',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  '@@ -10,3 +10,4 @@',
  ' ten\r',
  '+ten and a half\r',
  ' eleven\r',
  ' twelve',
  '\\ No newline at end of file',
  'diff --git a/new.md b/new.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.md',
  '@@ -0,0 +1 @@',
  '+hello',
  'diff --git a/old.txt b/old.txt',
  'deleted file mode 100644',
  '--- a/old.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  'diff --git a/from.ts b/to.ts',
  'similarity index 100%',
  'rename from from.ts',
  'rename to to.ts',
  '',
].join('\n')

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(SAMPLE)

  it('splits files with kinds and counts', () => {
    expect(files.map((f) => [f.path, f.isNew, f.isDeleted, f.binary, f.isRename])).toEqual([
      ['src/a.ts', false, false, false, false],
      ['new.md', true, false, false, false],
      ['old.txt', false, true, false, false],
      ['img.png', false, false, true, false],
      ['to.ts', false, false, false, true],
    ])
    expect(files[0]).toMatchObject({ added: 2, removed: 1 })
    expect(files[4]!.oldPath).toBe('from.ts')
  })

  it('numbers lines on both sides and keeps CR in raw only', () => {
    const [h1, h2] = files[0]!.hunks
    expect(h1!.section).toBe('function top()')
    expect(h1!.lines.map((l) => [l.type, l.old, l.new])).toEqual([
      ['ctx', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['ctx', 3, 3],
      ['ctx', 4, 4],
    ])
    expect(h2!.lines[1]).toMatchObject({ type: 'add', text: 'ten and a half', raw: '+ten and a half\r', new: 11 })
    expect(h2!.lines.at(-1)).toMatchObject({ type: 'note', text: 'No newline at end of file' })
  })

  it('builds a one-hunk patch from raw lines', () => {
    const f = files[0]!
    expect(hunkPatch(f, f.hunks[1]!)).toBe(
      ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -10,3 +10,4 @@', ' ten\r', '+ten and a half\r', ' eleven\r', ' twelve', '\\ No newline at end of file', ''].join(
        '\n',
      ),
    )
  })

  it('finds the first changed line', () => {
    expect(firstChangedLine(files[0]!)).toBe(2)
    expect(firstChangedLine(files[2]!)).toBe(1)
  })
})

describe('fuzzy', () => {
  const files = ['src/components/workspace/ChangesPane.vue', 'src/lib/changes.ts', 'docs/CHANGELOG.md', 'apps/web/src/main.ts', 'src/lib/fuzzy.ts']

  it('matches subsequences and prefers file-name boundaries', () => {
    expect(fuzzyScore('xyz', 'src/a.ts')).toBeNull()
    const hits = fuzzyFilter(files, 'chp')
    expect(hits[0]!.item).toBe('src/components/workspace/ChangesPane.vue')
    expect(fuzzyFilter(files, 'fuzzy')[0]!.item).toBe('src/lib/fuzzy.ts')
    expect(fuzzyFilter(files, 'main')[0]!.item).toBe('apps/web/src/main.ts')
    const pos = fuzzyScore('cp', 'ChangesPane.vue')!.positions
    expect(pos).toEqual([0, 7])
  })

  it('puts recent files first and boosts them in results', () => {
    expect(fuzzyFilter(files, '', { recent: ['src/lib/fuzzy.ts', 'gone.ts'] }).map((h) => h.item).slice(0, 2)).toEqual(['src/lib/fuzzy.ts', 'src/components/workspace/ChangesPane.vue'])
    expect(fuzzyFilter(files, 'changes', { recent: ['src/lib/changes.ts'] })[0]!.item).toBe('src/lib/changes.ts')
    expect(fuzzyFilter(files, '', { limit: 2 })).toHaveLength(2)
  })

  it('parses :line suffix and highlight runs', () => {
    expect(parseQuickOpen('app.ts:42')).toEqual({ query: 'app.ts', line: 42 })
    expect(parseQuickOpen('app.ts:42:7')).toEqual({ query: 'app.ts', line: 42 })
    expect(parseQuickOpen('app.ts')).toEqual({ query: 'app.ts' })
    expect(highlightRuns('abc', [0, 2])).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: false },
      { text: 'c', hit: true },
    ])
  })
})

describe('devServer', () => {
  it('strips ANSI and normalizes hosts', () => {
    expect(stripAnsi('\x1b[32m➜\x1b[39m  \x1b]8;;http://x\x07Local\x1b]8;;\x07')).toBe('➜  Local')
    expect(normalizeDevUrl('http://0.0.0.0:3000/.')).toBe('http://localhost:3000/')
    expect(normalizeDevUrl('http://localhost/')).toBeNull()
    expect(devUrlLabel('http://localhost:5173/app')).toBe('localhost:5173')
  })

  it('detects URLs near markers across chunks, once per origin', () => {
    const d = new DevServerDetector()
    expect(d.feed('  VITE v7 ready in 300 ms\n\n  \x1b[32m➜\x1b[0m  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/')).toEqual([])
    expect(d.feed('\x1b[39m\n  ➜  Network: http://192.168.1.2:5173/\n')).toEqual(['http://localhost:5173/'])
    expect(d.feed('ready again http://localhost:5173/other\n')).toEqual([])
    expect(d.feed('some\nother\nlog\njust text http://localhost:9999 mentioned\n')).toEqual([])
    expect(d.feed('Server running\r\n  http://127.0.0.1:8080\r\n')).toEqual(['http://127.0.0.1:8080/'])
    expect(d.urls).toEqual(['http://localhost:5173/', 'http://127.0.0.1:8080/'])
    d.forget('http://127.0.0.1:8080/')
    expect(d.feed('listening on http://127.0.0.1:8080\n')).toEqual(['http://127.0.0.1:8080/'])
  })
})

describe('agentHandoff', () => {
  it('sanitizes and truncates', () => {
    expect(sanitize('a\x1b[31m b\n\tc', 50)).toBe('a b c')
    expect(sanitize('key sk-abcdefghijklmnop and ?token=xyz&x=1', 100)).toBe('key [redacted] and ?token=[redacted]&x=1')
    expect(sanitize('x'.repeat(10), 5)).toBe('xxxx…')
  })

  it('collects console errors, folding repeats, capped', () => {
    expect(consoleLevel(3)).toBe('error')
    expect(consoleLevel('warning')).toBe('warning')
    expect(consoleLevel(1)).toBeNull()
    let list: ConsoleEntry[] = []
    const e = { level: 'error' as const, message: 'Uncaught TypeError: x', source: 'http://localhost:5173/src/main.ts', line: 3, at: 1 }
    list = pushConsole(list, e)
    list = pushConsole(list, e)
    expect(list).toHaveLength(1)
    for (let i = 0; i < 60; i++) list = pushConsole(list, { ...e, message: `m${i}` })
    expect(list).toHaveLength(50)
    const block = formatConsoleBlock([e, { level: 'warning', message: 'w', at: 2 }], 'http://localhost:5173/page?q=1')
    expect(block).toBe('Browser console on http://localhost:5173/page — 1 error, 1 warning:\n- [error] Uncaught TypeError: x (/src/main.ts:3)\n- [warning] w')
  })

  it('validates and formats an element pick', () => {
    expect(asElementPick({ selector: 'a', tag: '<script>' }, 'http://x')).toBeNull()
    const pick = asElementPick(
      { selector: 'main > button.primary', tag: 'BUTTON', classes: ['primary', 7], text: '  Save\n changes ', outerHTML: '<button class="primary">Save</button>' },
      'http://localhost:3000/a',
    )!
    expect(formatElementBlock(pick)).toBe(
      'Element on http://localhost:3000/a:\nselector: main > button.primary\ntag: button.primary\ntext: "Save changes"\nhtml: <button class="primary">Save</button>',
    )
  })

  it('embeds only a safe colour in the picker script', () => {
    expect(pickerScript('#0071e3')).toContain('"#0071e3"')
    expect(pickerScript("red';alert(1)//")).not.toContain('alert(1)')
  })
})

describe('fileStepKey', () => {
  const k = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
  it('maps plain ← / → to previous / next file', () => {
    expect(fileStepKey(k('ArrowRight'))).toBe(1)
    expect(fileStepKey(k('ArrowLeft'))).toBe(-1)
  })
  it('ignores modified arrows (Alt+← is pane focus) and other keys', () => {
    expect(fileStepKey(k('ArrowRight', { altKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowLeft', { shiftKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowLeft', { ctrlKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowRight', { metaKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowDown'))).toBe(0)
  })
})

describe('sidewaysScroller', () => {
  const widths = (el: HTMLElement, scroll: number, client: number) => {
    Object.defineProperty(el, 'scrollWidth', { value: scroll, configurable: true })
    Object.defineProperty(el, 'clientWidth', { value: client, configurable: true })
  }
  it('finds a split side only while it overflows', () => {
    const side = document.createElement('div')
    side.dataset.side = 'left'
    const line = document.createElement('span')
    side.append(line)
    document.body.append(side)
    widths(side, 100, 100)
    expect(sidewaysScroller(line)).toBe(null)
    widths(side, 300, 100)
    expect(sidewaysScroller(line)).toBe(side)
    const key = (k: string, shiftKey: boolean) => {
      const e = new KeyboardEvent('keydown', { key: k, shiftKey })
      Object.defineProperty(e, 'target', { value: line })
      return e
    }
    expect(scrollSideways(key('ArrowRight', false))).toBe(false)
    expect(scrollSideways(key('ArrowRight', true))).toBe(true)
    expect(side.scrollLeft).toBeGreaterThanOrEqual(0)
    side.remove()
  })
  it('treats an overflowing overflow-x:auto ancestor (inline diff) the same', () => {
    const box = document.createElement('div')
    box.style.overflowX = 'auto'
    const inner = document.createElement('div')
    box.append(inner)
    document.body.append(box)
    widths(box, 300, 100)
    expect(sidewaysScroller(inner)).toBe(box)
    box.style.overflowX = 'hidden'
    expect(sidewaysScroller(inner)).toBe(null)
    box.remove()
  })
})
