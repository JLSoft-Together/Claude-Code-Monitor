import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { clampZoom, nextZoom, parseLook, readAppearance, writeAppearance, zoomPercent } from '../src/appearance'
import { loadingPage, errorPage, onAccent, wordmark } from '../src/pages'
import { stringsFor } from '../src/strings'
import { BACKUP_SUFFIX, bridgeCommand, claudeSettingsFile, readStatusLine, writeStatusLine } from '../src/statusline'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-v27-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const LOOK = { canvas: '#282a36', surface: '#21222c', ink: '#f8f8f2', muted: '#bfbfbf', faint: '#8a8a8a', accent: '#bd93f9', dark: true }
const decode = (url: string): string => decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))

describe('appearance', () => {
  it('accepts only #RRGGBB colours and a boolean mode', () => {
    expect(parseLook(LOOK)).toEqual(LOOK)
    expect(parseLook({ ...LOOK, accent: 'red' })).toBeNull()
    expect(parseLook({ ...LOOK, ink: '#fff' })).toBeNull()
    expect(parseLook({ ...LOOK, dark: 'yes' })).toBeNull()
    expect(parseLook(null)).toBeNull()
  })

  it('zoom moves in half levels within -3…3 and reads as percent', () => {
    expect(nextZoom(0, 'in')).toBe(0.5)
    expect(nextZoom(3, 'in')).toBe(3)
    expect(nextZoom(-3, 'out')).toBe(-3)
    expect(nextZoom(2, 'reset')).toBe(0)
    expect(clampZoom('x')).toBe(0)
    expect(zoomPercent(0)).toBe(100)
    expect(zoomPercent(1)).toBe(120)
  })

  it('round-trips through the file and drops bad fields', () => {
    const file = path.join(tmp, 'appearance.json')
    writeAppearance(file, { background: '#282a36', look: LOOK, zoom: 1 })
    expect(readAppearance(file)).toEqual({ background: '#282a36', look: LOOK, zoom: 1 })
    writeFileSync(file, JSON.stringify({ background: 'javascript:', look: { canvas: 1 }, zoom: 99 }))
    expect(readAppearance(file)).toEqual({ zoom: 3 })
    expect(readAppearance(path.join(tmp, 'missing.json'))).toEqual({})
  })
})

describe('startup screen', () => {
  const t = stringsFor('en')

  it('splits the wordmark into one span per character with rising delays', () => {
    const html = wordmark('GolAIm')
    const spans = [...html.matchAll(/style="--i:(\d+)"/g)].map((m) => Number(m[1]))
    expect(spans).toEqual([...Array(6).keys()])
    expect(wordmark('<b>')).not.toContain('<b>')
    expect(html.match(/class="ai"/g)).toHaveLength(2)
  })

  it('uses the saved theme, else the OS colours, and respects reduced motion', () => {
    const themed = decode(loadingPage(t, LOOK, '2.4.0'))
    expect(themed).toContain('--canvas:#282a36')
    expect(themed).not.toContain('prefers-color-scheme')
    expect(themed).toContain('prefers-reduced-motion: reduce')
    expect(themed).toContain('aria-label="GolAIm"')
    expect(themed).toContain('v2.4.0')
    const os = decode(loadingPage(t, null))
    expect(os).toContain('prefers-color-scheme: dark')
    expect(os).not.toContain('class="ver"')
    expect(themed).not.toContain('class="static"')
    expect(decode(errorPage(t, 'x', [], LOOK))).toContain('<html class="static">')
  })

  it('picks readable text for the accent fill', () => {
    expect(onAccent('#0071e3')).toBe('#ffffff')
    expect(onAccent('#bd93f9')).toBe('#1d1d1f')
    expect(onAccent('#e6db74')).toBe('#1d1d1f')
  })

  it('escapes the error message and log', () => {
    const html = decode(errorPage(t, '<script>x</script>', ['<img>'], LOOK))
    expect(html).not.toContain('<script>x')
    expect(html).not.toContain('<img>')
    expect(html).toContain('--accent:#bd93f9')
  })
})

describe('status line bridge setup', () => {
  const BRIDGE = 'node "C:/Users/x/AppData/Local/ccm/bin/statusline-bridge.mjs"'

  it('finds settings.json under CLAUDE_CONFIG_DIR or ~/.claude', () => {
    expect(claudeSettingsFile({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe(path.join('/cfg', 'settings.json'))
    expect(claudeSettingsFile({}, '/home/u')).toBe(path.join('/home/u', '.claude', 'settings.json'))
  })

  it('writes the bridge into a missing file', () => {
    const file = path.join(tmp, 'none', 'settings.json')
    expect(readStatusLine(file).state).toBe('none')
    expect(writeStatusLine(file, readStatusLine(file), BRIDGE)).toBe('ok')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ statusLine: { type: 'command', command: BRIDGE } })
    expect(readStatusLine(file).state).toBe('ours')
    expect(writeStatusLine(file, readStatusLine(file), BRIDGE)).toBe('ours')
  })

  it('chains an existing status line, keeps other keys, and backs the file up', () => {
    const file = path.join(tmp, 'other.json')
    const before = { model: 'opus', statusLine: { type: 'command', command: 'bash -c "echo \'hi\'"', padding: 1 } }
    writeFileSync(file, JSON.stringify(before))
    const read = readStatusLine(file)
    expect(read.state).toBe('other')
    expect(writeStatusLine(file, read, BRIDGE)).toBe('ok')
    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(after.model).toBe('opus')
    expect(after.statusLine).toEqual({ type: 'command', padding: 1, command: bridgeCommand(BRIDGE, before.statusLine.command) })
    const b64 = after.statusLine.command.split('--chain-b64 ')[1]
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(before.statusLine.command)
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(JSON.parse(readFileSync(`${file}${BACKUP_SUFFIX}`, 'utf8'))).toEqual(before)
  })

  it('refuses a file it cannot parse and leaves it alone', () => {
    const file = path.join(tmp, 'broken.json')
    writeFileSync(file, '{ "model": "opus", // comment\n}')
    const read = readStatusLine(file)
    expect(read.state).toBe('unreadable')
    expect(writeStatusLine(file, read, BRIDGE)).toBe('unreadable')
    expect(readFileSync(file, 'utf8')).toContain('// comment')
  })
})
