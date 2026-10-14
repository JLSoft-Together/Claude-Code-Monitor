const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const KNOWN_TOKENS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{8,}/g,
]

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
