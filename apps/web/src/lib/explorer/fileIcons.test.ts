import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileIcon, fileIconName, folderIcon, folderIconName, openDirectories } from './fileIcons'
import { DARK_FILE_ICONS, FILE_ICON_DEFAULTS, FILE_RULES, FOLDER_RULES, THEMED_FILE_ICONS } from './fileIconRules'

const ROOT = 'C:\\work\\proj'
const at = (rel: string) => `${ROOT}\\${rel.replace(/\//g, '\\')}`
const PUBLIC = path.resolve(__dirname, '../../../public')

describe('fileIconName', () => {
  it.each([
    ['package.json', 'npm'],
    ['package-lock.json', 'npmlock'],
    ['tsconfig.json', 'tsconfig'],
    ['vitest.config.ts', 'vitest'],
    ['foo.test.ts', 'testts'],
    ['README.md', 'readme'],
    ['LICENSE', 'license'],
    ['LICENSE.txt', 'license'],
    ['foo.vue', 'vue'],
    ['foo.ts', 'typeScript'],
    ['Dockerfile', 'docker'],
    ['.env', 'envs'],
    ['.gitignore', 'gitignore'],
    ['build.gradle.kts', 'gradlekts'],
  ])('%s → %s', (name, icon) => {
    expect(fileIconName(name, at(name))).toBe(icon)
  })

  it('matches case-insensitively, like the plugin', () => {
    expect(fileIconName('Package.JSON', at('Package.JSON'))).toBe('npm')
  })

  it('falls back to the default icon', () => {
    expect(fileIconName('foo.xyz', at('foo.xyz'))).toBe(FILE_ICON_DEFAULTS.file)
  })

  it('applies path rules to the absolute path with / separators', () => {
    expect(fileIconName('a.go', at('tests/a.go'))).toBe('testgofiles')
    expect(fileIconName('a.go', at('cmd/a.go'))).toBe('go')
  })
})

describe('folderIconName', () => {
  it.each([
    ['src', 'src'],
    ['test', 'tests'],
    ['__tests__', 'tests'],
    ['.github', 'github'],
    ['docs', 'docs'],
    ['zzz', FILE_ICON_DEFAULTS.folder],
  ])('%s → %s', (name, icon) => {
    expect(folderIconName(name)).toBe(icon)
  })
})

describe('icon urls', () => {
  it('uses the _dark variant only under a dark theme', () => {
    expect(DARK_FILE_ICONS.has('readme')).toBe(true)
    expect(fileIcon('README.md', at('README.md'), false).src).toBe('/file-icons/files/readme.svg')
    expect(fileIcon('README.md', at('README.md'), true).src).toBe('/file-icons/files/readme_dark.svg')
  })

  it('marks themed icons, which take the row colour', () => {
    expect(THEMED_FILE_ICONS.has('gitignore')).toBe(true)
    expect(fileIcon('.gitignore', at('.gitignore'), true)).toEqual({ src: '/file-icons/files/gitignore.svg', themed: true })
    expect(folderIcon('zzz', false)).toEqual({ src: '/file-icons/folders/folder.svg', themed: true })
    expect(folderIcon('src', true)).toEqual({ src: '/file-icons/foldersOpen/src.svg', themed: false })
  })

  it('ships every icon the rules name', () => {
    const files = new Set([FILE_ICON_DEFAULTS.file, ...FILE_RULES.map(([, icon]) => icon)])
    for (const icon of files) expect(existsSync(path.join(PUBLIC, 'file-icons/files', `${icon}.svg`)), icon).toBe(true)
    for (const icon of DARK_FILE_ICONS) expect(existsSync(path.join(PUBLIC, 'file-icons/files', `${icon}_dark.svg`)), icon).toBe(true)
    const folders = new Set([FILE_ICON_DEFAULTS.folder, ...FOLDER_RULES.map(([, icon]) => icon)])
    for (const icon of folders)
      for (const dir of ['folders', 'foldersOpen']) expect(existsSync(path.join(PUBLIC, 'file-icons', dir, `${icon}.svg`)), `${dir}/${icon}`).toBe(true)
  })
})

describe('openDirectories', () => {
  it('collects every ancestor of the open files', () => {
    const dirs = openDirectories([at('src/lib/a.ts'), at('docs/b.md')], (p) => p.toLowerCase())
    expect(dirs).toEqual(new Set(['c:\\work\\proj\\src\\lib', 'c:\\work\\proj\\src', 'c:\\work\\proj\\docs', 'c:\\work\\proj', 'c:\\work', 'c:']))
  })
})
