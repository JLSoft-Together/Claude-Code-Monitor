import { describe, expect, it } from 'vitest'
import { changedLines, findMatches, grammarFor, renderLine } from './codeView'
import { renderMarkdown } from './markdown'
import { dirOf, parseAddress } from './preview'

describe('renderMarkdown', () => {
  it('escapes raw HTML and drops unsafe links', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://a.dev?q=1&r=2) <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<a href="https://a.dev?q=1&amp;r=2">y</a>')
  })

  it('renders headings, lists, code, quotes, tables', () => {
    const html = renderMarkdown(['# Title', '', '- a **b**', '- [x] done', '  - nested', '', '```ts', 'const a = "<b>"', '```', '> quote', '', '| A | B |', '|---|--:|', '| 1 | 2 |'].join('\n'))
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<li>a <strong>b</strong></li>')
    expect(html).toContain('☑')
    expect(html).toContain('<ul><li>nested</li></ul>')
    expect(html).toContain('<pre><code>const a = &quot;&lt;b&gt;&quot;</code></pre>')
    expect(html).toContain('<blockquote><p>quote</p></blockquote>')
    expect(html).toContain('<th style="text-align:right">B</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('keeps inline code literal', () => {
    expect(renderMarkdown('use `**not bold** <x>`')).toBe('<p>use <code>**not bold** &lt;x&gt;</code></p>')
  })
})

describe('code view', () => {
  it('maps extensions to grammars', () => {
    expect(grammarFor('ts')).toBe('typescript')
    expect(grammarFor(undefined, 'C:\\a\\App.VUE')).toBe('vue')
    expect(grammarFor('xyz')).toBeNull()
  })

  it('finds matches case-insensitively', () => {
    expect(findMatches(['Foo foo', 'bar'], 'FOO')).toEqual([
      { line: 0, start: 0, end: 3 },
      { line: 0, start: 4, end: 7 },
    ])
    expect(findMatches(['a'], '')).toEqual([])
  })

  it('renders tokens with marks across token boundaries and escapes', () => {
    const html = renderLine([{ content: 'ab', color: 'var(--shiki-token-keyword)' }, { content: '<c', color: '#fff' }], [{ start: 1, end: 3, current: true }])
    expect(html).toBe('<span style="color:var(--shiki-token-keyword)">a</span><mark class="ccm-find ccm-find-current"><span style="color:var(--shiki-token-keyword)">b</span>&lt;</mark>c')
  })

  it('diffs lines by prefix and suffix', () => {
    expect(changedLines(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([1])
    expect(changedLines(['a', 'c'], ['a', 'x', 'y', 'c'])).toEqual([1, 2])
    expect(changedLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([1])
    expect(changedLines(['a'], ['a'])).toEqual([])
  })
})

describe('address parsing', () => {
  it('accepts urls, bare hosts and paths', () => {
    expect(parseAddress('localhost:5173')).toEqual({ kind: 'url', url: 'http://localhost:5173/' })
    expect(parseAddress('https://x.dev/a')).toEqual({ kind: 'url', url: 'https://x.dev/a' })
    expect(parseAddress('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' })
    expect(parseAddress('C:\\site\\index.html')).toEqual({ kind: 'path', path: 'C:\\site\\index.html' })
    expect(parseAddress('file:///C:/a%20b/i.html')).toEqual({ kind: 'path', path: 'C:/a b/i.html' })
    expect(parseAddress('hello world')).toBeNull()
  })

  it('takes the folder of a path', () => {
    expect(dirOf('C:\\a\\b.html')).toBe('C:\\a')
    expect(dirOf('C:\\b.html')).toBe('C:\\')
    expect(dirOf('/x/y.html')).toBe('/x')
  })
})
