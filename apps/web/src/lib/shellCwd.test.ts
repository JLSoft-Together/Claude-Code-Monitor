import { describe, expect, it } from 'vitest'
import { parseOsc7, parseOsc9 } from './shellCwd'

describe('parseOsc7', () => {
  it('reads host-qualified and empty-host file URLs', () => {
    expect(parseOsc7('file://mac.local/Users/me/My%20App')).toBe('/Users/me/My App')
    expect(parseOsc7('file:///home/me/app')).toBe('/home/me/app')
    expect(parseOsc7('file://box/Users/me/Application Support/ccm')).toBe('/Users/me/Application Support/ccm')
  })

  it('maps a Windows drive URL and keeps a raw % that is not an escape', () => {
    expect(parseOsc7('file:///C:/work/app')).toBe('C:/work/app')
    expect(parseOsc7('file://h/tmp/100%')).toBe('/tmp/100%')
  })

  it('rejects anything that is not an absolute file URL', () => {
    expect(parseOsc7('http://evil/x')).toBeNull()
    expect(parseOsc7('file://host')).toBeNull()
    expect(parseOsc7('relative/path')).toBeNull()
    expect(parseOsc7('file://h/a%00b')).toBeNull()
  })
})

describe('parseOsc9', () => {
  it('reads Windows Terminal 9;9 with and without quotes', () => {
    expect(parseOsc9('9;"C:\\Users\\me\\My App"')).toBe('C:\\Users\\me\\My App')
    expect(parseOsc9('9;D:\\work')).toBe('D:\\work')
  })

  it('ignores notifications and other ConEmu 9;n codes', () => {
    expect(parseOsc9('Build finished')).toBeNull()
    expect(parseOsc9('4;1;50')).toBeNull()
    expect(parseOsc9('9;"relative"')).toBeNull()
    expect(parseOsc9('9;"C:\\a\nb"')).toBeNull()
  })
})
