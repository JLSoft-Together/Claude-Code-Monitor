export type ThemeMode = 'light' | 'dark'

export interface ThemeMeta {
  id: string
  mode: ThemeMode
  /** Display name: theme names are proper nouns, not translated. */
  name: string
  /** Same family in the other mode, for the light/dark toggle. */
  pair?: string
  /** Preview swatch: canvas, surface, accent, well — mirrors themes.css / style.css. */
  swatch: [string, string, string, string]
}

/** `light` / `dark` are the Apple palette in style.css; the rest live in themes.css as `:root[data-theme=<id>]`. */
export const THEMES: readonly ThemeMeta[] = [
  { id: 'light', mode: 'light', name: 'Apple', pair: 'dark', swatch: ['#ececee', '#ffffff', '#0071e3', '#111113'] },
  { id: 'xcode-light', mode: 'light', name: 'Xcode', pair: 'xcode-dark', swatch: ['#ececec', '#ffffff', '#0a63d8', '#ffffff'] },
  { id: 'github-light', mode: 'light', name: 'GitHub', pair: 'github-dark', swatch: ['#f6f8fa', '#ffffff', '#0969da', '#ffffff'] },
  { id: 'solarized-light', mode: 'light', name: 'Solarized', pair: 'solarized-dark', swatch: ['#eee8d5', '#fdf6e3', '#1f6fa8', '#fdf6e3'] },
  { id: 'dark', mode: 'dark', name: 'Apple', pair: 'light', swatch: ['#1e1e1e', '#262628', '#0a6cdf', '#0b0b0c'] },
  { id: 'xcode-dark', mode: 'dark', name: 'Xcode', pair: 'xcode-light', swatch: ['#18181c', '#232328', '#0a6cdf', '#1f1f24'] },
  { id: 'github-dark', mode: 'dark', name: 'GitHub', pair: 'github-light', swatch: ['#010409', '#0d1117', '#1f6feb', '#0d1117'] },
  { id: 'solarized-dark', mode: 'dark', name: 'Solarized', pair: 'solarized-light', swatch: ['#00212b', '#002b36', '#1f6fa8', '#002b36'] },
  { id: 'monokai', mode: 'dark', name: 'Monokai', swatch: ['#1e1f1c', '#2a2b25', '#66d9ef', '#272822'] },
  { id: 'dracula', mode: 'dark', name: 'Dracula', swatch: ['#1e1f29', '#282a36', '#bd93f9', '#21222c'] },
  { id: 'material', mode: 'dark', name: 'Material', swatch: ['#1e272c', '#263238', '#80cbc4', '#263238'] },
  { id: 'one-dark', mode: 'dark', name: 'One Dark', swatch: ['#21252b', '#282c34', '#61afef', '#282c34'] },
]

export type ThemeId = string

const byId = new Map(THEMES.map((th) => [th.id, th]))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && byId.has(value)
}

export function themeMeta(id: ThemeId): ThemeMeta {
  return byId.get(id) ?? byId.get('light')!
}

export function modeOf(id: ThemeId): ThemeMode {
  return themeMeta(id).mode
}

/** Light/dark toggle: the family's other mode, else Apple in the other mode. */
export function toggleTarget(id: ThemeId): ThemeId {
  const th = themeMeta(id)
  return th.pair ?? (th.mode === 'dark' ? 'light' : 'dark')
}

/** Apple themes carry no `data-theme`, so style.css alone styles them. */
export function applyTheme(root: HTMLElement, id: ThemeId): void {
  const th = themeMeta(id)
  root.classList.toggle('dark', th.mode === 'dark')
  if (th.id === 'light' || th.id === 'dark') delete root.dataset.theme
  else root.dataset.theme = th.id
}
