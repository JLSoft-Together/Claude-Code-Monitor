import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { FwpEntry } from '@ccm/shared'
import { hostContext, hostSource, readPackage, writeHost } from '../src/flutterPreview/host'

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

describe('hostSource wrappers', () => {
  const src = hostSource('demo_app', entries, { riverpod: 'package:flutter_riverpod/flutter_riverpod.dart', l10n: { uri: 'package:demo_app/l10n/app_localizations.dart', className: 'AppLocalizations' } })

  it('imports both with a prefix, ahead of the project files', () => {
    expect(src).toContain("import 'package:flutter_riverpod/flutter_riverpod.dart' as ccm_riverpod;\nimport 'package:demo_app/l10n/app_localizations.dart' as ccm_l10n;\nimport 'package:demo_app/a.dart' as p0;")
  })

  it('gives each preview its own ProviderScope keyed by id', () => {
    expect(src).toContain('return ccm_riverpod.ProviderScope(key: ValueKey<String?>(id), child: build());')
  })

  it('puts the delegates and locales on MaterialApp', () => {
    expect(src).toContain('debugShowCheckedModeBanner: false,\n      localizationsDelegates: ccm_l10n.AppLocalizations.localizationsDelegates,\n      supportedLocales: ccm_l10n.AppLocalizations.supportedLocales,\n      home:')
  })

  it('matches the snapshot', () => {
    expect(src).toMatchSnapshot()
  })
})

describe('hostContext', () => {
  const PUB = 'name: demo_app\ndependencies:\n  flutter:\n    sdk: flutter\n'
  const fake = (files: Record<string, string>) => {
    const norm = (f: string) => f.replace(/\\/g, '/')
    return {
      exists: async (f: string) => norm(f) in files,
      readText: async (f: string) => files[norm(f)] ?? null,
    }
  }
  const ctx = (pubspec: string, files: Record<string, string>) => {
    const f = fake(files)
    return hostContext('/p', pubspec, f.exists, f.readText)
  }

  it('Riverpod from dependencies, hooks_riverpod first; not dev_dependencies or plain riverpod', async () => {
    expect(await ctx(`${PUB}  flutter_riverpod: ^3.4.3\n`, {})).toEqual({ riverpod: 'package:flutter_riverpod/flutter_riverpod.dart' })
    expect(await ctx(`${PUB}  flutter_riverpod: 2.6.1\n  hooks_riverpod: 2.6.1\n`, {})).toEqual({ riverpod: 'package:hooks_riverpod/hooks_riverpod.dart' })
    expect(await ctx(`${PUB}  riverpod: ^2.0.0\ndev_dependencies:\n  flutter_riverpod: any\n`, {})).toEqual({})
  })

  it('gen-l10n output in lib/ when the file exists, from output-dir / output-class', async () => {
    const yaml = 'arb-dir: lib/languages\noutput-localization-file: app_localizations.dart\noutput-class: Tr\noutput-dir: lib/languages\n#synthetic-package: false\n'
    expect(await ctx(PUB, { '/p/l10n.yaml': yaml, '/p/lib/languages/app_localizations.dart': '' })).toEqual({ l10n: { uri: 'package:demo_app/languages/app_localizations.dart', className: 'Tr' } })
    expect(await ctx(PUB, { '/p/l10n.yaml': yaml })).toEqual({})
  })

  it('defaults of flutter gen-l10n; flutter: generate: true needs no file yet', async () => {
    expect(await ctx(`${PUB}flutter:\n  generate: true\n`, { '/p/l10n.yaml': 'template-arb-file: app_en.arb\n' })).toEqual({ l10n: { uri: 'package:demo_app/l10n/app_localizations.dart', className: 'AppLocalizations' } })
  })

  it('old synthetic package, and output outside lib/ or odd names are ignored', async () => {
    expect(await ctx(PUB, { '/p/l10n.yaml': 'synthetic-package: true\n', '/p/.dart_tool/flutter_gen/gen_l10n/app_localizations.dart': '' })).toEqual({ l10n: { uri: 'package:flutter_gen/gen_l10n/app_localizations.dart', className: 'AppLocalizations' } })
    expect(await ctx(PUB, { '/p/l10n.yaml': 'output-dir: gen\n', '/p/gen/app_localizations.dart': '' })).toEqual({})
    expect(await ctx(PUB, { '/p/l10n.yaml': "output-class: 'Bad Name'\n", '/p/lib/l10n/app_localizations.dart': '' })).toEqual({})
    expect(await ctx(PUB, { '/p/l10n.yaml': 'output-dir: lib/../x\n' })).toEqual({})
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
