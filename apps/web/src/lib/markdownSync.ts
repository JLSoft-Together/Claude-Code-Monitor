export interface SourceAnchor {
  /** 1-based source line the rendered block starts at. */
  line: number
  /** Block offset inside the preview's scroll content, px. */
  top: number
}

/**
 * Preview scrollTop for an editor whose top visible line is `topLine` (fractional, 1-based): interpolates between the
 * rendered blocks around it, or falls back to the line ratio when no block carries a source line.
 */
export function previewScrollFor(anchors: readonly SourceAnchor[], topLine: number, totalLines: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight)
  if (max === 0) return 0
  const total = Math.max(1, totalLines)
  if (!anchors.length) return clamp(((topLine - 1) / total) * max, max)
  let prev: SourceAnchor = { line: 1, top: 0 }
  let next: SourceAnchor = { line: total + 1, top: scrollHeight }
  for (const a of anchors) {
    if (a.line <= topLine) prev = a
    else {
      next = a
      break
    }
  }
  const span = next.line - prev.line
  const at = span > 0 ? prev.top + ((topLine - prev.line) / span) * (next.top - prev.top) : prev.top
  return clamp(at, max)
}

const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
