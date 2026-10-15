import { watch } from 'node:fs'
import path from 'node:path'
import type { RunDetectResult } from '@ccm/shared'

/** Files whose change can alter detection (plans §2: Gradle settings / build / catalog / manifest, pubspec, FVM, entrypoints). */
export const DETECT_FILE =
  /^(settings\.gradle(\.kts)?|build\.gradle(\.kts)?|libs\.versions\.toml|AndroidManifest\.xml|pubspec\.(yaml|lock)|\.metadata|\.fvmrc|fvm_config\.json|package_config\.json|main[\w.-]*\.dart)$/

const MAX_DIRS = 64
const DEBOUNCE_MS = 500

export type WatchFn = (dir: string, onChange: (file: string | null) => void) => { close: () => void } | null

/** Non-recursive `fs.watch` per folder (cheap on every OS); a folder that does not exist is skipped. */
export const fsWatch: WatchFn = (dir, onChange) => {
  try {
    const w = watch(dir, { persistent: false }, (_event, file) => onChange(file ? String(file) : null))
    w.on('error', () => w.close())
    return w
  } catch {
    return null
  }
}

/** Folders holding the files in `DETECT_FILE` for the detected projects (root first), capped. */
export function watchDirs(result: RunDetectResult): string[] {
  const out = new Set<string>([result.root])
  for (const p of result.projects) {
    if (p.kind === 'flutter') {
      for (const sub of ['', 'lib', '.dart_tool', '.fvm', path.join('android', 'app')]) out.add(path.join(p.dir, sub))
    } else {
      out.add(p.dir)
      out.add(path.join(p.dir, 'gradle'))
      for (const m of p.modules) {
        out.add(m.dir)
        if (m.manifest) out.add(path.dirname(m.manifest))
      }
    }
  }
  return [...out].slice(0, MAX_DIRS)
}

interface Watched {
  closers: Map<string, { close: () => void }>
  timer: NodeJS.Timeout | null
}

/** Debounced re-detect per held project root; the caller closes it once no Run pane holds the root. */
export class ProjectWatchers {
  private readonly roots = new Map<string, Watched>()

  constructor(private readonly deps: { onChange: (root: string) => void; watch?: WatchFn; debounceMs?: number }) {}

  has(root: string): boolean {
    return this.roots.has(root)
  }

  sync(root: string, dirs: readonly string[]): void {
    let w = this.roots.get(root)
    if (!w) this.roots.set(root, (w = { closers: new Map(), timer: null }))
    const want = new Set(dirs)
    for (const [dir, closer] of w.closers) {
      if (want.has(dir)) continue
      closer.close()
      w.closers.delete(dir)
    }
    for (const dir of want) {
      if (w.closers.has(dir)) continue
      const closer = (this.deps.watch ?? fsWatch)(dir, (file) => {
        if (file === null || DETECT_FILE.test(path.basename(file))) this.schedule(root)
      })
      if (closer) w.closers.set(dir, closer)
    }
  }

  private schedule(root: string): void {
    const w = this.roots.get(root)
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(() => {
      w.timer = null
      if (this.roots.get(root) === w) this.deps.onChange(root)
    }, this.deps.debounceMs ?? DEBOUNCE_MS)
  }

  close(root: string): void {
    const w = this.roots.get(root)
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    for (const c of w.closers.values()) c.close()
    this.roots.delete(root)
  }

  closeAll(): void {
    for (const root of [...this.roots.keys()]) this.close(root)
  }
}
