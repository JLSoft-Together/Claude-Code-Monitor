import type { BuildError, EnvIssue, RunConfig, RunDevice, RunEmulator, RunLogLine, RunResult, RunSession, RunState } from '@ccm/shared'
import type { Spawner } from './proc'

export interface RunSettings {
  flutterSdk: string | null
  androidSdk: string | null
  jdk: string | null
}

/** Session manager side: the runner reports, the manager owns the RunSession and broadcasts. */
export interface RunnerHooks {
  state: (state: RunState, patch?: Partial<Pick<RunSession, 'appId' | 'vmServiceUri' | 'devtoolsUri' | 'progress'>>) => void
  fail: (failure: EnvIssue) => void
  log: (line: Omit<RunLogLine, 'at'>) => void
  error: (error: BuildError) => void
  /** Native confirm (e.g. "uninstall the old build and reinstall?"); false when cancelled. */
  confirm: (code: string, detail?: string) => Promise<boolean>
}

export interface RunContext {
  root: string
  config: RunConfig
  /** Resolved device (config pin or pane pick); null only for `custom`. */
  device: RunDevice | null
  settings: RunSettings
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  spawn: Spawner
  hooks: RunnerHooks
}

/**
 * One run of one config on one device. `start` resolves when the app is running or the run ended
 * (state already reported through hooks); it never throws.
 */
export interface Runner {
  start: () => Promise<void>
  /** Graceful stop, then kill the process tree after a few seconds. Idempotent. */
  stop: () => Promise<void>
  /** Sync kill for app quit. */
  kill: () => void
  reload?: (full: boolean) => Promise<RunResult>
}

export type RunnerFactory = (ctx: RunContext) => Runner

export interface DeviceService {
  /** Lazily starts trackers; later calls return the cached list. */
  list: () => Promise<RunDevice[]>
  onChange: (cb: (devices: RunDevice[]) => void) => () => void
  emulators: () => Promise<RunEmulator[]>
  launchEmulator: (id: string) => Promise<RunResult>
  /** `sync` (app quit): kill now, no graceful shutdown timer. */
  stop: (sync?: boolean) => void
}
