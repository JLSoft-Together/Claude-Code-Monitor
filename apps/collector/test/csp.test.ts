import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../src/server'

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

  it('has no hash without inline scripts', () => {
    expect(contentSecurityPolicy('<script src="/a.js"></script>')).toContain("script-src 'self';")
  })
})
