import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { FwpEntry } from '@ccm/shared'
import { hostSource, readPackage, writeHost } from '../src/flutterPreview/host'

const entries: FwpEntry[] = [
  { id: 'lib/a.dart#a', file: 'lib/a.dart', line: 1, symbol: 'a', label: 'a', call: 'a()' },
  { id: 'lib/a.dart#Card.small', file: 'lib/a.dart', line: 5, symbol: 'Card.small', label: 'Small', call: 'Card.small()' },
  { id: "lib/w/b$'.dart#B", file: "lib/w/b$'.dart", line: 2, symbol: 'B', label: 'B', call: 'B()' },
  { id: 'lib/a.dart#_x', file: 'lib/a.dart', line: 9, symbol: '_x', label: '_x', call: '', skipped: 'private' },
]

describe('readPackage', () => {
  it('needs a valid name; flutter from the sdk dependency', () => {
    expect(readPackage('name: demo_app\ndependencies:\n  flutter:\n    sdk: flutter\n')).toEqual({ name: 'demo_app', flutter: true })
    expect(readPackage('name: pure_dart\n')).toEqual({ name: 'pure_dart', flutter: false })
    expect(readPackage('name: Bad-Name\n')).toBeNull()
  })
})

describe('hostSource', () => {
  const src = hostSource('demo_app', entries)

  it('imports each file once with an alias and escapes Dart strings', () => {
    expect(src).toContain("import 'package:demo_app/a.dart' as p0;")
    expect(src).toContain("import 'package:demo_app/w/b\\$\\'.dart' as p1;")
    expect(src.match(/as p\d;/g)).toHaveLength(2)
  })

  it('registry is a getter, skipped entries left out', () => {
    expect(src).toContain('Map<String, Widget Function()> get _previews =>')
    expect(src).toContain("'lib/a.dart#a': () => p0.a(),")
    expect(src).toContain("'lib/a.dart#Card.small': () => p0.Card.small(),")
    expect(src).toContain("() => p1.B(),")
    expect(src).not.toContain('_x')
    expect(src).toContain("registerExtension('ext.ccm.show'")
    expect(src).toContain('debugShowCheckedModeBanner: false')
    expect(src).toContain('Select a widget in Orrery')
  })

  it('turns widget errors into an error card and a marker line', () => {
    expect(src).toContain('ErrorWidget.builder = (details) => _ErrorCard(details.exceptionAsString());')
    expect(src).toContain("print('ccm.error ' + jsonEncode(")
    expect(src).toContain('message.substring(0, 400)')
    expect(src).toContain('void reassemble()')
  })

  it('is stable for the same input', () => {
    expect(hostSource('demo_app', entries)).toBe(src)
    expect(hostSource('demo_app', [])).toMatchSnapshot()
  })

  it('matches the snapshot with entries', () => {
    expect(src).toMatchSnapshot()
  })
})

describe('writeHost', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fwp-host-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('writes under .dart_tool/ccm_preview only when the content changed', async () => {
    const first = await writeHost(root, 'a')
    expect(first.changed).toBe(true)
    expect(first.file).toBe(path.join(root, '.dart_tool', 'ccm_preview', 'main.dart'))
    const mtime = statSync(first.file).mtimeMs
    expect((await writeHost(root, 'a')).changed).toBe(false)
    expect(statSync(first.file).mtimeMs).toBe(mtime)
    expect((await writeHost(root, 'b')).changed).toBe(true)
    expect(readFileSync(first.file, 'utf8')).toBe('b')
  })
})
