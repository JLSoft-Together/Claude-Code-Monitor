import path from 'node:path'
import type { MemFinding } from '@ccm/shared'
import { importsOf } from './contextSources'

/** Claude Code 2.1.294 flags an instruction file over max(40k, 5 % of the window) chars; 40k is the floor (docs §11ae). */
export const LARGE_CHARS = 40_000
/** MEMORY.md beyond 200 lines or 25k chars is cut before it reaches the session (docs §11ae). */
export const INDEX_LINES = 200
export const INDEX_CHARS = 25_000
export const FINDINGS_MAX = 500

export type LintRole = 'instructions' | 'memory-index' | 'memory'

export interface LintDoc {
  path: string
  role: LintRole
  /** null when the file was too big to read. */
  text: string | null
  bytes: number
  /** Inside the project folder: its path tokens are checked against the project. */
  inProject: boolean
}

export interface LintCtx {
  cwd: string
  home: string
  memoryDir: string
  exists: (abs: string) => Promise<boolean>
  /** Workspace folders (`apps/web`): docs often write paths relative to one of them. */
  subRoots?: readonly string[]
  /** Windows: compare paths without case. */
  foldCase?: boolean
}

export type LintFinding = Omit<MemFinding, 'openable'>

interface Frontmatter {
  fields: Map<string, string>
  /** Line of the closing `---` (or 1 when there is none). */
  end: number
}

/** Top-level `key: value` plus the keys under `metadata:` (newer memory files keep `type` there). */
export function frontmatter(text: string): Frontmatter | null {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const fields = new Map<string, string>()
  let inMeta = false
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!
    if (raw.trim() === '---') return { fields, end: i + 1 }
    const top = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw)
    if (top) {
      inMeta = top[1] === 'metadata'
      if (!inMeta) fields.set(top[1]!, top[2]!.trim().replace(/^["']|["']$/g, ''))
      continue
    }
    const sub = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw)
    if (inMeta && sub && !fields.has(sub[1]!)) fields.set(sub[1]!, sub[2]!.trim().replace(/^["']|["']$/g, ''))
  }
  return null
}

/** Lines outside code fences, 1-based. */
function proseLines(text: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  let fence = false
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence
    else if (!fence) out.push({ line: i + 1, text: raw })
  })
  return out
}

/** Relative paths written in prose or inline code: `apps/web/x.ts`, `.planning/`, `src/a.ts:12`. */
export function pathTokens(line: string): string[] {
  const out: string[] = []
  for (const raw of line.split(/[\s`'"()<>[\]{}|,;]+/)) {
    const t = raw
      .replace(/^\.\//, '')
      .replace(/#.*$/, '')
      .replace(/(:\d+)+$/, '')
      .replace(/[.:!?]+$/, '')
    if (!/^[\w.-]+(\/[\w.-]+)+\/?$/.test(t) || t.includes('..') || t.startsWith('.git/')) continue
    if (!t.endsWith('/') && !/\.[A-Za-z0-9]{1,8}$/.test(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}

const wikiLinks = (line: string): string[] => [...line.matchAll(/\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g)].map((m) => m[1]!.trim()).filter(Boolean)

const mdLinks = (line: string): string[] =>
  [...line.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]!).filter((t) => !/^([a-z][a-z0-9+.-]*:|#)/i.test(t))

const stem = (file: string): string => path.basename(file).replace(/\.md$/i, '')

/** Read-only checks over CLAUDE.md files, their imports, MEMORY.md and the memory files; nothing is changed. */
export async function lintDocs(docs: readonly LintDoc[], ctx: LintCtx): Promise<{ findings: LintFinding[]; truncated: boolean }> {
  const findings: LintFinding[] = []
  const fold = (p: string): string => (ctx.foldCase ? path.resolve(p).toLowerCase() : path.resolve(p))
  const push = (f: LintFinding): void => {
    if (!findings.some((x) => x.file === f.file && x.line === f.line && x.kind === f.kind && x.text === f.text)) findings.push(f)
  }
  const known = new Map<string, Promise<boolean>>()
  const exists = (abs: string): Promise<boolean> => {
    const k = fold(abs)
    if (!known.has(k)) known.set(k, ctx.exists(abs))
    return known.get(k)!
  }

  const bases = [ctx.cwd, ...(ctx.subRoots ?? [])]
  const memories = docs.filter((d) => d.role === 'memory' && path.basename(d.path).toLowerCase() !== 'memory.md')
  const index = docs.find((d) => d.role === 'memory-index')
  const names = new Set<string>()
  const byName = new Map<string, LintDoc[]>()
  for (const m of memories) {
    names.add(stem(m.path).toLowerCase())
    const fm = m.text === null ? null : frontmatter(m.text)
    const name = fm?.fields.get('name')
    if (name) {
      names.add(name.toLowerCase())
      byName.set(name.toLowerCase(), [...(byName.get(name.toLowerCase()) ?? []), m])
    }
    if (m.text !== null) {
      const missing = ['name', 'description', 'type'].filter((k) => !fm?.fields.get(k))
      if (missing.length) push({ file: m.path, line: 1, kind: 'frontmatter', text: missing.join(', ') })
    }
  }
  for (const [name, list] of byName) if (list.length > 1) for (const m of list) push({ file: m.path, line: 1, kind: 'duplicate-name', text: name })

  const indexed = new Set<string>()
  if (index?.text) {
    const trimmed = index.text.trim()
    const count = trimmed ? trimmed.split('\n').length : 0
    if (count > INDEX_LINES) push({ file: index.path, line: INDEX_LINES + 1, kind: 'index-too-long', text: String(count), limit: INDEX_LINES })
    if (trimmed.length > INDEX_CHARS) push({ file: index.path, line: 1, kind: 'too-large', text: String(trimmed.length), limit: INDEX_CHARS })
    for (const { line, text } of proseLines(index.text)) {
      for (const target of mdLinks(text)) {
        let rel = target
        try {
          rel = decodeURIComponent(target)
        } catch {
          /* keep as written */
        }
        const abs = path.resolve(ctx.memoryDir, rel)
        indexed.add(fold(abs))
        if (!(await exists(abs))) push({ file: index.path, line, kind: 'index-missing-file', text: target })
      }
      for (const w of wikiLinks(text)) indexed.add(fold(path.join(ctx.memoryDir, `${w.replace(/\.md$/i, '')}.md`)))
    }
  }
  for (const m of memories) if (!indexed.has(fold(m.path))) push({ file: m.path, line: 1, kind: 'not-indexed', text: path.basename(m.path) })

  for (const d of docs) {
    const size = d.text?.length ?? d.bytes
    if (d.role !== 'memory-index' && size > LARGE_CHARS) push({ file: d.path, line: 1, kind: 'too-large', text: String(size), limit: LARGE_CHARS })
    if (d.text === null) continue
    const body = frontmatter(d.text)
    for (const { line, text } of proseLines(d.text)) {
      if (body && line <= body.end) continue
      if (d.role !== 'instructions') for (const w of wikiLinks(text)) if (!names.has(w.replace(/\.md$/i, '').toLowerCase())) push({ file: d.path, line, kind: 'broken-link', text: w })
      if (d.role === 'instructions') {
        for (const abs of importsOf(text, path.dirname(d.path), ctx.home)) if (!(await exists(abs))) push({ file: d.path, line, kind: 'missing-import', text: abs })
      }
      if (d.role === 'memory-index' || (d.role === 'instructions' && !d.inProject)) continue
      for (const tok of pathTokens(text)) {
        const first = tok.split('/')[0]!
        let anchored = false
        let found = false
        for (const base of bases) {
          if (!(await exists(path.join(base, first)))) continue
          anchored = true
          if ((found = await exists(path.join(base, tok)))) break
        }
        if (anchored && !found) push({ file: d.path, line, kind: 'missing-path', text: tok })
      }
    }
  }
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
  const truncated = findings.length > FINDINGS_MAX
  return { findings: findings.slice(0, FINDINGS_MAX), truncated }
}
