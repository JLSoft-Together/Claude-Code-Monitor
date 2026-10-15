// v41 drawable preview: which XML files the daemon renders as a drawable / color state list.

/** Root elements Android inflates as a Drawable (`Drawable.createFromXml`). */
export const DRAWABLE_ROOTS: readonly string[] = [
  'shape',
  'selector',
  'layer-list',
  'vector',
  'animated-vector',
  'animated-selector',
  'ripple',
  'inset',
  'clip',
  'scale',
  'rotate',
  'level-list',
  'transition',
  'bitmap',
  'nine-patch',
  'adaptive-icon',
  'animation-list',
  'color',
]

/** Bytes of a loose file read to find its root element. */
export const DRAWABLE_SNIFF_BYTES = 4096

export type DrawableKind = 'drawable' | 'color'

const segments = (p: string): string[] => p.split(/[\\/]/).filter(Boolean)

/** `res/drawable*` / `res/mipmap*` / `res/color*` folder of an `.xml` file, by path only. */
export function drawableFolderKind(path: string): DrawableKind | null {
  const parts = segments(path)
  const n = parts.length
  if (n < 3 || !/\.xml$/i.test(parts[n - 1]!) || parts[n - 3]!.toLowerCase() !== 'res') return null
  const dir = parts[n - 2]!.toLowerCase()
  if (/^color(-[a-z0-9_+-]+)?$/.test(dir)) return 'color'
  if (/^(drawable|mipmap)(-[a-z0-9_+-]+)?$/.test(dir)) return 'drawable'
  return null
}

/** First element name of an XML text (prolog, comments, doctype skipped); null when none in the text. */
export function xmlRootName(head: string): string | null {
  let s = head.replace(/^﻿/, '')
  for (;;) {
    s = s.replace(/^\s+/, '')
    if (s.startsWith('<?')) {
      const end = s.indexOf('?>')
      if (end < 0) return null
      s = s.slice(end + 2)
    } else if (s.startsWith('<!--')) {
      const end = s.indexOf('-->')
      if (end < 0) return null
      s = s.slice(end + 3)
    } else if (s.startsWith('<!')) {
      const end = s.indexOf('>')
      if (end < 0) return null
      s = s.slice(end + 1)
    } else break
  }
  const m = /^<([A-Za-z_][\w.:-]*)/.exec(s)
  return m ? m[1]! : null
}

/** `<selector>` of colour items (no drawables): a color state list even outside `res/color`. */
function looksLikeColorList(head: string): boolean {
  return /<item\b[^>]*\bandroid:color\s*=/.test(head) && !/\bandroid:drawable\s*=/.test(head) && !/<item\b[^>]*[^/]>\s*<[a-z]/i.test(head)
}

/**
 * What a file previews as: by folder (`res/drawable*`, `res/mipmap*`, `res/color*`), else for a loose `.xml` by its
 * root element (`head` = the first {@link DRAWABLE_SNIFF_BYTES} bytes). Layout folders never count.
 */
export function drawableKind(path: string, head: string | null): DrawableKind | null {
  const byFolder = drawableFolderKind(path)
  if (byFolder === 'color') return 'color'
  if (!/\.xml$/i.test(path)) return null
  const parts = segments(path)
  if (parts[parts.length - 3]?.toLowerCase() === 'res' && !byFolder) return null
  if (head === null) return byFolder
  const root = xmlRootName(head.slice(0, DRAWABLE_SNIFF_BYTES))
  if (!root) return byFolder
  if (root === 'selector' && looksLikeColorList(head.slice(0, DRAWABLE_SNIFF_BYTES))) return 'color'
  if (DRAWABLE_ROOTS.includes(root)) return 'drawable'
  return byFolder
}
