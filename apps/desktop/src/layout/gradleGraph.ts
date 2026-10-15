import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AndroidProject } from '@ccm/shared'
import { stripComments } from '../run/android/detect'

/** `:core:ui-kit` → `projects.core.uiKit` (Gradle type-safe project accessor). */
function accessorOf(modulePath: string): string {
  const camel = (s: string): string => s.replace(/[-_]+([A-Za-z0-9])/g, (_x, c: string) => c.toUpperCase())
  return `projects.${modulePath.replace(/^:/, '').split(':').map(camel).join('.')}`
}

export function depMatcher(libPath: string): (strippedScript: string) => boolean {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const byPath = new RegExp(`project\\s*\\(\\s*(?:path\\s*[:=]\\s*)?["']${esc(libPath)}["']`)
  const byAccessor = new RegExp(`\\b${esc(accessorOf(libPath))}\\b(?!\\.)`)
  return (text) => byPath.test(text) || byAccessor.test(text)
}

/** Build script of a module dir, comments kept; null when it has none. */
export async function readBuildScript(dir: string): Promise<string | null> {
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    const text = await fs.readFile(path.join(dir, name), 'utf8').catch(() => null)
    if (text !== null) return text
  }
  return null
}

/** Module → project modules its build script names (direct edges only). */
export async function scriptGraph(project: AndroidProject): Promise<Map<string, string[]>> {
  const matchers = project.modules.map((m) => ({ path: m.path, test: depMatcher(m.path) }))
  const graph = new Map<string, string[]>()
  await Promise.all(
    project.modules.map(async (m) => {
      const text = await readBuildScript(m.dir)
      const stripped = text === null ? '' : stripComments(text)
      graph.set(m.path, stripped ? matchers.filter((o) => o.path !== m.path && o.test(stripped)).map((o) => o.path) : [])
    }),
  )
  return graph
}

/** Modules reachable from `from` (itself first), breadth-first. */
export function closure(graph: Map<string, string[]>, from: string): string[] {
  const seen = new Set([from])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    for (const next of graph.get(queue[i]!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return queue
}

export function reaches(graph: Map<string, string[]>, from: string, to: string): boolean {
  return from !== to && closure(graph, from).includes(to)
}
