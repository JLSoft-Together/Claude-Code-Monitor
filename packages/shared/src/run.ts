// Run Android / Flutter projects (v31, `.planning/PLAN-v31-run-android-flutter.md`).
// Desktop main detects, spawns and streams; the page only sends ids + config fields.

export type RunKind = 'flutter' | 'android' | 'custom'

export type FlutterPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'linux'

export interface FlutterProject {
  kind: 'flutter'
  /** Absolute folder holding pubspec.yaml (the run cwd). */
  dir: string
  name: string
  type: 'app' | 'package' | 'plugin' | 'dart'
  /** Relative to `dir`, forward slashes: `lib/main.dart`, `lib/main_dev.dart`. */
  entrypoints: string[]
  platforms: FlutterPlatform[]
  /** Android productFlavors ∪ iOS schemes (Runner excluded). */
  flavors: string[]
  needsPubGet: boolean
  /** FVM pinned version (`.fvmrc` / `.fvm/fvm_config.json`), null when none. */
  fvm: string | null
  /** Plugin `example/` app dir, absolute. */
  example?: string
}

export interface AndroidModule {
  /** Gradle path, e.g. `:app`, `:feature:login`. */
  path: string
  /** Absolute module dir. */
  dir: string
  type: 'application' | 'library' | 'unknown'
  /** Absolute manifest path or null. */
  manifest: string | null
  /** Manifest declares an activity with MAIN + LAUNCHER. */
  launcher: boolean
  /** Runnable only because the manifest has a LAUNCHER (plugin id unresolved). */
  guessed: boolean
}

export type AndroidStatus = 'runnable' | 'no-app' | 'unknown'
export type AndroidFramework = 'native' | 'react-native' | 'flutter' | 'capacitor' | 'kmp'

export interface AndroidProject {
  kind: 'android'
  /** Absolute Gradle root (folder with settings.gradle(.kts)). */
  dir: string
  name: string
  framework: AndroidFramework
  status: AndroidStatus
  modules: AndroidModule[]
}

export type RunProject = FlutterProject | AndroidProject

export interface RunDetectResult {
  root: string
  projects: RunProject[]
  at: number
}

/** `code` → i18n `run.env.<code>`; `detail` is a path / version, never env values. */
export interface EnvIssue {
  code: string
  detail?: string
}

export interface FlutterEnv {
  kind: 'flutter'
  /** Absolute SDK root, null when not found. */
  sdk: string | null
  /** `project` = per-project SDK picked in the Run pane (app data), `setting` = the global one. */
  source: 'project' | 'setting' | 'fvm' | 'FLUTTER_ROOT' | 'path' | 'default' | null
  version: string | null
  dart: string | null
  channel: string | null
  fvm: boolean
  issues: EnvIssue[]
}

export interface AndroidEnv {
  kind: 'android'
  sdk: string | null
  adb: string | null
  emulator: string | null
  jdk: string | null
  jdkVersion: number | null
  gradlew: boolean
  issues: EnvIssue[]
  /** Which JDK runs the wrapper and why, e.g. `JDK 17 (corretto-17.0.15) for Gradle 7.3.3`; set when the Gradle version is known. */
  jdkNote?: string
}

export type RunEnv = FlutterEnv | AndroidEnv

export interface RunDevice {
  /** flutter device id or adb serial. */
  id: string
  name: string
  /** flutter `targetPlatform` (android-arm64, web-javascript, windows-x64, ios…) or `android` for adb. */
  platform: string
  emulator: boolean
  state: 'ready' | 'unauthorized' | 'offline'
  source: 'flutter' | 'adb'
}

export interface RunEmulator {
  id: string
  name: string
  source: 'flutter' | 'adb'
}

export type FlutterMode = 'debug' | 'profile' | 'release'

interface RunConfigBase {
  id: string
  name: string
  /** Absolute run cwd (pubspec dir / Gradle root / any folder for custom). */
  cwd: string
  /** true → `<repo>/.agent-monitor/run/<id>.json`; false → app data dir. */
  shared: boolean
  env: Record<string, string>
  /** Shell-free commands (split like `args`), run in order in `cwd`; a failure stops the run. */
  beforeLaunch: string[]
}

export interface FlutterRunConfig extends RunConfigBase {
  type: 'flutter'
  /** Relative to cwd. */
  entrypoint: string
  /** `selected` = the device picked in the pane bar. */
  device: 'selected' | string
  mode: FlutterMode
  flavor: string
  args: string
  attachArgs: string
}

export interface AndroidRunConfig extends RunConfigBase {
  type: 'android'
  /** Gradle module path, e.g. `:app`. */
  module: string
  variant: string
  device: 'selected' | string
  /** Extra Gradle args. */
  args: string
}

export interface CustomRunConfig extends RunConfigBase {
  type: 'custom'
  command: string
}

export type RunConfig = FlutterRunConfig | AndroidRunConfig | CustomRunConfig

export interface RunCommandPreview {
  /** argv[0] is the resolved executable. */
  argv: string[]
  /** Display string (quoted). */
  command: string
  /** i18n `run.validate.<code>` issues; non-empty blocks Run. */
  errors: EnvIssue[]
}

export type RunState =
  | 'before-launch'
  | 'building'
  | 'installing'
  | 'launching'
  | 'starting'
  | 'running'
  | 'reloading'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'cancelled'

export const RUN_LIVE_STATES: readonly RunState[] = ['before-launch', 'building', 'installing', 'launching', 'starting', 'running', 'reloading', 'stopping']
export const isRunLive = (s: RunState): boolean => RUN_LIVE_STATES.includes(s)

export interface RunSession {
  id: string
  configId: string
  configName: string
  type: RunKind
  /** Project dir (config cwd) — used to link session cards / sidebar rows. */
  cwd: string
  deviceId: string | null
  deviceName: string | null
  mode: FlutterMode | null
  state: RunState
  startedAt: number
  endedAt: number | null
  /** Android applicationId / flutter appId. */
  appId: string | null
  vmServiceUri: string | null
  devtoolsUri: string | null
  /** i18n `run.fail.<code>`: why it failed, or a notice on a `stopped` session (device lost). */
  failure: EnvIssue | null
  /** `app.progress` / phase text, null when idle. */
  progress: string | null
}

export type RunStream = 'build' | 'app' | 'logcat'
export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F'

export interface RunLogLine {
  stream: RunStream
  text: string
  level?: LogLevel
  /** logcat tag. */
  tag?: string
  at: number
}

export interface BuildError {
  /** Absolute when resolvable. */
  file: string
  line: number
  col: number
  message: string
  severity: 'error' | 'warning'
}

export type RunEvent =
  | { type: 'session'; session: RunSession }
  | { type: 'log'; sessionId: string; lines: RunLogLine[] }
  | { type: 'error'; sessionId: string; error: BuildError }
  | { type: 'devices'; devices: RunDevice[] }
  | { type: 'projects'; result: RunDetectResult }
  | { type: 'configs'; root: string; configs: RunConfig[] }

export interface RunStartRequest {
  root: string
  configId: string
  /** Device picked in the pane bar; ignored when the config pins one. */
  deviceId: string | null
}

export type RunResult = { ok: true; sessionId?: string } | { ok: false; error: EnvIssue }

export const RUN_SHARED_DIR = '.agent-monitor/run'

/** Defaults for auto-created and newly added configs ("Edit configuration templates…"), stored in app data. */
export interface RunTemplates {
  flutter: { mode: FlutterMode; flavor: string; args: string }
  android: { variant: string; args: string }
}

export const DEFAULT_RUN_TEMPLATES: RunTemplates = { flutter: { mode: 'debug', flavor: '', args: '' }, android: { variant: 'debug', args: '' } }

export type ToolchainStatus = 'ok' | 'warning' | 'error'

export interface ToolchainCheck {
  /** Doctor validator name, or an Android check id (`jdk`, `sdk`, `adb`, `emulator`, `gradlew`). */
  name: string
  status: ToolchainStatus
  /** Validator status line / tool version; masked (home → ~). */
  summary: string
  /** `issue` (Android) is shown via i18n `run.env.<code>`; `text` is tool output. */
  messages: { status: ToolchainStatus; text: string; issue?: EnvIssue }[]
}

/** "Check toolchain": `flutter doctor` or the Android tool checks, only on request. */
export interface ToolchainReport {
  kind: 'flutter' | 'android'
  checks: ToolchainCheck[]
  /** The check itself could not run (no SDK, timeout). */
  error: EnvIssue | null
  at: number
}
