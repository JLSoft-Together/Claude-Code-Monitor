import { DARK_FILE_ICONS, FILE_ICON_DEFAULTS, FILE_RULES, FOLDER_RULES, THEMED_FILE_ICONS, THEMED_FOLDER_ICONS } from './fileIconRules'

/** An Atom Material icon: `src` under `public/`, `themed` = drawn in the row's text colour (mask) instead of its own fills. */
export interface AtomIcon {
  src: string
  themed: boolean
}

interface Rule {
  re: RegExp
  icon: string
}

const compile = (rules: readonly (readonly [string, string])[]): Rule[] => rules.map(([source, icon]) => ({ re: new RegExp(source, 'i'), icon }))

// Rules whose pattern has a '/' match the whole path (plugin: `RegexAssociation.matches`); the rest match the name.
let byName: { file: Rule[]; filePath: { rule: Rule; at: number }[]; fileAt: Map<Rule, number>; folder: Rule[] } | null = null

function rules() {
  if (byName) return byName
  const file = compile(FILE_RULES)
  const fileAt = new Map(file.map((r, i) => [r, i]))
  byName = {
    file: file.filter((r) => !r.re.source.includes('/')),
    filePath: file.flatMap((rule, at) => (rule.re.source.includes('/') ? [{ rule, at }] : [])),
    fileAt,
    folder: compile(FOLDER_RULES),
  }
  return byName
}

const MEMO_MAX = 5000
const nameMemo = new Map<string, { icon: string; at: number }>()
const folderMemo = new Map<string, string>()

function remember<V>(memo: Map<string, V>, key: string, value: V): V {
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(key, value)
  return value
}

/** Icon name for a file: the first rule in match order, name rules and path rules together. */
export function fileIconName(name: string, path: string): string {
  const r = rules()
  const lower = name.toLowerCase()
  let hit = nameMemo.get(lower)
  if (!hit) {
    const rule = r.file.find((x) => x.re.test(name))
    hit = remember(nameMemo, lower, rule ? { icon: rule.icon, at: r.fileAt.get(rule)! } : { icon: FILE_ICON_DEFAULTS.file, at: Infinity })
  }
  // The plugin sees the absolute path with '/' separators.
  const full = path.replace(/\\/g, '/')
  const at = hit.at
  return r.filePath.find((x) => x.at < at && x.rule.re.test(full))?.rule.icon ?? hit.icon
}

export function folderIconName(name: string): string {
  const lower = name.toLowerCase()
  return folderMemo.get(lower) ?? remember(folderMemo, lower, rules().folder.find((x) => x.re.test(name))?.icon ?? FILE_ICON_DEFAULTS.folder)
}

export function fileIcon(name: string, path: string, dark: boolean): AtomIcon {
  const icon = fileIconName(name, path)
  if (THEMED_FILE_ICONS.has(icon)) return { src: `/file-icons/files/${icon}.svg`, themed: true }
  return { src: `/file-icons/files/${icon}${dark && DARK_FILE_ICONS.has(icon) ? '_dark' : ''}.svg`, themed: false }
}

/** `open`: the folder holds a file open in a viewer (the plugin's hollow folders), not an expanded row. */
export function folderIcon(name: string, open: boolean): AtomIcon {
  const icon = folderIconName(name)
  return { src: `/file-icons/${open ? 'foldersOpen' : 'folders'}/${icon}.svg`, themed: THEMED_FOLDER_ICONS.has(icon) }
}

/** Every ancestor directory of the open files, as `pathKey`s (plugin: `OpenFileDirectoryTracker`). */
export function openDirectories(files: Iterable<string>, key: (p: string) => string): Set<string> {
  const out = new Set<string>()
  for (const file of files) {
    let p = file.replace(/[\\/]+$/, '')
    for (let cut = p.search(/[\\/][^\\/]*$/); cut > 0; cut = p.search(/[\\/][^\\/]*$/)) {
      p = p.slice(0, cut)
      const k = key(p)
      if (out.has(k)) break
      out.add(k)
    }
  }
  return out
}
