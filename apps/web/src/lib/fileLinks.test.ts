import { describe, expect, it } from 'vitest'
import { breaksInsideUrl, fileUrlToPath, findLinks, inLinks, isLoopbackUrl, joinPath, joinWrappedLinks, oscLinkUri, resolveLink, type RowInfo } from './fileLinks'

const targets = (text: string) => findLinks(text).map((l) => l.target)

describe('findLinks', () => {
  it('finds absolute Windows and POSIX paths with line/col', () => {
    expect(targets('error at C:\\work\\app\\src\\main.ts:42:7 here')).toEqual([{ kind: 'file', path: 'C:\\work\\app\\src\\main.ts', line: 42, col: 7 }])
    expect(targets('see /home/me/site/index.html.')).toEqual([{ kind: 'file', path: '/home/me/site/index.html', line: undefined, col: undefined }])
    expect(targets('D:/x/y.vue:10')).toEqual([{ kind: 'file', path: 'D:/x/y.vue', line: 10, col: undefined }])
  })

  it('finds relative paths with an extension, and tsc style positions', () => {
    expect(targets('Wrote src/components/App.vue')).toEqual([{ kind: 'file', path: 'src/components/App.vue', line: undefined, col: undefined }])
    expect(targets('./dist/index.html')).toEqual([{ kind: 'file', path: './dist/index.html', line: undefined, col: undefined }])
    expect(targets('src/a.ts(12,5): error TS2322')).toEqual([{ kind: 'file', path: 'src/a.ts', line: 12, col: 5 }])
    expect(targets('Updated package.json and README.md')).toHaveLength(2)
  })

  it('leaves prose, versions and bare domains alone', () => {
    expect(findLinks('e.g. version 1.2.3 on example.com')).toEqual([])
    expect(findLinks('Agent.model is node_modules/foo')).toEqual([])
    expect(findLinks('ratio 3/4 and a/b')).toEqual([])
  })

  it('finds remote URLs, trimming punctuation', () => {
    expect(targets('via https://github.com/a/b.js.')).toEqual([{ kind: 'url', url: 'https://github.com/a/b.js' }])
    expect(targets('(see https://www.figma.com/oauth?client_id=x&state=y)')).toEqual([{ kind: 'url', url: 'https://www.figma.com/oauth?client_id=x&state=y' }])
    expect(targets('│ http://example.com/a │')).toEqual([{ kind: 'url', url: 'http://example.com/a' }])
  })

  it('finds loopback URLs and file URLs, trimming punctuation', () => {
    expect(targets('Local: http://localhost:5173/, network off')).toEqual([{ kind: 'url', url: 'http://localhost:5173/' }])
    expect(targets('(open http://127.0.0.1:8080/app?x=1)')).toEqual([{ kind: 'url', url: 'http://127.0.0.1:8080/app?x=1' }])
    expect(targets('file:///C:/work/a%20b/index.html')).toEqual([{ kind: 'file', path: 'C:/work/a b/index.html' }])
  })

  it('reports exact offsets including the line suffix', () => {
    const text = '  src/x.ts:9 ok'
    const [link] = findLinks(text)
    expect(text.slice(link!.start, link!.end)).toBe('src/x.ts:9')
  })
})

describe('path helpers', () => {
  it('joins relative paths onto cwd', () => {
    expect(joinPath('C:\\work\\app', './src/../dist/index.html')).toBe('C:\\work\\app\\dist\\index.html')
    expect(joinPath('/home/me/app', 'src/a.ts')).toBe('/home/me/app/src/a.ts')
  })

  it('resolves only relative file links against cwd', () => {
    const [rel] = findLinks('src/a.ts:3')
    expect(resolveLink(rel!, '/p')).toEqual({ kind: 'file', path: '/p/src/a.ts', line: 3, col: undefined })
    expect(resolveLink(rel!, undefined)).toBeNull()
    const [url] = findLinks('http://localhost:3000')
    expect(resolveLink(url!, undefined)).toEqual({ kind: 'url', url: 'http://localhost:3000' })
  })

  it('converts file URLs', () => {
    expect(fileUrlToPath('file:///home/me/a.html')).toBe('/home/me/a.html')
    expect(fileUrlToPath('https://x')).toBeNull()
  })
})

describe('terminal hyperlinks', () => {
  it('reads the uri of an OSC 8 sequence', () => {
    expect(oscLinkUri(';https://figma.com/oauth?x=1')).toBe('https://figma.com/oauth?x=1')
    expect(oscLinkUri('id=a1;https://a.b/c;d')).toBe('https://a.b/c;d')
    expect(oscLinkUri(';')).toBeNull()
    expect(oscLinkUri('')).toBeNull()
  })

  it('tells loopback URLs from remote ones', () => {
    expect(isLoopbackUrl('http://localhost:5173/')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:8080/x')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:3000')).toBe(true)
    expect(isLoopbackUrl('https://www.figma.com/oauth')).toBe(false)
    expect(isLoopbackUrl('https://localhost.evil.com/')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
  })
})

describe('joinWrappedLinks', () => {
  const uri = 'https://www.figma.com/oauth?client_id=abc123&redirect_uri=http%3A%2F%2Flocalhost%3A5555%2Fcallback&state=xyz'

  it('joins a link the program hard-wrapped over several rows', () => {
    const sel = `${uri.slice(0, 40)}\n  ${uri.slice(40, 80)}\r\n  ${uri.slice(80)}`
    expect(joinWrappedLinks(sel, inLinks([uri]))).toBe(uri)
  })

  it('joins only inside the link when prose is selected around it', () => {
    const sel = `copy this URL manually\n  ${uri.slice(0, 50)}\n  ${uri.slice(50)}\nPress Enter`
    expect(joinWrappedLinks(sel, inLinks([uri]))).toBe(`copy this URL manually\n  ${uri}\nPress Enter`)
  })

  it('drops box borders around a wrapped link', () => {
    const sel = `│ ${uri.slice(0, 50)} │\n│ ${uri.slice(50)}        │`
    expect(joinWrappedLinks(sel, inLinks([uri]))).toBe(`│ ${uri}        │`)
  })

  it('asks the predicate with the break index', () => {
    const seen: number[] = []
    expect(joinWrappedLinks('a\nb\r\nc', (_b, _a, i) => (seen.push(i), i === 1))).toBe('a\nbc')
    expect(seen).toEqual([0, 1])
  })

  it('keeps line breaks between separate links and in plain text', () => {
    const a = 'https://a.dev/one'
    const b = 'https://a.dev/two'
    expect(joinWrappedLinks(`${a}\n${b}`, inLinks([a, b]))).toBe(`${a}\n${b}`)
    expect(joinWrappedLinks(`${uri.slice(0, 40)}\n${uri.slice(40)}`, inLinks([]))).toBe(`${uri.slice(0, 40)}\n${uri.slice(40)}`)
    expect(joinWrappedLinks('one\ntwo', inLinks([uri]))).toBe('one\ntwo')
  })
})

describe('breaksInsideUrl (plain text a CLI wrapped itself)', () => {
  const COLS = 40
  /** Rows as printed; a leading `~` marks a row xterm soft-wrapped onto the one above. */
  const screen = (...lines: string[]) => {
    const rows: RowInfo[] = lines.map((l) => {
      const wrapped = l.startsWith('~')
      const text = wrapped ? l.slice(1) : l
      return { text, end: text.replace(/[\s\u2500-\u257f]+$/, '').length, wrapped }
    })
    return (y: number): RowInfo | undefined => rows[y]
  }
  const url = 'https://example.com/oauth?client_id=abcdefghij&state=0123456789'

  it('joins a URL cut at the right edge, with indent', () => {
    const rows = screen(`  ${url.slice(0, 38)}`, `  ${url.slice(38)}`, 'Press Enter')
    expect(breaksInsideUrl(rows, 0, COLS)).toBe(true)
    expect(breaksInsideUrl(rows, 1, COLS)).toBe(false)
  })

  it('follows a URL over several full rows and inside a box', () => {
    const long = `${url}&more=${'x'.repeat(60)}`
    const tail = long.slice(105)
    const rows = screen(`│ ${long.slice(0, 35)} │`, `│ ${long.slice(35, 70)} │`, `│ ${long.slice(70, 105)} │`, `│ ${tail}${' '.repeat(35 - tail.length)} │`)
    expect([0, 1, 2].map((y) => breaksInsideUrl(rows, y, COLS))).toEqual([true, true, true])
  })

  it('follows a URL that xterm soft-wrapped before the hard break', () => {
    const long = `${url}&tail=${'y'.repeat(30)}`
    const rows = screen(long.slice(0, 40), `~${long.slice(40, 78)}`, `  ${long.slice(78)}`)
    expect(breaksInsideUrl(rows, 1, COLS)).toBe(true)
  })

  it('does not join short rows, prose, or a second URL', () => {
    expect(breaksInsideUrl(screen(`  ${url.slice(0, 20)}`, `  ${url.slice(20)}`), 0, COLS)).toBe(false)
    expect(breaksInsideUrl(screen('this sentence is long enough to reach the', 'edge of the row'), 0, COLS)).toBe(false)
    expect(breaksInsideUrl(screen(`  ${url.slice(0, 38)}`, '  https://other.dev/'), 0, COLS)).toBe(false)
    expect(breaksInsideUrl(screen(`  ${url.slice(0, 38)}`, ''), 0, COLS)).toBe(false)
  })

  it('needs the URL to start somewhere above', () => {
    expect(breaksInsideUrl(screen('x'.repeat(39), 'y'.repeat(10)), 0, COLS)).toBe(false)
  })
})
