import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cacheControlFor, contentSecurityPolicy } from '../src/server'

describe('cacheControlFor', () => {
  const root = path.resolve('dist-root')
  const at = (...p: string[]) => cacheControlFor(root, path.join(root, ...p))
  it('makes only Vite-hashed bundles immutable', () => {
    expect(at('assets', 'index-BMrYeALK.js')).toBe('public, max-age=31536000, immutable')
    expect(at('assets', 'WorkspaceView-C61tNg0-.css')).toBe('public, max-age=31536000, immutable')
    expect(at('assets', 'be-vietnam-pro-latin-400-normal-PpnXBOrz.woff2')).toBe('public, max-age=31536000, immutable')
  })
  it('revalidates public files, also those copied under assets/', () => {
    expect(at('assets', 'art', 'painting-abstract.png')).toBe('no-cache')
    expect(at('assets', 'brand', 'logo-12345678.png')).toBe('no-cache')
    expect(at('assets', 'manifest.json')).toBe('no-cache')
    expect(at('assets', 'og-image.png')).toBe('no-cache')
    expect(at('sw.js')).toBe('no-cache')
    expect(at('icon-192.png')).toBe('no-cache')
  })
})

describe('contentSecurityPolicy', () => {
  it('allows only the bundle and the hashed inline script', () => {
    const inline = "document.documentElement.classList.add('dark')"
    const csp = contentSecurityPolicy(`<head><script>${inline}</script><script type="module" src="/assets/i.js"></script></head>`)
    const hash = createHash('sha256').update(inline).digest('base64')
    expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`)
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:*")
    expect(csp).toContain("object-src 'none'")
  })

  it('lets workspace browser panes frame web pages and show loopback images, nothing more', () => {
    const csp = contentSecurityPolicy('<script src="/a.js"></script>')
    expect(csp).toContain('frame-src http://127.0.0.1:* http://localhost:* https: http:')
    expect(csp).toContain("img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toMatch(/(script|connect)-src[^;]*https:/)
  })

  it('hashes a CRLF inline script the way the browser parses it (LF)', () => {
    const csp = contentSecurityPolicy('<script>\r\n  a()\r\n</script>')
    const hash = createHash('sha256').update('\n  a()\n').digest('base64')
    expect(csp).toContain(`'sha256-${hash}'`)
  })

  it('has no hash without inline scripts', () => {
    expect(contentSecurityPolicy('<script src="/a.js"></script>')).toContain("script-src 'self';")
  })
})
