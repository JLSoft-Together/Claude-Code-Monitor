const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const KNOWN_TOKENS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{8,}/g,
]
const KEY_VALUE = /(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(\S{4,})/gi

// Windows text carries the home path with \, / and JSON-escaped \\ separators.
function homePatterns(home: string, platform: string): RegExp[] {
  if (!home || home.length <= 1) return []
  const forms = platform === 'win32' ? [home.replace(/\\/g, '\\\\'), home, home.replace(/\\/g, '/')] : [home]
  return forms.map((form) => new RegExp(escapeRe(form), platform === 'win32' ? 'gi' : 'g'))
}

function maskCommon(text: string, homeRe: RegExp[]): string {
  let out = text
  for (const re of homeRe) out = out.replace(re, '~')
  for (const re of KNOWN_TOKENS) out = out.replace(re, '[masked]')
  return out
}

const allCases = (s: string): boolean => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s)

/** Masks known tokens, key=value secrets, long opaque runs and the home folder (→ ~). */
export function maskSecrets(text: string, home: string, platform: string): string {
  let out = maskCommon(text, homePatterns(home, platform))
  out = out.replace(/[A-Za-z0-9+_=]{32,}/g, '[masked]')
  out = out.replace(KEY_VALUE, '$1$2[masked]')
  // A run starting with / is a path and stays readable.
  return out.replace(/[A-Za-z0-9+/=_.-]{32,}/g, (run) => (!run.startsWith('/') && allCases(run) ? '[masked]' : run))
}

// `generateDebugUnitTestResValues2`-style identifiers (letters, a short numeric tail) are not secrets.
const mixed = (s: string): boolean => allCases(s) && !/^[A-Za-z_$]+\d{0,3}$/.test(s)

/**
 * Run / build output version of `maskSecrets`, regexes compiled once (thousands of lines per second).
 * Skips the bare 32+ alphanumeric rule: Gradle task names and Kotlin identifiers hit it.
 */
export function createLogMasker(home: string, platform: string): (text: string) => string {
  const homeRe = homePatterns(home, platform)
  return (text) => {
    const out = maskCommon(text, homeRe).replace(KEY_VALUE, '$1$2[masked]')
    // Dotted runs are mostly qualified class names: only a long mixed segment (JWT part) is a secret.
    return out.replace(/[A-Za-z0-9+/=_.-]{32,}/g, (run) => {
      if (run.startsWith('/')) return run
      if (!run.includes('.')) return mixed(run) ? '[masked]' : run
      return run.split('.').map((seg) => (seg.length >= 24 && mixed(seg) ? '[masked]' : seg)).join('.')
    })
  }
}
