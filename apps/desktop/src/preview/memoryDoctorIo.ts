import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CtxKind, MemDoctorResult } from '@ccm/shared'
import { claudeRoot } from '../extensions/status'
import { contextSources, projectDir, type CtxEnv } from './contextSources'
import { lintDocs, type LintDoc, type LintRole } from './memoryDoctor'

const READ_MAX = 256 * 1024
const SUB_ROOTS_MAX = 200
const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', 'out', 'target', 'release', 'coverage'])

async function subRoots(cwd: string): Promise<string[]> {
  const out: string[] = []
  const dirs = async (dir: string): Promise<string[]> =>
    (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .map((e) => path.join(dir, e.name))
  for (const d of await dirs(cwd)) {
    if (out.length >= SUB_ROOTS_MAX) break
    out.push(d)
    for (const s of await dirs(d)) if (out.length < SUB_ROOTS_MAX) out.push(s)
  }
  return out
}

const ROLE: Partial<Record<CtxKind, LintRole>> = {
  managed: 'instructions',
  user: 'instructions',
  project: 'instructions',
  local: 'instructions',
  rules: 'instructions',
  import: 'instructions',
  'memory-index': 'memory-index',
  memory: 'memory',
}

/** Same file set as the background context dialog; text stays in main, only findings go to the page. */
export async function memoryDoctor(cwd: string, ctx: CtxEnv): Promise<MemDoctorResult> {
  const src = await contextSources(cwd, ctx)
  if (!src.ok) return src
  const config = claudeRoot(ctx.env, ctx.home)
  const memoryDir = path.join(await projectDir(config, cwd, ctx.platform), 'memory')
  const win = ctx.platform === 'win32'
  const norm = (p: string): string => (win ? path.resolve(p).toLowerCase() : path.resolve(p))
  const inside = (file: string, dir: string): boolean => {
    const rel = path.relative(norm(dir), norm(file))
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  }
  const docs: LintDoc[] = []
  for (const f of src.files) {
    const role = ROLE[f.kind]
    if (!role || !f.path.toLowerCase().endsWith('.md')) continue
    const text = f.bytes <= READ_MAX ? await fs.readFile(f.path, 'utf8').catch(() => null) : null
    docs.push({ path: f.path, role, text, bytes: f.bytes, inProject: inside(f.path, cwd) })
  }
  const exists = (abs: string): Promise<boolean> =>
    fs.stat(abs).then(
      () => true,
      () => false,
    )
  const { findings, truncated } = await lintDocs(docs, { cwd, home: ctx.home, memoryDir, exists, subRoots: await subRoots(cwd), foldCase: win })
  return {
    ok: true,
    cwd,
    home: ctx.home,
    memoryDir,
    files: docs.length,
    findings: findings.map((f) => ({ ...f, openable: inside(f.file, cwd) || inside(f.file, config) })),
    truncated: truncated || src.truncated,
  }
}
