import type { UpdateInstallKind } from '@ccm/shared'

export interface FeedAsset {
  name: string
  size: number
  url: string
  /** Lower-case hex SHA-256 from the asset's `digest`, null when GitHub sent none. */
  sha256: string | null
}

export interface InstallEnv {
  platform: string
  packaged: boolean
  /** PORTABLE_EXECUTABLE_FILE: set by the electron-builder portable launcher. */
  portable: string | undefined
}

export function installKind(env: InstallEnv): UpdateInstallKind {
  if (!env.packaged) return 'dev'
  if (env.platform === 'win32') return env.portable ? 'portable' : 'nsis'
  if (env.platform === 'darwin') return 'mac'
  return 'unsupported'
}

/** Asset kind a dev build downloads against a test feed: what an installed build on this OS would take. */
export function platformKind(platform: string, portable: string | undefined): UpdateInstallKind {
  return installKind({ platform, packaged: true, portable })
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Names follow electron-builder.yml artifactName; an exact match wins, then the same shape with any version. */
export function pickAsset(assets: readonly FeedAsset[], version: string, kind: UpdateInstallKind, arch: string): FeedAsset | null {
  const patterns: [string, RegExp] | null =
    kind === 'nsis'
      ? [`Orrery-Setup-${version}.exe`, /^Orrery-Setup-[\w.-]+\.exe$/i]
      : kind === 'portable'
        ? [`Orrery-Portable-${version}.exe`, /^Orrery-Portable-[\w.-]+\.exe$/i]
        : kind === 'mac' && (arch === 'arm64' || arch === 'x64')
          ? [`Orrery-${version}-${arch}.dmg`, new RegExp(`^Orrery-[\\w.-]+-${escape(arch)}\\.dmg$`, 'i')]
          : null
  if (!patterns) return null
  const [exact, loose] = patterns
  return assets.find((a) => a.name === exact) ?? assets.find((a) => loose.test(a.name)) ?? null
}
