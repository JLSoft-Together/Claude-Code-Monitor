import type { MemDoctorResult, MemFinding, MemLintKind } from '@ccm/shared'
import { desktop } from './desktop'
import { displayPath } from './ctxSources'

const bridge = desktop as unknown as { memoryDoctor?: (cwd: string) => Promise<MemDoctorResult> } | undefined

export const hasMemoryDoctor = typeof bridge?.memoryDoctor === 'function'
/** Read-only lint run by desktop on click; findings only, never file text. */
export const memoryDoctor = (cwd: string): Promise<MemDoctorResult> => bridge?.memoryDoctor?.(cwd) ?? Promise.resolve({ ok: false, error: 'unavailable' })

export const PROMPT_MAX = 6000

export interface FindingGroup {
  file: string
  shown: string
  openable: boolean
  findings: MemFinding[]
}

export function groupFindings(findings: readonly MemFinding[], cwd: string, home: string | null): FindingGroup[] {
  const map = new Map<string, FindingGroup>()
  for (const f of findings) {
    const g = map.get(f.file) ?? { file: f.file, shown: displayPath(f.file, cwd, home), openable: f.openable, findings: [] }
    g.findings.push(f)
    map.set(f.file, g)
  }
  return [...map.values()]
}

const WHAT: Record<MemLintKind, (f: MemFinding) => string> = {
  'broken-link': (f) => `[[${f.text}]] points to no memory`,
  'index-missing-file': (f) => `MEMORY.md links ${f.text}, which does not exist`,
  'not-indexed': () => 'memory file not listed in MEMORY.md',
  frontmatter: (f) => `frontmatter missing ${f.text}`,
  'duplicate-name': (f) => `name "${f.text}" is used by more than one memory`,
  'missing-path': (f) => `mentions ${f.text}, which no longer exists in the project`,
  'missing-import': (f) => `@import target ${f.text} does not exist`,
  'too-large': (f) => `${f.text} characters${f.limit ? ` (over ${f.limit})` : ''}`,
  'index-too-long': (f) => `${f.text} lines${f.limit ? ` (only the first ${f.limit} are loaded)` : ''}`,
}

/** Prefill (never submitted): the agent edits the files, the doctor itself never does. */
export function doctorPrompt(findings: readonly MemFinding[], cwd: string, home: string | null): string | null {
  if (!findings.length) return null
  const head =
    'Clean up my Claude Code memory and CLAUDE.md files per the list below. Fix broken links and index lines, add missing MEMORY.md entries and frontmatter (name, description, type), merge or rename duplicates, update or drop stale paths, and shorten oversized files. Ask before deleting anything:'
  const lines: string[] = []
  let size = head.length
  for (const f of findings) {
    const line = `- ${displayPath(f.file, cwd, home)}:${f.line} — ${WHAT[f.kind](f)}`
    if (size + line.length + 1 > PROMPT_MAX) {
      lines.push(`- … ${findings.length - lines.length} more`)
      break
    }
    lines.push(line)
    size += line.length + 1
  }
  return `${head}\n${lines.join('\n')}`
}
