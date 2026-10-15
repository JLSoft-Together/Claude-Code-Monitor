import type { DiffFile, DiffHunk, DiffLine } from './diff'
import { changeBlocks, type Block } from './diffBlocks'

interface ImportSyntax {
  /** A whole import line. */
  line: RegExp
  /** A name inside a multi-line import list. */
  item?: RegExp
  /** The line that opens such a list (`import {`, `from x import (`). */
  opener?: RegExp
}

const JS: ImportSyntax = {
  line: /^\s*(import\b.*|export\s+(type\s+)?(\*|\{[^}]*\})\s*(as\s+[\w$]+\s*)?from\s*['"][^'"]+['"]\s*;?|(const|let|var)\s+[\w${},\s]+=\s*require\(\s*['"][^'"]+['"]\s*\)\s*;?|\}\s*from\s*['"][^'"]+['"]\s*;?)\s*$/,
  item: /^\s*(type\s+)?[\w$]+(\s+as\s+[\w$]+)?\s*,?\s*$/,
  opener: /^\s*(import|export)\b[^'"]*\{[^}]*$/,
}
const SYNTAX: Record<string, ImportSyntax> = {
  js: JS,
  kotlin: { line: /^\s*import\s+[\w.`*]+(\s+as\s+\w+)?\s*;?\s*$/ },
  java: { line: /^\s*import\s+(static\s+)?[\w.]+(\.\*)?\s*;\s*$/ },
  dart: {
    line: /^\s*(import|export|part)\s+['"][^'"]+['"].*$/,
    item: /^\s*(show|hide|as|deferred\s+as)\b[^;{}()]*;?\s*$/,
    opener: /^\s*(import|export)\s+['"][^'"]+['"][^;]*$/,
  },
  python: {
    line: /^\s*(import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*|from\s+[.\w]+\s+import\s+.+)\s*$/,
    item: /^\s*([\w.]+(\s+as\s+\w+)?\s*,?|\))\s*$/,
    opener: /^\s*from\s+[.\w]+\s+import\s*\([\w\s,]*$/,
  },
}
const BY_EXT: Record<string, string> = {
  ts: 'js', tsx: 'js', mts: 'js', cts: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js',
  kt: 'kotlin', kts: 'kotlin', java: 'java', dart: 'dart', py: 'python', pyi: 'python',
}

/** Import syntax for a file path, null when the language is not one we can read imports of. */
export function importSyntax(path: string): ImportSyntax | null {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  return (ext && SYNTAX[BY_EXT[ext] ?? '']) || null
}

const blank = (s: string): boolean => !s.trim()

/** Inside an import list that opened above the block: walk up over list items to the opener. */
function insideList(lines: readonly DiffLine[], from: number, syn: ImportSyntax): boolean {
  if (!syn.item || !syn.opener) return false
  for (let i = from - 1; i >= 0; i--) {
    const l = lines[i]!
    if (l.type === 'note' || blank(l.text)) continue
    if (syn.opener.test(l.text)) return true
    if (!syn.item.test(l.text)) return false
  }
  return false
}

/** Every changed line is an import, a list item of an import, or blank. */
export function importOnly(block: Block, lines: readonly DiffLine[], syn: ImportSyntax): boolean {
  const texts = [...block.dels, ...block.adds].map((l) => l.text).filter((t) => !blank(t))
  if (!texts.length) return false
  const opens = texts.some((t) => syn.opener?.test(t))
  let listed: boolean | null = null
  return texts.every((t) => {
    if (syn.line.test(t) || syn.opener?.test(t)) return true
    if (!syn.item?.test(t)) return false
    listed ??= opens || insideList(lines, block.from, syn)
    return listed
  })
}

function hunkOf(lines: DiffLine[], oldNo: number, newNo: number, section: string): DiffHunk {
  let oldCount = 0
  let newCount = 0
  for (const l of lines) {
    if (l.type === 'ctx' || l.type === 'del') oldCount++
    if (l.type === 'ctx' || l.type === 'add') newCount++
  }
  // A zero count names the line before the hunk (changeBlocks reads it back the same way).
  const oldStart = oldCount ? oldNo : oldNo - 1
  const newStart = newCount ? newNo : newNo - 1
  return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, oldStart, oldCount, newStart, newCount, section, lines }
}

/**
 * "Ignore imports and formatting": git already ignored whitespace and blank lines; this drops the change blocks made only
 * of import lines (TS/JS, Kotlin, Java, Dart, Python) by cutting the hunk around them, so the gap row marks where they
 * were. New / deleted files and other languages are left as they are.
 */
export function hideImportChanges(file: DiffFile): { file: DiffFile; hidden: number } {
  const syn = importSyntax(file.path)
  if (!syn || file.isNew || file.isDeleted) return { file, hidden: 0 }
  const drop = changeBlocks(file).filter((b) => importOnly(b, file.hunks[b.hunk]!.lines, syn))
  if (!drop.length) return { file, hidden: 0 }
  const hunks: DiffHunk[] = []
  file.hunks.forEach((h, hi) => {
    const cuts = drop.filter((b) => b.hunk === hi)
    if (!cuts.length) {
      hunks.push(h)
      return
    }
    let oldNo = h.oldCount === 0 ? h.oldStart + 1 : h.oldStart
    let newNo = h.newCount === 0 ? h.newStart + 1 : h.newStart
    let part: DiffLine[] = []
    let partOld = oldNo
    let partNew = newNo
    const flush = (): void => {
      if (part.some((l) => l.type !== 'note')) hunks.push(hunkOf(part, partOld, partNew, h.section))
      part = []
    }
    h.lines.forEach((l, i) => {
      const cut = cuts.find((b) => i >= b.from && i < b.to)
      if (cut && i === cut.from) flush()
      if (!cut) {
        if (!part.length) {
          partOld = oldNo
          partNew = newNo
        }
        part.push(l)
      }
      if (l.type === 'ctx' || l.type === 'del') oldNo++
      if (l.type === 'ctx' || l.type === 'add') newNo++
    })
    flush()
  })
  const added = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0)
  const removed = hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'del').length, 0)
  return { file: { ...file, hunks, added, removed }, hidden: drop.length }
}
