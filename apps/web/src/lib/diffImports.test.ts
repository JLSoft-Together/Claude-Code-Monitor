import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'
import { blockPatch, changeBlocks, splitModified, viewBlocks } from './diffBlocks'
import { hideImportChanges, importSyntax } from './diffImports'
import { splitModel, type SplitRow } from './splitDiff'

const parse = (path: string, ...lines: string[]) => parseUnifiedDiff([`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...lines, ''].join('\n'))[0]!

describe('hideImportChanges', () => {
  it('drops import-only blocks and keeps line numbers of the rest', () => {
    const f = parse('a.ts', '@@ -1,6 +1,6 @@', "-import a from 'a'", "+import b from 'b'", ' ', ' const x = 1', '-x()', '+y()', ' end')
    const { file, hidden } = hideImportChanges(f)
    expect(hidden).toBe(1)
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0]!.header).toBe('@@ -2,4 +2,4 @@')
    const blocks = changeBlocks(file)
    expect(blocks.map((b) => [b.type, b.line1, b.line2])).toEqual([['modified', 3, 4]])
    expect(file.hunks[0]!.lines.find((l) => l.text === 'y()')!.new).toBe(4)
  })

  it('treats a name added inside a multi-line import list as an import', () => {
    const f = parse('a.ts', '@@ -1,4 +1,5 @@', ' import {', '   a,', '+  b,', " } from 'x'", ' run()')
    expect(hideImportChanges(f).hidden).toBe(1)
  })

  it('keeps code that only looks like a list item outside an import', () => {
    const f = parse('a.ts', '@@ -1,3 +1,3 @@', ' function f() {', '-  return', '+  continue', ' }')
    expect(hideImportChanges(f).hidden).toBe(0)
  })

  it('knows Kotlin, Java, Dart and Python imports; other files and new files stay as they are', () => {
    expect(hideImportChanges(parse('A.kt', '@@ -1,2 +1,2 @@', '-import a.B', '+import a.C', ' fun x() {}')).hidden).toBe(1)
    expect(hideImportChanges(parse('A.java', '@@ -1,2 +1,2 @@', '-import a.B;', '+import static a.C.d;', ' class A {}')).hidden).toBe(1)
    expect(hideImportChanges(parse('a.dart', '@@ -1,2 +1,2 @@', "-import 'a.dart';", "+import 'b.dart' show B;", ' void main() {}')).hidden).toBe(1)
    expect(hideImportChanges(parse('a.py', '@@ -1,2 +1,2 @@', '-import os', '+from os import path', ' x = 1')).hidden).toBe(1)
    expect(importSyntax('a.rs')).toBeNull()
    const added = parseUnifiedDiff(['diff --git a/n.ts b/n.ts', 'new file mode 100644', '--- /dev/null', '+++ b/n.ts', '@@ -0,0 +1 @@', "+import a from 'a'", ''].join('\n'))[0]!
    expect(hideImportChanges(added).hidden).toBe(0)
  })
})

describe('splitModified (Highlight: Split changes)', () => {
  const f = parse('a.ts', '@@ -1,4 +1,4 @@', ' a', '-b', '-c', '+B', ' d')
  it('turns a Modified block into Deleted then Added', () => {
    const blocks = splitModified(f, changeBlocks(f))
    expect(blocks.map((b) => [b.type, b.from, b.to, b.line1, b.line2, b.vcsLine1, b.vcsLine2])).toEqual([
      ['deleted', 1, 3, 1, 1, 1, 3],
      ['added', 3, 4, 1, 2, 3, 3],
    ])
    expect(viewBlocks(f, 'words')).toHaveLength(1)
    expect(viewBlocks(f, 'split')).toHaveLength(2)
  })
  it('reverts each part on its own', () => {
    const [del, add] = splitModified(f, changeBlocks(f))
    expect(blockPatch(f, del!)).toContain('-b\n-c\n B\n')
    expect(blockPatch(f, add!)).toContain(' a\n+B\n d')
  })
})

describe('splitModel align', () => {
  const kinds = (rows: SplitRow[]) => rows.map((r) => r.kind)
  it('pads the shorter side so each fragment has the same height', () => {
    const f = parse('a.ts', '@@ -1,3 +1,4 @@', ' a', '-x', '+y1', '+y2', ' b')
    const m = splitModel(f, changeBlocks(f), { collapse: false, context: 3, expanded: new Set(), align: true })
    expect(kinds(m.left)).toEqual(['line', 'line', 'pad', 'line'])
    expect(kinds(m.right)).toEqual(['line', 'line', 'line', 'line'])
    expect(m.frags[0]).toMatchObject({ l1Start: 1, l1End: 3, l2Start: 1, l2End: 3 })
  })
})
