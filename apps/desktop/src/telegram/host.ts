import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SECRET_FILE_GLOBS, isSecretFileName, maskSecrets } from '@ccm/shared'

const GIT_TIMEOUT_MS = 20_000
const DIFF_MAX = 45 * 1024 * 1024
const NAME_RE = /[^A-Za-z0-9._-]+/g
const SECRET_PATHSPEC = ['.', ...SECRET_FILE_GLOBS.map((g) => `:(exclude,glob,icase)**/${g}`)]

function git(cwd: string, args: string[], maxBuffer = DIFF_MAX): Promise<{ ok: true; out: string } | { ok: false; code: number | null }> {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer, windowsHide: true }, (err, stdout) => {
      if (err) resolve({ ok: false, code: typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null })
      else resolve({ ok: true, out: stdout })
    })
  })
}

export async function projectDiff(cwd: string, home: string, platform: string): Promise<{ ok: true; text: string; files: number } | { ok: false; error: 'not-repo' | 'clean' | 'failed' }> {
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], 1024 * 1024)
  if (!top.ok) return { ok: false, error: 'not-repo' }
  const root = top.out.trim()
  const head = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'], 1024 * 1024)
  const base = head.ok ? ['HEAD'] : []
  const names = await git(root, ['diff', '--name-only', ...base, '--', ...SECRET_PATHSPEC], 4 * 1024 * 1024)
  if (!names.ok) return { ok: false, error: 'failed' }
  const files = names.out.split(/\r?\n/).filter(Boolean).filter((f) => !isSecretFileName(f.split('/').pop() ?? f))
  if (!files.length) return { ok: false, error: 'clean' }
  const diff = await git(root, ['diff', '--no-color', '--no-ext-diff', ...base, '--', ...SECRET_PATHSPEC])
  if (!diff.ok || !diff.out.trim()) return { ok: false, error: diff.ok ? 'clean' : 'failed' }
  return { ok: true, text: maskSecrets(diff.out, home, platform), files: files.length }
}

const stamp = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

async function excludeOrrery(project: string): Promise<void> {
  const top = await git(project, ['rev-parse', '--git-path', 'info/exclude'], 1024 * 1024)
  if (!top.ok) return
  const file = path.resolve(project, top.out.trim())
  const text = await fsp.readFile(file, 'utf8').catch(() => '')
  if (text.split(/\r?\n/).some((l) => l.trim() === '.orrery/')) return
  await fsp.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined)
  await fsp.appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}.orrery/\n`).catch(() => undefined)
}

export async function saveInbound(project: string, name: string, data: Buffer, now = new Date()): Promise<string | null> {
  const dir = path.join(project, '.orrery', 'telegram')
  const safe = name.replace(NAME_RE, '_').replace(/^\.+/, '').slice(-80) || 'file.bin'
  if (isSecretFileName(safe) || isSecretFileName(path.basename(name.replace(/\\/g, '/')))) return null
  try {
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${stamp(now)}-${safe}`)
    await fsp.writeFile(file, data, { flag: 'wx' })
    await excludeOrrery(project)
    return file
  } catch {
    return null
  }
}
