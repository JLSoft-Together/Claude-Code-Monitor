/**
 * Code and interface fonts (Settings → Appearance). Bundled faces come from `fonts.css` (scripts/gen-fonts.mjs, local
 * files, latin + latin-ext + vietnamese); system entries only work where the OS has the font installed.
 */

export type FontKind = 'code' | 'ui'
export type FontPlatform = 'win32' | 'darwin'

export interface FontEntry {
  id: string
  name: string
  kind: FontKind
  /** First family of the stack; '' for the system default. */
  family: string
  source: 'bundled' | 'system'
  /** Shown only on these platforms (system fonts that ship with one OS). */
  platforms?: FontPlatform[]
}

export const SYSTEM_MONO = `ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace`
export const SYSTEM_SANS = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`

export const CODE_FONTS: readonly FontEntry[] = [
  { id: 'system', name: 'System', kind: 'code', family: '', source: 'system' },
  { id: 'consolas', name: 'Consolas', kind: 'code', family: 'Consolas', source: 'system', platforms: ['win32'] },
  { id: 'cascadia-code', name: 'Cascadia Code', kind: 'code', family: 'Cascadia Code Variable', source: 'bundled' },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', kind: 'code', family: 'JetBrains Mono Variable', source: 'bundled' },
  { id: 'google-sans-code', name: 'Google Sans Code', kind: 'code', family: 'Google Sans Code Variable', source: 'bundled' },
  { id: 'fira-code', name: 'Fira Code', kind: 'code', family: 'Fira Code Variable', source: 'bundled' },
  { id: 'source-code-pro', name: 'Source Code Pro', kind: 'code', family: 'Source Code Pro Variable', source: 'bundled' },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', kind: 'code', family: 'IBM Plex Mono', source: 'bundled' },
  { id: 'roboto-mono', name: 'Roboto Mono', kind: 'code', family: 'Roboto Mono Variable', source: 'bundled' },
  { id: 'geist-mono', name: 'Geist Mono', kind: 'code', family: 'Geist Mono Variable', source: 'bundled' },
  { id: 'ubuntu-mono', name: 'Ubuntu Mono', kind: 'code', family: 'Ubuntu Mono', source: 'bundled' },
  { id: 'inconsolata', name: 'Inconsolata', kind: 'code', family: 'Inconsolata Variable', source: 'bundled' },
  { id: 'menlo', name: 'Menlo', kind: 'code', family: 'Menlo', source: 'system', platforms: ['darwin'] },
  { id: 'courier-new', name: 'Courier New', kind: 'code', family: 'Courier New', source: 'system' },
]

export const UI_FONTS: readonly FontEntry[] = [
  { id: 'system', name: 'System', kind: 'ui', family: '', source: 'system' },
  { id: 'google-sans-flex', name: 'Google Sans Flex', kind: 'ui', family: 'Google Sans Flex Variable', source: 'bundled' },
  { id: 'inter', name: 'Inter', kind: 'ui', family: 'Inter Variable', source: 'bundled' },
  { id: 'roboto', name: 'Roboto', kind: 'ui', family: 'Roboto Variable', source: 'bundled' },
  { id: 'ibm-plex-sans', name: 'IBM Plex Sans', kind: 'ui', family: 'IBM Plex Sans Variable', source: 'bundled' },
  { id: 'source-sans-3', name: 'Source Sans 3', kind: 'ui', family: 'Source Sans 3 Variable', source: 'bundled' },
  { id: 'noto-sans', name: 'Noto Sans', kind: 'ui', family: 'Noto Sans Variable', source: 'bundled' },
  { id: 'open-sans', name: 'Open Sans', kind: 'ui', family: 'Open Sans Variable', source: 'bundled' },
  { id: 'be-vietnam-pro', name: 'Be Vietnam Pro', kind: 'ui', family: 'Be Vietnam Pro', source: 'bundled' },
]

export const CODE_SIZE_MIN = 10
export const CODE_SIZE_MAX = 24
export const CODE_SIZE_DEFAULT = 13

export const clampCodeSize = (n: number): number =>
  Number.isFinite(n) ? Math.min(CODE_SIZE_MAX, Math.max(CODE_SIZE_MIN, Math.round(n))) : CODE_SIZE_DEFAULT

export const fontList = (kind: FontKind): readonly FontEntry[] => (kind === 'code' ? CODE_FONTS : UI_FONTS)

export function fontEntry(kind: FontKind, id: string | null | undefined): FontEntry {
  const list = fontList(kind)
  return list.find((f) => f.id === id) ?? list[0]!
}

export const isFontId = (kind: FontKind, id: unknown): id is string => typeof id === 'string' && fontList(kind).some((f) => f.id === id)

/** Full CSS stack: the chosen family first, then the system stack so missing glyphs and missing fonts fall back. */
export function fontStack(entry: FontEntry): string {
  const base = entry.kind === 'code' ? SYSTEM_MONO : SYSTEM_SANS
  return entry.family ? `'${entry.family}', ${base}` : base
}

/** Nerd Fonts people install for shell prompts (Powerlevel10k, Starship…); Chromium does not search other fonts for their private-use glyphs. */
const NERD_FONTS = `'MesloLGS NF', 'MesloLGS Nerd Font', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', 'JetBrainsMono Nerd Font', 'Hack Nerd Font', 'FiraCode Nerd Font'`

/** Terminal stack: like fontStack, with installed Nerd Fonts ahead of the generic monospace so prompt icons and separators render. */
export const termFontStack = (entry: FontEntry): string => fontStack(entry).replace(/, monospace$/, `, ${NERD_FONTS}, monospace`)

/** Entries shown on this platform (other platforms' system fonts are hidden). */
export const visibleFonts = (kind: FontKind, platform: string | undefined): FontEntry[] =>
  fontList(kind).filter((f) => !f.platforms || (platform !== undefined && (f.platforms as string[]).includes(platform)))

const installedCache = new Map<string, boolean>()

/**
 * A system font is installed when text set in it measures differently from every generic fallback.
 * Bundled fonts and the system default are always available.
 */
export function isInstalled(entry: FontEntry): boolean {
  if (entry.source === 'bundled' || !entry.family) return true
  const hit = installedCache.get(entry.family)
  if (hit !== undefined) return hit
  let ok = true
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      const sample = 'mmmmmmmmmmlli10OO@#'
      ok = ['monospace', 'serif', 'sans-serif'].some((generic) => {
        ctx.font = `72px ${generic}`
        const base = ctx.measureText(sample).width
        ctx.font = `72px '${entry.family}', ${generic}`
        return ctx.measureText(sample).width !== base
      })
    }
  } catch {
    ok = true
  }
  installedCache.set(entry.family, ok)
  return ok
}
