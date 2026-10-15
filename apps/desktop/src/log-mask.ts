const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const KNOWN_TOKENS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{8,}/g,
]

/**
 * Run / build output version of `maskLog`, regexes compiled once (thousands of lines per second).
 * Skips maskLog's bare 32+ alphanumeric rule: Gradle task names and Kotlin identifiers hit it.
 */
export function createLogMasker(home: string, platform: NodeJS.Platform): (text: string) => string {
  const forms = !home || home.length <= 1 ? [] : platform === 'win32' ? [home.replace(/\\/g, '\\\\'), home, home.replace(/\\/g, '/')] : [home]
  const homeRe = forms.map((form) => new RegExp(escapeRe(form), platform === 'win32' ? 'gi' : 'g'))
  return (text) => {
    let out = text
    for (const re of homeRe) out = out.replace(re, '~')
    for (const re of KNOWN_TOKENS) out = out.replace(re, '[masked]')
    // Dotted runs are mostly qualified class names: only a long mixed segment (JWT part) is a secret.
    return out.replace(/[A-Za-z0-9+/=_.-]{32,}/g, (run) => {
      if (run.startsWith('/')) return run
      if (!run.includes('.')) return mixed(run) ? '[masked]' : run
      return run.split('.').map((seg) => (seg.length >= 24 && mixed(seg) ? '[masked]' : seg)).join('.')
    })
  }
}

// `generateDebugUnitTestResValues2`-style identifiers (letters, a short numeric tail) are not secrets.
const mixed = (s: string): boolean => /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && !/^[A-Za-z_$]+\d{0,3}$/.test(s)

/** Masks credentials and the user's home folder in text a user is about to paste into a bug report. */
export function maskLog(text: string, home: string, platform: NodeJS.Platform): string {
  let out = text
  if (home && home.length > 1) {
    // Windows logs carry the home path with \, / and JSON-escaped \\ separators.
    const forms = platform === 'win32' ? [home.replace(/\\/g, '\\\\'), home, home.replace(/\\/g, '/')] : [home]
    for (const form of forms) out = out.replace(new RegExp(escapeRe(form), platform === 'win32' ? 'gi' : 'g'), '~')
  }
  for (const re of KNOWN_TOKENS) out = out.replace(re, '[masked]')
  out = out.replace(/[A-Za-z0-9+_=]{32,}/g, '[masked]')
  // Base64 runs with / . - mixed in; a run starting with / is a path and stays readable.
  return out.replace(/[A-Za-z0-9+/=_.-]{32,}/g, (run) =>
    !run.startsWith('/') && /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run) ? '[masked]' : run,
  )
}
