export type SymbolKind = 'class' | 'function' | 'method' | 'type' | 'heading' | 'key' | 'selector'

export interface OutlineItem {
  name: string
  kind: SymbolKind
  /** 1-based. */
  line: number
  depth: number
}

type Rule = { re: RegExp; kind: SymbolKind | ((m: RegExpExecArray) => SymbolKind); name?: number }

const MAX_LINES = 5000
const MAX_ITEMS = 2000
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'new', 'throw', 'await', 'typeof', 'super', 'this', 'when', 'synchronized'])

const JS: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, kind: 'type' },
  { re: /^\s+(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*\*?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/, kind: 'method' },
]
const PYTHON: Rule[] = [
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: (m) => (m[1] ? 'method' : 'function'), name: 2 },
]
const JVM: Rule[] = [
  { re: /^\s*(?:@\w+\s+)*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|enum|inner|annotation|value|partial)\s+)*(?:class|interface|enum|object|struct|record|trait|mixin|extension)\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^\s*(?:(?:public|private|protected|internal|override|open|suspend|inline|operator|infix|tailrec|static|final|abstract)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/, kind: 'function' },
  { re: /^\s*(?:(?:public|private|fileprivate|internal|open|override|static|class|mutating)\s+)*func\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:impl(?:<[^>]*>)?\s+([\w:<>]+)|type\s+([A-Za-z_]\w*)\s+(?:struct|interface))/, kind: 'type' },
  {
    re: /^\s+(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|async|virtual|native|Future<[^>]*>)\s+)*[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;]*$/,
    kind: 'method',
  },
]
const CSS: Rule[] = [{ re: /^([^\s@}/][^{]*?)\s*\{/, kind: 'selector' }, { re: /^(@(?:media|supports|keyframes|layer)[^{]*?)\s*\{/, kind: 'selector' }]
const YAML: Rule[] = [{ re: /^([A-Za-z_"'][^:#]*?):(?:\s|$)/, kind: 'key' }]
const MARKDOWN: Rule[] = [{ re: /^(#{1,6})\s+(.+?)\s*#*\s*$/, kind: 'heading', name: 2 }]

const RULES: Record<string, Rule[]> = {
  javascript: JS,
  jsx: JS,
  typescript: JS,
  tsx: JS,
  vue: JS,
  svelte: JS,
  python: PYTHON,
  java: JVM,
  kotlin: JVM,
  dart: JVM,
  csharp: JVM,
  swift: JVM,
  go: JVM,
  rust: JVM,
  groovy: JVM,
  scala: JVM,
  css: CSS,
  scss: CSS,
  less: CSS,
  yaml: YAML,
  markdown: MARKDOWN,
}

const indentOf = (line: string): number => {
  const m = /^[\t ]*/.exec(line)![0]
  return m.replace(/\t/g, '    ').length
}

/** Symbols of one file by line patterns (no parser, no index); null when the language has no rules. */
export function outline(text: string, grammar: string | null): OutlineItem[] | null {
  if (grammar === 'json' || grammar === 'jsonc') return jsonKeys(text)
  const rules = grammar ? RULES[grammar] : undefined
  if (!rules) return null
  const lines = text.split(/\r\n|\r|\n/, MAX_LINES)
  const out: OutlineItem[] = []
  const indents: number[] = []
  let inComment = false
  for (let i = 0; i < lines.length && out.length < MAX_ITEMS; i++) {
    const line = lines[i]!
    if (grammar !== 'markdown' && grammar !== 'yaml' && grammar !== 'python') {
      if (inComment) {
        if (line.includes('*/')) inComment = false
        continue
      }
      if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
        inComment = true
        continue
      }
      if (/^\s*(?:\/\/|\*)/.test(line)) continue
    }
    for (const rule of rules) {
      const m = rule.re.exec(line)
      if (!m) continue
      const name = (rule.name ? m[rule.name] : (m[1] ?? m[2]))?.trim().replace(/^["']|["']$/g, '')
      if (!name || KEYWORDS.has(name)) break
      const kind = typeof rule.kind === 'function' ? rule.kind(m) : rule.kind
      let depth: number
      if (grammar === 'markdown') depth = m[1]!.length - 1
      else {
        const ind = indentOf(line)
        while (indents.length && indents[indents.length - 1]! >= ind) indents.pop()
        depth = indents.length
        indents.push(ind)
      }
      out.push({ name, kind, line: i + 1, depth })
      break
    }
  }
  return out
}

function jsonKeys(text: string): OutlineItem[] {
  const lines = text.split(/\r\n|\r|\n/, MAX_LINES)
  const keyed = lines.map((l, i) => ({ m: /^(\s*)"((?:[^"\\]|\\.)+)"\s*:/.exec(l), i })).filter((x) => x.m)
  if (!keyed.length) return []
  const top = Math.min(...keyed.map((x) => x.m![1]!.length))
  return keyed.filter((x) => x.m![1]!.length === top).slice(0, MAX_ITEMS).map((x) => ({ name: x.m![2]!, kind: 'key' as const, line: x.i + 1, depth: 0 }))
}

/** Find in Files query for declarations of `word`. */
export function declarationQuery(word: string): string {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `\\b(?:function|class|def|fun|func|fn|const|let|var|val|interface|type|enum|struct)\\s+${w}\\b`
}
