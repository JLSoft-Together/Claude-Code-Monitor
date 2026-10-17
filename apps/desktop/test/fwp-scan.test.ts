import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { classHit, hasRequiredParams, isWebOnly, maskDart, scanDartClasses, scanDartSource, scanProject, widgetNames } from '../src/flutterPreview/scan'

const SRC = `import 'package:flutter/widget_previews.dart';
import 'package:flutter/widget_previews.dart' as wp;

// @Preview() in a comment
const note = '@Preview() in a string \${'@Preview()'}';

@Preview(name: 'Primary button')
Widget primaryButton() => const Text('hi');

@Preview(
  name: "Card",
  group: 'cards',
)
@Deprecated('x')
Widget card() {
  return const Card();
}

@wp.Preview()
List<Widget> prefixed() => [];

@Preview()
Widget _hidden() => const SizedBox();

@Preview()
Widget needsArg(String title) => Text(title);

@Preview()
Widget namedOptional({String title = 'a'}) => Text(title);

@Preview()
Widget namedRequired({required String title}) => Text(title);

class Gallery {
  @Preview(name: 'Static one')
  static Widget one() => const Text('1');

  @Preview()
  Widget instance() => const Text('2');
}

class MyCard extends StatelessWidget {
  @Preview()
  const MyCard({super.key, this.title = '{'});

  @Preview(name: 'Small')
  const MyCard.small({super.key}) : title = 's';

  @Preview()
  MyCard.titled(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context) => Text(title);
}

class _Private extends StatelessWidget {
  @Preview()
  const _Private();
  @override
  Widget build(BuildContext context) => const SizedBox();
}

@Preview()
class NotAFunction {}
`

describe('maskDart', () => {
  it('blanks comments and strings, keeps offsets and newlines', () => {
    const src = "a // c\nb = 'x{y}' /* z */ + r'\\q' + \"\"\"m\n{\"\"\";"
    const masked = maskDart(src)
    expect(masked.length).toBe(src.length)
    expect(masked.split('\n').length).toBe(src.split('\n').length)
    expect(masked).not.toMatch(/[{}]/)
    expect(masked).not.toContain('c')
  })

  it('handles nested interpolation with quotes and braces', () => {
    const masked = maskDart("x = '\${m['k']} }'; y {}")
    expect(masked).toContain('y {}')
    expect(masked.match(/[{}]/g)).toEqual(['{', '}'])
  })
})

describe('hasRequiredParams', () => {
  it.each([
    ['', false],
    ['{super.key}', false],
    ['{String a = "x", int? b}', false],
    ['[int a = 1]', false],
    ['String a', true],
    ['this.title, {super.key}', true],
    ['{required this.x}', true],
    ['{@Deprecated("") required int x}', true],
  ])('%s → %s', (params, required) => expect(hasRequiredParams(params)).toBe(required))
})

describe('scanDartSource', () => {
  const hits = scanDartSource(SRC)
  const bySymbol = new Map(hits.map((h) => [h.symbol, h]))

  it('finds top-level functions with labels and calls', () => {
    expect(bySymbol.get('primaryButton')).toMatchObject({ label: 'Primary button', call: 'primaryButton()', line: 7 })
    expect(bySymbol.get('card')).toMatchObject({ label: 'Card', call: 'card()' })
    expect(bySymbol.get('prefixed')).toMatchObject({ label: 'prefixed', call: '', skipped: 'type' })
    expect(bySymbol.get('namedOptional')?.skipped).toBeUndefined()
  })

  it('ignores annotations in comments and strings', () => {
    expect(hits[0]?.symbol).toBe('primaryButton')
  })

  it('finds static methods and constructors', () => {
    expect(bySymbol.get('Gallery.one')).toMatchObject({ call: 'Gallery.one()', label: 'Static one' })
    expect(bySymbol.get('MyCard')).toMatchObject({ call: 'MyCard()' })
    expect(bySymbol.get('MyCard.small')).toMatchObject({ call: 'MyCard.small()', label: 'Small' })
  })

  it('skips private, required params and unknown shapes with a reason', () => {
    expect(bySymbol.get('_hidden')?.skipped).toBe('private')
    expect(bySymbol.get('_Private')?.skipped).toBe('private')
    expect(bySymbol.get('needsArg')?.skipped).toBe('params')
    expect(bySymbol.get('namedRequired')?.skipped).toBe('params')
    expect(bySymbol.get('MyCard.titled')?.skipped).toBe('params')
    expect(bySymbol.get('Gallery.instance')?.skipped).toBe('unknown')
    expect(hits.filter((h) => h.skipped === 'unknown' && h.symbol.startsWith('?'))).toHaveLength(1)
  })
})

describe('scanDartSource return types and names', () => {
  const src = `@Preview()
Widget Function() fnType() => () => const SizedBox();

@Preview()
WidgetBuilder builder() => (c) => const SizedBox();

@Preview()
Widget? nullable() => null;

@Preview()
external Widget ext();

@Preview()
StatelessWidget stateless() => const Text('a');

@Preview()
m.MyCard prefixedClass() => const m.MyCard();

@Preview()
omitted() => const Text('a');

@Preview(wrapper: wrap(name: 'inner'))
Widget nestedName() => const Text('a');

@Preview(theme: t(), name: 'Outer')
Widget outerName() => const Text('a');

class G {
  @Preview()
  static List<Widget> many() => [];

  @Preview()
  static Builder builderWidget() => Builder(builder: (_) => const SizedBox());
}
`
  const by = new Map(scanDartSource(src).map((h) => [h.symbol, h]))

  it('skips non-widget return types with reason type, never names a Function type', () => {
    expect(by.has('Function')).toBe(false)
    expect(by.get('fnType')?.skipped).toBe('type')
    expect(by.get('builder')?.skipped).toBe('type')
    expect(by.get('nullable')?.skipped).toBe('type')
    expect(by.get('G.many')?.skipped).toBe('type')
  })

  it('accepts Widget, widget classes, prefixed classes and omitted types', () => {
    for (const s of ['ext', 'stateless', 'prefixedClass', 'omitted', 'G.builderWidget']) expect(by.get(s)?.skipped, s).toBeUndefined()
  })

  it('reads name: only at the top level of the annotation', () => {
    expect(by.get('nestedName')?.label).toBe('nestedName')
    expect(by.get('outerName')?.label).toBe('Outer')
  })

  it('keeps the first of stacked annotations on one symbol', () => {
    const hits = scanDartSource("@Preview(name: 'A')\n@Preview(name: 'B')\nWidget twice() => const Text('a');\n")
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ symbol: 'twice', label: 'A' })
  })

  it('marks every preview in a part file as part', () => {
    const hits = scanDartSource("// lib\npart of 'main.dart';\n\n@Preview()\nWidget a() => const Text('a');\n")
    expect(hits).toEqual([expect.objectContaining({ symbol: 'a', call: '', skipped: 'part' })])
    expect(scanDartSource("part 'a.g.dart';\n@Preview()\nWidget a() => const Text('a');\n")[0]?.skipped).toBeUndefined()
  })
})

describe('scanProject', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fwp-scan-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('walks lib only, skips generated files and hidden / build folders, sorted by file', async () => {
    mkdirSync(path.join(root, 'lib', 'w'), { recursive: true })
    mkdirSync(path.join(root, 'lib', '.hidden'), { recursive: true })
    mkdirSync(path.join(root, 'test'), { recursive: true })
    const one = "@Preview()\nWidget a() => const Text('a');\n"
    writeFileSync(path.join(root, 'lib', 'w', 'b.dart'), one)
    writeFileSync(path.join(root, 'lib', 'a.dart'), one + "@Preview()\nWidget b() => const Text('b');\n")
    writeFileSync(path.join(root, 'lib', 'a.g.dart'), one)
    writeFileSync(path.join(root, 'lib', '.hidden', 'c.dart'), one)
    writeFileSync(path.join(root, 'test', 'd.dart'), one)
    const entries = await scanProject(root)
    expect(entries.map((e) => e.id)).toEqual(['lib/a.dart#a', 'lib/a.dart#b', 'lib/w/b.dart#a'])
    expect(entries[1]).toMatchObject({ file: 'lib/a.dart', line: 3, call: 'b()' })
  })
})

describe('scanDartClasses + classHit', () => {
  const src = `import 'package:flutter/material.dart' as m;

class Plain extends StatelessWidget {
  const Plain({super.key});
  static Plain make() => const Plain();
  @override
  Widget build(BuildContext context) => const Text('{');
}

class NoCtor extends m.StatelessWidget {
  @override
  Widget build(BuildContext context) => const SizedBox();
}

class Titled extends StatefulWidget {
  const Titled(this.title, {super.key});
  const Titled.empty({super.key}) : title = '';
  final String title;
  @override
  State<Titled> createState() => _TitledState();
}

class _TitledState extends State<Titled> {
  @override
  Widget build(BuildContext context) => Text(widget.title);
}

class Needs extends StatelessWidget {
  const Needs({super.key, required this.count});
  factory Needs.one() => const Needs(count: 1);
  final int count;
  @override
  Widget build(BuildContext context) => Text('\$count');
}

class OnlyRequired extends StatelessWidget {
  const OnlyRequired({super.key, required this.count});
  final int count;
  @override
  Widget build(BuildContext context) => const SizedBox();
}

class Hidden extends StatelessWidget {
  const Hidden._();
  @override
  Widget build(BuildContext context) => const SizedBox();
}

abstract class BasePage extends StatelessWidget {
  const BasePage({super.key});
}

class Home extends BasePage {
  const Home({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

class Box<T extends List<int>> extends StatelessWidget {
  const Box({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox();
}

class _Row extends StatelessWidget {
  const _Row();
  @override
  Widget build(BuildContext context) => const SizedBox();
}

mixin class Mixed {}

class Model {
  Model(this.a);
  final int a;
}
`
  const decls = scanDartClasses(src)
  const by = new Map(decls.map((d) => [d.name, d]))
  const widgets = widgetNames(decls)
  const hit = (name: string) => classHit(by.get(name)!, { part: false, web: false }, [])

  it('reads names, lines, extends without prefix or type args, constructors', () => {
    expect(by.get('Plain')).toMatchObject({ line: 3, superName: 'StatelessWidget', abstract: false, ctors: [{ name: 'Plain', required: false }] })
    expect(by.get('NoCtor')).toMatchObject({ superName: 'StatelessWidget', ctors: [] })
    expect(by.get('Titled')?.ctors).toEqual([{ name: 'Titled', required: true }, { name: 'Titled.empty', required: false }])
    expect(by.get('Needs')?.ctors.map((c) => c.name)).toEqual(['Needs', 'Needs.one'])
    expect(by.get('Box')?.superName).toBe('StatelessWidget')
    expect(by.get('BasePage')?.abstract).toBe(true)
    expect(by.get('Mixed')?.superName).toBeNull()
  })

  it('follows the extends chain through project classes, never State or plain classes', () => {
    for (const n of ['Plain', 'NoCtor', 'Titled', 'Home', 'BasePage', 'Box', '_Row']) expect(widgets.has(n), n).toBe(true)
    for (const n of ['_TitledState', 'Model', 'Mixed']) expect(widgets.has(n), n).toBe(false)
  })

  it('picks the unnamed constructor, then a named one without required parameters', () => {
    expect(hit('Plain')).toMatchObject({ symbol: 'Plain', label: 'Plain', call: 'Plain()', kind: 'class', line: 3 })
    expect(hit('NoCtor')?.call).toBe('NoCtor()')
    expect(hit('Titled')?.call).toBe('Titled.empty()')
    expect(hit('Needs')?.call).toBe('Needs.one()')
    expect(hit('Box')?.call).toBe('Box()')
    expect(hit('Home')?.call).toBe('Home()')
  })

  it('skips with a reason: required params, private ctor only, private class; drops abstract', () => {
    expect(hit('OnlyRequired')).toMatchObject({ call: '', skipped: 'params' })
    expect(hit('Hidden')).toMatchObject({ call: '', skipped: 'ctor' })
    expect(hit('_Row')).toMatchObject({ call: '', skipped: 'private' })
    expect(hit('BasePage')).toBeNull()
  })

  it('part and web-only files, and classes an @Preview already lists', () => {
    const plain = by.get('Plain')!
    expect(classHit(plain, { part: true, web: false }, [])?.skipped).toBe('part')
    expect(classHit(plain, { part: false, web: true }, [])?.skipped).toBe('web')
    expect(classHit(plain, { part: false, web: false }, [{ line: 4, symbol: 'Plain.small', label: 'x', call: 'Plain.small()' }])).toBeNull()
  })

  it('detects web-only imports, not conditional ones or comments', () => {
    expect(isWebOnly("import 'dart:html';")).toBe(true)
    expect(isWebOnly('import "package:web/web.dart" as web;')).toBe(true)
    expect(isWebOnly("import 'stub.dart' if (dart.library.html) 'web.dart';")).toBe(false)
    expect(isWebOnly("// import 'dart:html';\nimport 'dart:io';")).toBe(false)
  })
})

describe('scanProject widget classes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fwp-classes-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('lists classes across files by extends chain, merged with @Preview by line, deduped', async () => {
    mkdirSync(path.join(root, 'lib', 'base'), { recursive: true })
    writeFileSync(path.join(root, 'lib', 'base', 'page.dart'), 'abstract class AppPage extends StatelessWidget {\n  const AppPage({super.key});\n}\n')
    writeFileSync(
      path.join(root, 'lib', 'home.dart'),
      [
        "import 'base/page.dart';",
        'class Home extends AppPage {',
        '  const Home({super.key});',
        '  @override',
        '  Widget build(BuildContext context) => const SizedBox();',
        '}',
        "@Preview(name: 'Home dark')",
        'Widget homeDark() => const Home();',
        'class Card2 extends StatelessWidget {',
        '  @Preview()',
        '  const Card2({super.key});',
        '  @override',
        '  Widget build(BuildContext context) => const SizedBox();',
        '}',
        '',
      ].join('\n'),
    )
    const entries = await scanProject(root)
    expect(entries.map((e) => e.id)).toEqual(['lib/home.dart#Home', 'lib/home.dart#homeDark', 'lib/home.dart#Card2'])
    expect(entries[0]).toMatchObject({ kind: 'class', call: 'Home()', line: 2 })
    expect(entries[2]?.kind).toBeUndefined()
  })

  it('rescans a file whose content changed', async () => {
    const file = path.join(root, 'lib', 'home.dart')
    writeFileSync(file, 'class Other extends StatelessWidget {\n  const Other({super.key});\n}\n')
    const entries = await scanProject(root)
    expect(entries.map((e) => e.id)).toEqual(['lib/home.dart#Other'])
  })
})
