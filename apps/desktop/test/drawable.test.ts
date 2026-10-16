import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { drawableFolderKind, drawableKind, xmlRootName } from '@ccm/shared'
import { cleanSwatches, drawableDevice, registerLayoutIpc } from '../src/layout/ipc'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-drawable-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const SHAPE = '<?xml version="1.0" encoding="utf-8"?>\n<!-- cta -->\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><gradient android:startColor="#f00" android:endColor="#00f"/></shape>'
const COLORS = '<selector xmlns:android="http://schemas.android.com/apk/res/android"><item android:state_pressed="true" android:color="#f00"/><item android:color="#0f0"/></selector>'
const STATES = '<selector xmlns:android="http://schemas.android.com/apk/res/android"><item android:state_pressed="true"><shape><solid android:color="#f00"/></shape></item></selector>'

describe('drawable detection', () => {
  it('judges res folders by path', () => {
    expect(drawableFolderKind('/p/res/drawable/a.xml')).toBe('drawable')
    expect(drawableFolderKind('C:\\p\\res\\drawable-night-v24\\a.xml')).toBe('drawable')
    expect(drawableFolderKind('/p/res/mipmap-anydpi-v26/ic_launcher.xml')).toBe('drawable')
    expect(drawableFolderKind('/p/res/color/text.xml')).toBe('color')
    expect(drawableFolderKind('/p/res/drawable/a.png')).toBeNull()
    expect(drawableFolderKind('/p/res/layout/a.xml')).toBeNull()
  })

  it('sniffs the root element of loose files past prolog and comments', () => {
    expect(xmlRootName(SHAPE)).toBe('shape')
    expect(xmlRootName('\uFEFF<!DOCTYPE x><vector/>')).toBe('vector')
    expect(xmlRootName('<!-- never closed')).toBeNull()
    expect(drawableKind('/repo/bg_native_ad_cta.xml', SHAPE)).toBe('drawable')
    expect(drawableKind('/repo/x.xml', '<ripple xmlns:android="a"/>')).toBe('drawable')
    expect(drawableKind('/repo/text.xml', COLORS)).toBe('color')
    expect(drawableKind('/repo/btn.xml', STATES)).toBe('drawable')
    expect(drawableKind('/repo/main.xml', '<LinearLayout/>')).toBeNull()
    expect(drawableKind('/repo/pom.xml', '<project/>')).toBeNull()
    expect(drawableKind('/repo/a.txt', SHAPE)).toBeNull()
  })

  it('never treats layouts or values as drawables, keeps the folder kind without a readable root', () => {
    expect(drawableKind('/p/res/layout/a.xml', SHAPE)).toBeNull()
    expect(drawableKind('/p/res/values/colors.xml', '<resources/>')).toBeNull()
    expect(drawableKind('/p/res/drawable/a.xml', null)).toBe('drawable')
    expect(drawableKind('/p/res/drawable/a.xml', '')).toBe('drawable')
    expect(drawableKind('/p/res/color/a.xml', SHAPE)).toBe('color')
  })

  it('reads only the first 4 KB of a loose file', () => {
    expect(drawableKind('/repo/late.xml', `${' '.repeat(5000)}<shape/>`)).toBeNull()
  })
})

describe('drawable params', () => {
  it('converts dp at a density to clamped pixels', () => {
    expect(drawableDevice({ width: 48, height: 48, density: 480 })).toEqual({ width: 144, height: 144, density: 480 })
    expect(drawableDevice({ width: 1, height: 2, density: 160 })).toEqual({ width: 16, height: 16, density: 160 })
    expect(drawableDevice({ width: 0, height: 48, density: 480 })).toBeNull()
    expect(drawableDevice({ width: 48, height: 48, density: 2000 })).toBeNull()
  })

  it('keeps only well-formed swatches', () => {
    expect(cleanSwatches([{ state: 'default', color: '#ff2196f3' }, { state: 'x', color: 'red' }, null])).toEqual([{ state: 'default', color: '#FF2196F3' }])
    expect(cleanSwatches(null)).toBeNull()
  })

  it('ccm:drawable-render refuses non-drawable files and passes states through', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipcMain = { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) }
    const loose = path.join(tmp, 'bg.xml')
    const layout = path.join(tmp, 'main.xml')
    mkdirSync(tmp, { recursive: true })
    writeFileSync(loose, SHAPE)
    writeFileSync(layout, '<LinearLayout/>')
    const renderDrawable = vi.fn(async () => ({ requestId: 'r1', png: null, width: 144, height: 144, swatches: null, diagnostics: [{ severity: 'warning', message: 'm' }], renderMs: 5 }))
    registerLayoutIpc({
      ipcMain: ipcMain as never,
      isAppFrame: () => true,
      resolveDir: async (p) => (typeof p === 'string' ? p : null),
      dataDir: path.join(tmp, 'data'),
      getJdk: () => null,
      confirm: async () => false,
      server: { urlFor: async () => null },
      daemonJar: __filename,
      spawn: () => {
        throw new Error('no spawn')
      },
      kill: () => undefined,
      bundle: { isReady: () => true, status: () => ({ state: 'ready', dir: '/x' }), dir: '/x', downloadBytes: 1, download: async () => ({ state: 'ready', dir: '/x' }) } as never,
      daemon: { renderDrawable, state: 'ready', stop: async () => undefined, killNow: () => undefined } as never,
    })
    const call = (req: unknown) => handlers.get('ccm:drawable-render')!({ sender: { id: 1 } }, req)
    const size = { width: 48, height: 48, density: 480 }
    expect(await call({ file: layout, ...size })).toEqual({ ok: false, code: 'not-drawable' })
    expect(await call({ file: loose, width: 0, height: 1, density: 480 })).toEqual({ ok: false, code: 'bad-params' })
    const res = await call({ file: loose, ...size, night: true, states: ['pressed', 'bogus', 'pressed'] })
    expect(res).toMatchObject({ ok: true, kind: 'drawable', pngUrl: null, frameworkOnly: true, diagnostics: [{ severity: 'warning', message: 'm' }] })
    expect(renderDrawable).toHaveBeenCalledWith(expect.objectContaining({ path: loose, night: true, states: ['pressed'], colorList: false, device: { width: 144, height: 144, density: 480 } }), `1:${loose}:drawable`)
  })
})
