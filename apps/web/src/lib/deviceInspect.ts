import type { DevUiNode } from '@ccm/shared'
import { sanitize } from './agentHandoff'
import type { SearchQuery } from './preview'

const area = (n: DevUiNode): number => Math.max(0, n.bounds[2] - n.bounds[0]) * Math.max(0, n.bounds[3] - n.bounds[1])

export const hasArea = (n: DevUiNode): boolean => area(n) > 0

const contains = (n: DevUiNode, x: number, y: number): boolean => x >= n.bounds[0] && x < n.bounds[2] && y >= n.bounds[1] && y < n.bounds[3]

/** Index of the node under a screen point: smallest box, then deepest, then last drawn. -1 when none. */
export function nodeAt(nodes: readonly DevUiNode[], x: number, y: number): number {
  let best = -1
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    if (!hasArea(n) || !contains(n, x, y)) continue
    const b = best < 0 ? null : nodes[best]!
    if (!b || area(n) < area(b) || (area(n) === area(b) && n.depth >= b.depth)) best = i
  }
  return best
}

/** `com.app:id/login_button` → `login_button`; `android:id/title` stays qualified. */
export function idName(resId: string): string {
  const m = /^([\w.]+):id\/([\w.]+)$/.exec(resId)
  if (!m) return resId
  return m[1] === 'android' ? `android:id/${m[2]}` : m[2]!
}

export const shortClass = (cls: string): string => cls.slice(cls.lastIndexOf('.') + 1)

export const boundsText = (b: DevUiNode['bounds']): string => `[${b[0]},${b[1]}][${b[2]},${b[3]}]`

/** What "Find in files" looks for: the id name (layouts, R.id, Compose testTag), else the text (strings.xml), else the description. */
export function nodeSearch(n: DevUiNode): SearchQuery | null {
  const id = n.resId ? idName(n.resId).replace(/^android:id\//, '') : ''
  const q = (id || n.text || n.desc).trim()
  if (!q || q.includes('\n') || q.length > 200) return null
  return { q, regex: false, caseSensitive: true, word: /^\w+$/.test(q) }
}

/** Short block for an agent's prompt (never submitted); text is masked like browser handoffs. */
export function nodePrompt(n: DevUiNode, device: string): string {
  const out = [`View on ${sanitize(device, 80)}: ${n.cls || 'node'}`]
  if (n.resId) out.push(`id: @id/${idName(n.resId).replace(/^android:id\//, 'android:')} (${sanitize(n.resId, 200)})`)
  const text = sanitize(n.text, 200)
  if (text) out.push(`text: "${text}"`)
  const desc = sanitize(n.desc, 200)
  if (desc) out.push(`content-desc: "${desc}"`)
  out.push(`bounds: ${boundsText(n.bounds)}`)
  return out.join('\n')
}

/** Ancestors from the root down to `i` (inclusive), for the breadcrumb. */
export function pathTo(nodes: readonly DevUiNode[], i: number): number[] {
  const out: number[] = []
  for (let at = i; at >= 0 && out.length < 64; at = nodes[at]?.parent ?? -1) out.unshift(at)
  return out
}
