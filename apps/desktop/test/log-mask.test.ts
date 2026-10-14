import { describe, expect, it } from 'vitest'
import { maskLog } from '../src/log-mask'

describe('maskLog', () => {
  it('masks known token shapes and long opaque runs', () => {
    const text = [
      'key sk-ant-api03-abcDEF123_xyz',
      'gh ghp_abcdefghijklmnopqrstuvwxyz0123',
      'pat github_pat_11ABCDEFG0123456789_abcdefghij',
      'aws AKIAABCDEFGHIJKLMNOP',
      'slack xoxb-1234567890-abcdefgh',
      `hex ${'a1'.repeat(32)}`,
      'b64 ab12CD34/ef56GH78+ij90KL12.mn34OP56-qr',
    ].join('\n')
    const out = maskLog(text, '', 'linux')
    expect(out).not.toMatch(/sk-ant|ghp_|github_pat_|AKIA|xoxb-|a1a1|ab12CD34/)
    expect(out.match(/\[masked\]/g)).toHaveLength(7)
  })

  it('keeps paths and ids readable, replaces home', () => {
    expect(maskLog('/Users/Me/Library/Application Support/ccm/usage-index.json', '/Users/Me', 'darwin')).toBe('~/Library/Application Support/ccm/usage-index.json')
    expect(maskLog('/opt/homebrew/Cellar/node/24.1.0/libexec/lib/node_modules', '', 'darwin')).toBe('/opt/homebrew/Cellar/node/24.1.0/libexec/lib/node_modules')
    expect(maskLog('session 0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', '', 'linux')).toBe('session 0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0')
  })

  it('replaces the Windows home case-insensitively in every separator form', () => {
    const home = 'C:\\Users\\Dauph'
    expect(maskLog('c:\\users\\dauph\\x C:/Users/Dauph/y {"p":"C:\\\\Users\\\\Dauph\\\\z"}', home, 'win32')).toBe('~\\x ~/y {"p":"~\\\\z"}')
    expect(maskLog('/users/me/x', '/Users/Me', 'darwin')).toBe('/users/me/x')
  })
})
