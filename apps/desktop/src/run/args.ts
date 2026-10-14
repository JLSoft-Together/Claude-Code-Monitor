export interface SubstituteVars {
  projectDir: string
  workspaceDir: string
  env: Record<string, string | undefined>
  /** Display only (preview / logged command): ${env:NAME} values become ***. */
  maskEnv?: boolean
}

/** Shell-free split: whitespace separates, '…' is literal, "…" allows \" only. Other backslashes stay (Windows paths). */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inToken = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote === "'") {
      if (c === "'") quote = null
      else cur += c
    } else if (quote === '"') {
      if (c === '\\' && s[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quote = null
      else cur += c
    } else if (/\s/.test(c)) {
      if (inToken) out.push(cur)
      cur = ''
      inToken = false
    } else {
      inToken = true
      if (c === '"' || c === "'") quote = c
      else cur += c
    }
  }
  if (inToken) out.push(cur)
  return out
}

const VAR_RE = /\$\{(projectDir|workspaceDir|env:([A-Za-z_][A-Za-z0-9_]*))\}/g

export function substitute(arg: string, vars: SubstituteVars): string {
  return arg.replace(VAR_RE, (_m, name: string, envName: string | undefined) => {
    if (name === 'projectDir') return vars.projectDir
    if (name === 'workspaceDir') return vars.workspaceDir
    const value = vars.env[envName!] ?? ''
    return vars.maskEnv && value ? '***' : value
  })
}

export const expandArgs = (s: string, vars: SubstituteVars): string[] => splitArgs(s).map((a) => substitute(a, vars))

const quoteOne = (a: string): string => (a !== '' && !/[\s"']/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)

export const quoteForDisplay = (argv: readonly string[]): string => argv.map(quoteOne).join(' ')
