export type BranchNameProblem = 'empty' | 'space' | 'dash' | 'dots' | 'char' | 'slash' | 'lock' | 'long'

/** Quick check mirroring `git check-ref-format --branch` (main runs git's own check too). */
export function checkBranchName(name: unknown): { ok: true } | { ok: false; reason: BranchNameProblem } {
  if (typeof name !== 'string' || !name) return { ok: false, reason: 'empty' }
  if (name.length > 200) return { ok: false, reason: 'long' }
  if (/\s/.test(name)) return { ok: false, reason: 'space' }
  if (name.startsWith('-')) return { ok: false, reason: 'dash' }
  if (name.includes('..') || name.includes('@{') || name === '@') return { ok: false, reason: 'dots' }
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return { ok: false, reason: 'char' }
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//') || name.endsWith('.') || /(^|\/)\./.test(name)) return { ok: false, reason: 'slash' }
  if (/\.lock(\/|$)/.test(name)) return { ok: false, reason: 'lock' }
  return { ok: true }
}

export type BranchOpError = 'denied' | 'invalid' | 'exists' | 'not-merged' | 'current' | 'conflict' | 'no-upstream' | 'non-ff' | 'auth' | 'timeout' | 'cancelled' | 'failed'

/** `detail`: one sanitized line of git's stderr (no credentials). */
export type BranchOpResult = { ok: true; detail?: string } | { ok: false; error: BranchOpError; detail?: string }
