import { describe, expect, it } from 'vitest'
import { fileUrlToPath, findLinks, joinPath, resolveLink } from './fileLinks'

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

  it('leaves prose, versions, domains and remote URLs alone', () => {
    expect(findLinks('e.g. version 1.2.3 on example.com via https://github.com/a/b.js')).toEqual([])
    expect(findLinks('Agent.model is node_modules/foo')).toEqual([])
    expect(findLinks('ratio 3/4 and a/b')).toEqual([])
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
