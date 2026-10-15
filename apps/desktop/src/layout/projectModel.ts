import { existsSync } from 'node:fs'
import path from 'node:path'

/** `project/load` params for the layout daemon (see apps/layout-daemon/README.md). */
export interface ProjectLoadPayload {
  resDirs: string[]
  aarResDirs: { dir: string; name: string }[]
  classpath: string[]
  rJar?: string
  packageName: string
  namespace: string
  appTheme?: string
  activityThemes: Record<string, string>
  minSdk?: number
  targetSdk?: number
  /** Modules' `sampledata/` folders (`@sample/<name>` design-time data). */
  sampleDataDirs?: string[]
}

export interface ParsedProjectModel {
  module: string
  variant: string
  payload: ProjectLoadPayload
  /** Project modules on the app's runtime classpath (transitive), e.g. `[':core:ui']`. */
  projectDeps: string[]
  /** Gradle-side warnings plus entries dropped here (relative, missing, over cap). */
  warnings: string[]
}

export const MODEL_CAPS = { resDirs: 64, aarResDirs: 1000, classpath: 4000, activityThemes: 500, projectDeps: 500 } as const

const MODULE_RE = /^(:[A-Za-z0-9_.-]+)+$/
const VARIANT_RE = /^[A-Za-z][A-Za-z0-9]*$/
export const PACKAGE_RE = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/
export const THEME_RE = /^@?(android:)?(style\/)?[A-Za-z_][\w.]*$/

/** Gradle args for `apps/layout-daemon/init/ccm-project-model.gradle`; run with the project's own wrapper. */
export function projectModelArgs(module: string, outFile: string, initScript: string, variant = 'debug', compile = false): string[] {
  const mod = module.startsWith(':') ? module : `:${module}`
  if (!MODULE_RE.test(mod)) throw new Error(`invalid Gradle module path: ${module}`)
  if (!VARIANT_RE.test(variant)) throw new Error(`invalid variant: ${variant}`)
  if (!path.isAbsolute(outFile) || !path.isAbsolute(initScript)) throw new Error('outFile and initScript must be absolute')
  return ['-q', '--init-script', initScript, `${mod}:ccmProjectModel`, `-Pccm.out=${outFile}`, `-Pccm.variant=${variant}`, ...(compile ? ['-Pccm.compile=true'] : [])]
}

export function parseProjectModel(
  input: string | unknown,
  opts: { exists?: (p: string) => boolean } = {},
): ParsedProjectModel {
  const exists = opts.exists ?? existsSync
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  if (!raw || typeof raw !== 'object') throw new Error('project model: not an object')
  const m = raw as Record<string, unknown>
  const warnings = strings(m.warnings).slice(0, 50)

  const namespace = str(m.namespace)
  if (!namespace || !PACKAGE_RE.test(namespace)) throw new Error('project model: namespace missing')
  const applicationId = str(m.applicationId)
  const packageName = applicationId && PACKAGE_RE.test(applicationId) ? applicationId : namespace

  const keep = (label: string, list: string[], cap: number): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    let missing = 0
    for (const p of list) {
      if (!path.isAbsolute(p) || p.includes('\0')) {
        warnings.push(`${label}: ignored non-absolute path`)
        continue
      }
      const key = path.normalize(p)
      if (seen.has(key)) continue
      seen.add(key)
      if (!exists(key)) {
        missing++
        continue
      }
      out.push(key)
    }
    if (missing) warnings.push(`${label}: ${missing} missing on disk (build the project)`)
    if (out.length > cap) warnings.push(`${label}: capped at ${cap} of ${out.length}`)
    return out.slice(0, cap)
  }

  const resDirs = keep('resDirs', [...strings(m.resDirs), ...strings(m.generatedResDirs)], MODEL_CAPS.resDirs)
  const aarRaw = Array.isArray(m.aarRes) ? m.aarRes : []
  const aarByDir = new Map<string, string>()
  for (const a of aarRaw) {
    const o = a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
    const dir = str(o.dir)
    if (dir) aarByDir.set(path.normalize(dir), str(o.name) || path.basename(path.dirname(dir)))
  }
  const aarResDirs = keep('aarResDirs', [...aarByDir.keys()], MODEL_CAPS.aarResDirs).map((dir) => ({
    dir,
    name: aarByDir.get(dir) ?? path.basename(path.dirname(dir)),
  }))
  // Module classes first: they shadow same-named library classes like on device.
  const classpath = keep('classpath', [...strings(m.classDirs), ...strings(m.classpath)], MODEL_CAPS.classpath)
  const rJarRaw = str(m.rJar)
  const rJar = rJarRaw ? keep('rJar', [rJarRaw], 1)[0] : undefined
  if (!rJar) warnings.push('R.jar missing: AndroidX / Material views need a successful build')

  const activityThemes: Record<string, string> = {}
  const themes = m.activityThemes && typeof m.activityThemes === 'object' ? Object.entries(m.activityThemes as object) : []
  for (const [activity, theme] of themes.slice(0, MODEL_CAPS.activityThemes)) {
    if (PACKAGE_RE.test(activity) && typeof theme === 'string' && THEME_RE.test(theme)) activityThemes[activity] = theme
  }
  const appTheme = str(m.appTheme)

  const payload: ProjectLoadPayload = {
    resDirs,
    aarResDirs,
    classpath,
    packageName,
    namespace,
    activityThemes,
  }
  if (rJar) payload.rJar = rJar
  if (appTheme && THEME_RE.test(appTheme)) payload.appTheme = appTheme
  const minSdk = sdk(m.minSdk)
  const targetSdk = sdk(m.targetSdk)
  if (minSdk !== undefined) payload.minSdk = minSdk
  if (targetSdk !== undefined) payload.targetSdk = targetSdk
  const projectDir = str(m.projectDir)
  if (projectDir && path.isAbsolute(projectDir) && exists(path.join(projectDir, 'sampledata'))) payload.sampleDataDirs = [path.join(projectDir, 'sampledata')]

  const projectDeps = [...new Set(strings(m.projectDeps).filter((d) => MODULE_RE.test(d)))].slice(0, MODEL_CAPS.projectDeps)

  return { module: str(m.module) || ':app', variant: str(m.variant) || 'debug', payload, projectDeps, warnings }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function sdk(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1000 ? v : undefined
}

const KIT_THEME = '@style/Theme.Material3.DayNight.NoActionBar'

/**
 * `kit.json` of the bundled loose kit (apps/layout-daemon `stageLooseKit`) → `project/load` params: library views
 * (ConstraintLayout, AppCompat, Material) for a layout XML that has no project model. Paths must stay inside `dir`.
 */
export function parseLooseKit(input: string | unknown, dir: string, opts: { exists?: (p: string) => boolean } = {}): ProjectLoadPayload {
  const exists = opts.exists ?? existsSync
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  if (!raw || typeof raw !== 'object') throw new Error('loose kit: not an object')
  const m = raw as Record<string, unknown>
  const inside = (rel: unknown): string | null => {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) return null
    const abs = path.resolve(dir, rel)
    const back = path.relative(dir, abs)
    return back && !back.startsWith('..') && !path.isAbsolute(back) && exists(abs) ? abs : null
  }
  const aarResDirs: ProjectLoadPayload['aarResDirs'] = []
  for (const a of Array.isArray(m.aarRes) ? m.aarRes.slice(0, MODEL_CAPS.aarResDirs) : []) {
    const o = a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
    const abs = inside(o.dir)
    if (abs) aarResDirs.push({ dir: abs, name: str(o.name) || path.basename(path.dirname(abs)) })
  }
  const classpath = strings(m.classpath).slice(0, MODEL_CAPS.classpath).map(inside).filter((p): p is string => !!p)
  const rJar = inside(m.rJar)
  if (!classpath.length || !rJar) throw new Error('loose kit: classes or R.jar missing')
  const pkg = str(m.packageName)
  const packageName = PACKAGE_RE.test(pkg) ? pkg : 'dev.ccm.loosekit'
  const theme = str(m.appTheme)
  return {
    resDirs: [],
    aarResDirs,
    classpath,
    rJar,
    packageName,
    namespace: packageName,
    appTheme: THEME_RE.test(theme) ? theme : KIT_THEME,
    activityThemes: {},
  }
}
