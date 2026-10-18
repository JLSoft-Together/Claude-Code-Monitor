// Writes apps/web/public/file-icons/ (Atom Material Icons SVGs), apps/web/src/lib/explorer/fileIconRules.ts and
// apps/web/public/file-icons-LICENSE.txt from AtomMaterialUI/iconGenerator at the pinned commit. Needs network and `tar`:
//   node scripts/gen-file-icons.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, 'apps/web')
const out = path.join(web, 'public/file-icons')

/** The iconGenerator commit that mallowigi/a-file-icon-idea pins as its submodule. */
const REPO = 'AtomMaterialUI/iconGenerator'
const SHA = '3efb7279176465d18e048d6eed8b916e9c7acd89'
/** Icon packs off by default in the plugin (`AtomSettingsConfig`); every other pack is on. */
const PACKS_OFF = new Set(['ANGULAR'])
/** Fallbacks when no rule matches: the plugin's unknown-type glyph, the plain folder. */
const DEFAULTS = { file: 'default', folder: 'folder' }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-icons-'))
try {
  const tarball = path.join(tmp, 'src.tar.gz')
  const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${SHA}`)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', 'src.tar.gz'], { cwd: tmp })
  const src = path.join(tmp, readdirSync(tmp).find((d) => d.startsWith('iconGenerator-')))
  const assets = path.join(src, 'assets/icons')

  const regexOf = (file) => JSON.parse(readFileSync(path.join(src, file), 'utf8')).associations.associations.regex.map((r) => r.value)

  // Java full match, CASE_INSENSITIVE → anchored JS source with flag i; refuse Java-only syntax.
  const JAVA_ONLY = /\\[QEAZzGhHvV]|\(\?[a-z]*\)|[*+?}]\+|&&/
  function jsPattern(p, name) {
    if (JAVA_ONLY.test(p)) throw new Error(`${name}: Java-only pattern ${p}`)
    const source = `^(?:${p})$`
    new RegExp(source, 'i')
    return source
  }

  /** Plugin order: highest priority wins, ties go to the earlier entry (`maxByOrNull`). */
  const ordered = (list) => list.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.priority) - Number(a.r.priority) || a.i - b.i).map((x) => x.r)

  const used = { files: new Set([DEFAULTS.file]), folders: new Set([DEFAULTS.folder]) }
  const fileRules = []
  let dropped = 0
  for (const r of ordered(regexOf('icon_associations.json'))) {
    if (r.iconPack && PACKS_OFF.has(r.iconPack)) continue
    const m = /^\/icons\/files\/(.+)\.svg$/.exec(r.icon)
    if (!m || !existsSync(path.join(assets, 'files', `${m[1]}.svg`))) {
      console.warn(`skip ${r.name}: no icon ${r.icon}`)
      dropped++
      continue
    }
    fileRules.push([jsPattern(r.pattern, r.name), m[1]])
    used.files.add(m[1])
  }
  const folderRules = []
  for (const r of ordered(regexOf('folder_associations.json'))) {
    const m = /^\/(.+)\.svg$/.exec(r.icon)
    if (!m || !['folders', 'foldersOpen'].every((d) => existsSync(path.join(assets, d, `${m[1]}.svg`)))) {
      console.warn(`skip ${r.name}: no icon ${r.icon}`)
      dropped++
      continue
    }
    folderRules.push([jsPattern(r.pattern, r.name), m[1]])
    used.folders.add(m[1])
  }

  // Comments, XML prolog, editor-only data-* attributes and layout whitespace go; fills and shapes stay as drawn.
  const minify = (svg) =>
    svg
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+data-[\w-]+="[^"]*"/g, '')
      .replace(/\s+xml:space="[^"]*"/g, '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .replace(/\s+(\/?>)/g, '$1')
      .trim()

  rmSync(out, { recursive: true, force: true })
  let bytes = 0
  /** Copies one icon; true when it has parts IntelliJ repaints with the tree foreground (`data-themed`). */
  const copy = (from, dir, name) => {
    const raw = readFileSync(from, 'utf8')
    const svg = minify(raw)
    if (!svg.startsWith('<svg')) throw new Error(`${from}: not an svg`)
    mkdirSync(path.join(out, dir), { recursive: true })
    writeFileSync(path.join(out, dir, `${name}.svg`), svg)
    bytes += svg.length
    return raw.includes('data-themed="true"')
  }
  // IntelliJ loads `<name>_dark.svg` instead of `<name>.svg` under a dark theme when it exists.
  const dark = []
  const themed = { files: [], folders: [] }
  for (const name of used.files) {
    if (copy(path.join(assets, 'files', `${name}.svg`), 'files', name)) themed.files.push(name)
    const alt = path.join(assets, 'files', `${name}_dark.svg`)
    if (existsSync(alt)) {
      copy(alt, 'files', `${name}_dark`)
      dark.push(name)
    }
  }
  for (const name of used.folders) {
    const marks = ['folders', 'foldersOpen'].map((dir) => copy(path.join(assets, dir, `${name}.svg`), dir, name))
    if (marks[0] !== marks[1]) throw new Error(`${name}: closed and open folder differ in themed parts`)
    if (marks[0]) themed.folders.push(name)
  }

  const list = (rules) => rules.map(([p, icon]) => `  [${JSON.stringify(p)}, ${JSON.stringify(icon)}],`).join('\n')
  writeFileSync(
    path.join(web, 'src/lib/explorer/fileIconRules.ts'),
    `// Generated by scripts/gen-file-icons.mjs from ${REPO}@${SHA.slice(0, 7)} — do not edit.
// [anchored case-insensitive pattern, icon], in match order: the first match wins.

export const FILE_ICON_DEFAULTS = ${JSON.stringify(DEFAULTS)} as const

export const FILE_RULES: readonly (readonly [string, string])[] = [
${list(fileRules)}
]

export const FOLDER_RULES: readonly (readonly [string, string])[] = [
${list(folderRules)}
]

/** File icons with a \`_dark\` variant. */
export const DARK_FILE_ICONS: ReadonlySet<string> = new Set(${JSON.stringify(dark.sort())})

/** Icons drawn in the tree foreground in IntelliJ (\`data-themed\` fills): shown as a mask in the row's text colour. */
export const THEMED_FILE_ICONS: ReadonlySet<string> = new Set(${JSON.stringify(themed.files.sort())})
export const THEMED_FOLDER_ICONS: ReadonlySet<string> = new Set(${JSON.stringify(themed.folders.sort())})
`,
  )

  const license = readFileSync(path.join(src, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim()
  writeFileSync(
    path.join(web, 'public/file-icons-LICENSE.txt'),
    `File icons bundled with Orrery\n==============================\n\nAtom Material Icons — https://github.com/${REPO} (commit ${SHA})\nCopyright (c) 2015-2024 Elior "Mallowigi" Boukhobza\n\n${license}\n`,
  )
  console.log(`file icons: ${fileRules.length} file rules, ${folderRules.length} folder rules, ${used.files.size + dark.length} file svgs, ${used.folders.size * 2} folder svgs, ${(bytes / 1024).toFixed(0)} KiB, ${dropped} rules skipped`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
